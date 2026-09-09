import { luma } from '../colorSpace.js';

// Localiza o prato por transformada de Hough para círculos e avalia o
// enquadramento a partir dele.
//
// Estratégia em dois estágios, a mesma do HOUGH_GRADIENT do OpenCV. Descartado o
// acumulador tridimensional em (x, y, r), que a 320x240 com 40 raios ocuparia
// mais de 2 milhões de posições e votaria uma vez por pixel de borda por raio.
//
//   1. Cada pixel de borda vota apenas ao longo da própria normal do gradiente,
//      nos dois sentidos, para todo raio da faixa. Os votos caem num acumulador
//      bidimensional de centros. A borda de um círculo tem gradiente sempre
//      apontando para o centro, então os votos se empilham lá.
//   2. Achado o centro, o raio sai do histograma de distâncias entre ele e os
//      pixels de borda.
//
// A imagem é reduzida antes, porque Hough custa caro e a posição do prato não
// precisa de precisão de pixel.

const LADO_HOUGH = 320;
// Desvio do borramento aplicado antes do Sobel, em pixels da imagem reduzida.
// Sem ele os gradientes mais fortes da foto são a textura da comida, que é de
// alta frequência, e não a borda do prato, que é uma curva longa e lisa. Os
// votos então se concentram em qualquer relevo do prato e o círculo sai em cima
// da comida.
const SIGMA_BORRAO = 2.4;
const FRACAO_BORDAS = 0.12;  // fração de pixels de maior gradiente tratada como borda
const RAIO_MIN = 0.12;       // frações do menor lado
const RAIO_MAX = 0.95;
const PASSO_RAIO = 2;

// Nem toda foto de comida tem prato redondo. Hambúrguer em tábua, tigela vista
// de lado e marmita não têm círculo nenhum, e insistir num deles produziria uma
// avaliação de enquadramento inventada. Abaixo desta confiança a métrica se
// declara indisponível em vez de chutar.
const CONFIANCA_MINIMA = 0.28;

function reduzir(imageData, ladoAlvo) {
  const { data, width, height } = imageData;
  const maior = Math.max(width, height);
  const escala = maior > ladoAlvo ? ladoAlvo / maior : 1;
  const w = Math.max(1, Math.round(width * escala));
  const h = Math.max(1, Math.round(height * escala));

  // Média por caixa. Amostragem simples deixaria alias que vira borda falsa.
  const cinza = new Float32Array(w * h);
  const passoX = width / w;
  const passoY = height / h;

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * passoY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * passoY));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * passoX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * passoX));
      let soma = 0;
      let n = 0;
      for (let sy = y0; sy < y1 && sy < height; sy++) {
        for (let sx = x0; sx < x1 && sx < width; sx++) {
          const i = (sy * width + sx) * 4;
          soma += luma(data[i], data[i + 1], data[i + 2]);
          n++;
        }
      }
      cinza[y * w + x] = n > 0 ? soma / n : 0;
    }
  }

  return { cinza, width: w, height: h, escala };
}

// Gaussiana separável, uma passada horizontal e outra vertical.
function borrar(cinza, width, height, sigma) {
  const raio = Math.max(1, Math.ceil(sigma * 2.5));
  const nucleo = new Float32Array(raio * 2 + 1);
  let soma = 0;
  for (let i = -raio; i <= raio; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    nucleo[i + raio] = v;
    soma += v;
  }
  for (let i = 0; i < nucleo.length; i++) nucleo[i] /= soma;

  const passo1 = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -raio; k <= raio; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        acc += cinza[y * width + sx] * nucleo[k + raio];
      }
      passo1[y * width + x] = acc;
    }
  }

  const saida = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -raio; k <= raio; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        acc += passo1[sy * width + x] * nucleo[k + raio];
      }
      saida[y * width + x] = acc;
    }
  }
  return saida;
}

function sobel(cinza, width, height) {
  const mag = new Float32Array(width * height);
  const dirX = new Float32Array(width * height);
  const dirY = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -cinza[i - width - 1] + cinza[i - width + 1] +
        -2 * cinza[i - 1] + 2 * cinza[i + 1] +
        -cinza[i + width - 1] + cinza[i + width + 1];
      const gy =
        -cinza[i - width - 1] - 2 * cinza[i - width] - cinza[i - width + 1] +
        cinza[i + width - 1] + 2 * cinza[i + width] + cinza[i + width + 1];

      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > 0) {
        dirX[i] = gx / m;
        dirY[i] = gy / m;
      }
    }
  }

  return { mag, dirX, dirY };
}

export function detectarPrato(imageData) {
  const { cinza, width, height } = reduzir(imageData, LADO_HOUGH);
  const suave = borrar(cinza, width, height, SIGMA_BORRAO);
  const { mag, dirX, dirY } = sobel(suave, width, height);

  // Limiar de borda por percentil, e não por valor fixo: foto de baixo contraste
  // tem gradiente fraco em toda parte e um limiar absoluto não acharia borda
  // nenhuma nela.
  const ordenado = Float32Array.from(mag).sort();
  const limiar = ordenado[Math.floor(ordenado.length * (1 - FRACAO_BORDAS))];

  const bordas = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (mag[i] >= limiar && mag[i] > 0) bordas.push(i);
    }
  }
  if (bordas.length < 40) return { encontrado: false, motivo: 'poucas bordas' };

  const menorLado = Math.min(width, height);
  const rMin = Math.round(menorLado * RAIO_MIN);
  const rMax = Math.round(menorLado * RAIO_MAX);

  // Estágio 1: acumulador de centros.
  const acumulador = new Int32Array(width * height);
  for (const i of bordas) {
    const x = i % width;
    const y = (i - x) / width;
    const ux = dirX[i];
    const uy = dirY[i];
    for (let r = rMin; r <= rMax; r += PASSO_RAIO) {
      for (const sinal of [1, -1]) {
        const cx = Math.round(x + sinal * r * ux);
        const cy = Math.round(y + sinal * r * uy);
        if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
          acumulador[cy * width + cx]++;
        }
      }
    }
  }

  // O pico bruto é ruidoso, porque votos de um mesmo círculo caem em posições
  // vizinhas em vez de empilhar num pixel só. A soma numa janela 3x3 recupera
  // essa massa dispersa antes da busca.
  let pico = 0;
  let melhor = -1;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v =
        acumulador[i - width - 1] + acumulador[i - width] + acumulador[i - width + 1] +
        acumulador[i - 1] + acumulador[i] + acumulador[i + 1] +
        acumulador[i + width - 1] + acumulador[i + width] + acumulador[i + width + 1];
      if (v > pico) {
        pico = v;
        melhor = i;
      }
    }
  }
  if (melhor < 0) return { encontrado: false, motivo: 'sem pico' };

  const cx = melhor % width;
  const cy = (melhor - cx) / width;

  // Estágio 2: raio por histograma de distâncias ao centro encontrado.
  const histRaio = new Int32Array(rMax + 1);
  for (const i of bordas) {
    const x = i % width;
    const y = (i - x) / width;
    const d = Math.round(Math.hypot(x - cx, y - cy));
    if (d >= rMin && d <= rMax) histRaio[d]++;
  }

  let melhorRaio = rMin;
  let votosRaio = 0;
  // Janela de 3 posições: a borda de um prato real não cai num raio exato,
  // espalha entre vizinhos.
  for (let r = rMin + 1; r < rMax; r++) {
    const v = histRaio[r - 1] + histRaio[r] + histRaio[r + 1];
    if (v > votosRaio) {
      votosRaio = v;
      melhorRaio = r;
    }
  }

  // Confiança: quanto do perímetro esperado foi de fato coberto por bordas.
  const perimetro = 2 * Math.PI * melhorRaio;
  const confianca = Math.min(1, votosRaio / perimetro);

  if (confianca < CONFIANCA_MINIMA) {
    return { encontrado: false, motivo: 'nenhum círculo convincente', confianca };
  }

  // Devolvido em coordenadas relativas, para não depender da escala interna.
  return {
    encontrado: true,
    confianca,
    centro: { x: cx / width, y: cy / height },
    raio: melhorRaio / Math.min(width, height),
  };
}

export function measureFraming(imageData) {
  const prato = detectarPrato(imageData);
  if (!prato.encontrado) return { ...prato, disponivel: false };

  const { centro, raio } = prato;
  const largura = imageData.width;
  const altura = imageData.height;
  const proporcao = largura / altura;

  // Descentralização em frações do menor lado, para comparar com o raio.
  const desloc = Math.hypot(
    (centro.x - 0.5) * (proporcao >= 1 ? proporcao : 1),
    (centro.y - 0.5) * (proporcao >= 1 ? 1 : 1 / proporcao),
  );

  // Quanto do prato ficou fora do quadro, em frações do raio.
  const meiaLargura = proporcao >= 1 ? proporcao / 2 : 0.5;
  const meiaAltura = proporcao >= 1 ? 0.5 : 1 / (2 * proporcao);
  const cxAbs = (centro.x - 0.5) * (proporcao >= 1 ? proporcao : 1);
  const cyAbs = (centro.y - 0.5) * (proporcao >= 1 ? 1 : 1 / proporcao);

  const folgas = [
    meiaLargura - (cxAbs + raio),
    meiaLargura + (cxAbs - raio),
    meiaAltura - (cyAbs + raio),
    meiaAltura + (cyAbs - raio),
  ];
  const menorFolga = Math.min(...folgas);
  const corte = menorFolga < 0 ? Math.min(1, -menorFolga / raio) : 0;

  // Ocupação: raio do prato contra metade do menor lado.
  const ocupacao = raio / 0.5;

  return {
    disponivel: true,
    confianca: prato.confianca,
    centro,
    raio,
    descentralizacao: desloc,
    corte,
    ocupacao,
  };
}
