import { luma } from '../colorSpace.js';

// Espectro de frequência por FFT bidimensional.
//
// Interpoladores de difusão e GAN reamostram a imagem em grade, e reamostragem
// periódica deixa réplica periódica no espectro, que aparece como picos isolados
// fora do centro. Foto de câmera não tem esses picos: o espectro dela decai de
// forma suave do centro para as bordas, aproximadamente com 1/f.
//
// O sinal degrada rápido. Redimensionar ou recomprimir a imagem depois de gerada
// embaralha a assinatura, então a ausência de picos não diz nada. A presença
// deles é que é informativa.

const LADO = 256; // potência de 2, exigida pelo radix-2

// FFT complexa no lugar, Cooley-Tukey radix-2 com inversão de bits.
function fft(re, im) {
  const n = re.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let tamanho = 2; tamanho <= n; tamanho <<= 1) {
    const angulo = (-2 * Math.PI) / tamanho;
    const wRe = Math.cos(angulo);
    const wIm = Math.sin(angulo);
    for (let i = 0; i < n; i += tamanho) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < tamanho / 2; j++) {
        const a = i + j;
        const b = i + j + tamanho / 2;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const proxRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = proxRe;
      }
    }
  }
}

// Recorte central quadrado, reduzido para LADO por média de caixa.
function recortarCentro(imageData) {
  const { data, width, height } = imageData;
  const lado = Math.min(width, height);
  const x0 = Math.floor((width - lado) / 2);
  const y0 = Math.floor((height - lado) / 2);
  const passo = lado / LADO;

  const saida = new Float64Array(LADO * LADO);
  for (let y = 0; y < LADO; y++) {
    const sy0 = y0 + Math.floor(y * passo);
    const sy1 = Math.max(sy0 + 1, y0 + Math.floor((y + 1) * passo));
    for (let x = 0; x < LADO; x++) {
      const sx0 = x0 + Math.floor(x * passo);
      const sx1 = Math.max(sx0 + 1, x0 + Math.floor((x + 1) * passo));
      let soma = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < width; sx++) {
          const i = (sy * width + sx) * 4;
          soma += luma(data[i], data[i + 1], data[i + 2]);
          n++;
        }
      }
      saida[y * LADO + x] = n > 0 ? soma / n : 0;
    }
  }
  return saida;
}

export function calcularEspectro(imageData) {
  const amostra = recortarCentro(imageData);

  // Janela de Hann nas duas direções. Sem ela a descontinuidade entre a borda
  // esquerda e a direita do recorte vira uma cruz brilhante no espectro, que é
  // artefato do corte e não da imagem, e seria confundida com assinatura de
  // reamostragem.
  const janela = new Float64Array(LADO);
  for (let i = 0; i < LADO; i++) {
    janela[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (LADO - 1)));
  }

  let media = 0;
  for (let i = 0; i < amostra.length; i++) media += amostra[i];
  media /= amostra.length;

  const re = new Float64Array(LADO * LADO);
  const im = new Float64Array(LADO * LADO);
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      re[y * LADO + x] = (amostra[y * LADO + x] - media) * janela[y] * janela[x];
    }
  }

  const linhaRe = new Float64Array(LADO);
  const linhaIm = new Float64Array(LADO);

  for (let y = 0; y < LADO; y++) {
    linhaRe.set(re.subarray(y * LADO, y * LADO + LADO));
    linhaIm.set(im.subarray(y * LADO, y * LADO + LADO));
    fft(linhaRe, linhaIm);
    re.set(linhaRe, y * LADO);
    im.set(linhaIm, y * LADO);
  }

  const colRe = new Float64Array(LADO);
  const colIm = new Float64Array(LADO);
  for (let x = 0; x < LADO; x++) {
    for (let y = 0; y < LADO; y++) {
      colRe[y] = re[y * LADO + x];
      colIm[y] = im[y * LADO + x];
    }
    fft(colRe, colIm);
    for (let y = 0; y < LADO; y++) {
      re[y * LADO + x] = colRe[y];
      im[y * LADO + x] = colIm[y];
    }
  }

  // Magnitude com a origem levada ao centro, que é como o espectro se lê.
  const meio = LADO / 2;
  const magnitude = new Float64Array(LADO * LADO);
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      const sy = (y + meio) % LADO;
      const sx = (x + meio) % LADO;
      const i = y * LADO + x;
      magnitude[sy * LADO + sx] = Math.hypot(re[i], im[i]);
    }
  }

  return { magnitude, lado: LADO };
}

// Procura picos que destoem do próprio anel de frequência.
//
// A comparação é feita contra a mediana do anel de mesmo raio, e não contra a
// média global. O espectro de imagem natural decai com a distância do centro,
// então um limiar global acusaria todo o miolo e nada da periferia.
const RAIO_MINIMO = 0.12; // ignora o centro, onde mora a estrutura da própria cena
const FATOR_PICO = 6;

// Piso para a mediana do anel, como fração da magnitude média de toda a região
// analisada. Sem ele a razão explode num espectro quase vazio, como o de uma
// senoide pura, onde a mediana do anel é praticamente zero e qualquer bin acima
// dela vira pico.
//
// O piso é relativo à média, e não à mediana global, justamente porque nesses
// casos degenerados a mediana também é zero e não serviria de referência. A
// média carrega a energia dos poucos picos reais e dá uma escala utilizável.
const PISO_MEDIANA = 0.02;

export function analisarPicos({ magnitude, lado }) {
  const meio = lado / 2;
  const aneis = new Map();

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const r = Math.round(Math.hypot(x - meio, y - meio));
      if (r / meio < RAIO_MINIMO || r >= meio) continue;
      if (!aneis.has(r)) aneis.set(r, []);
      aneis.get(r).push(magnitude[y * lado + x]);
    }
  }

  const medianaDoAnel = new Map();
  let soma = 0;
  let quantos = 0;
  for (const [r, valores] of aneis) {
    valores.sort((a, b) => a - b);
    medianaDoAnel.set(r, valores[Math.floor(valores.length / 2)] || 0);
    for (const v of valores) {
      soma += v;
      quantos++;
    }
  }

  const media = quantos > 0 ? soma / quantos : 0;
  const piso = media * PISO_MEDIANA;

  let picos = 0;
  let analisados = 0;
  let maiorRazao = 0;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const r = Math.round(Math.hypot(x - meio, y - meio));
      if (r / meio < RAIO_MINIMO || r >= meio) continue;
      const mediana = Math.max(medianaDoAnel.get(r) ?? 0, piso);
      if (mediana <= 0) continue;
      analisados++;
      const razao = magnitude[y * lado + x] / mediana;
      if (razao > FATOR_PICO) picos++;
      if (razao > maiorRazao) maiorRazao = razao;
    }
  }

  return {
    picos,
    // Fração é o que se compara entre imagens; a contagem crua depende do tamanho
    // da região analisada.
    fracaoPicos: analisados > 0 ? picos / analisados : 0,
    maiorRazao,
  };
}
