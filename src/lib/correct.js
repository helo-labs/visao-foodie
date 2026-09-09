import { rgbToLab, labToRgb } from './colorSpace.js';
import { LIMIARES } from './metrics/score.js';

// Correções automáticas aplicadas sobre o ImageData de trabalho.
//
// As duas mexem só no que é recuperável. Foco e pixel estourado não têm conserto
// aqui, e é por isso que a nota trata esses dois casos como defeito de captura.

const GRADE = 8;          // 8x8 blocos de equalização
const LIMITE_CORTE = 2.5; // múltiplo da altura média do histograma

// Equalização adaptativa com limite de contraste, no canal L do LAB.
//
// Descartada a equalização global de histograma, que aplica uma única curva à
// imagem inteira. Numa foto de prato ela estoura o fundo claro para levantar a
// comida na sombra, porque não tem como atender as duas regiões com uma curva só.
//
// O corte do histograma é o que separa CLAHE de equalização por blocos simples.
// Sem ele, um bloco de tom quase uniforme, como uma área lisa de toalha, recebe
// uma curva muito íngreme e vira ruído amplificado. O excedente acima do limite é
// redistribuído entre todos os bins em vez de descartado, o que preserva a área
// total do histograma.
function claheL(L, width, height) {
  const larguraBloco = Math.ceil(width / GRADE);
  const alturaBloco = Math.ceil(height / GRADE);
  const mapas = [];

  for (let by = 0; by < GRADE; by++) {
    for (let bx = 0; bx < GRADE; bx++) {
      const x0 = bx * larguraBloco;
      const y0 = by * alturaBloco;
      const x1 = Math.min(width, x0 + larguraBloco);
      const y1 = Math.min(height, y0 + alturaBloco);

      const hist = new Float32Array(256);
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = Math.max(0, Math.min(255, Math.round((L[y * width + x] / 100) * 255)));
          hist[v]++;
          n++;
        }
      }

      if (n === 0) {
        mapas.push(null);
        continue;
      }

      const limite = Math.max(1, (n / 256) * LIMITE_CORTE);
      let excedente = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > limite) {
          excedente += hist[i] - limite;
          hist[i] = limite;
        }
      }
      const porBin = excedente / 256;
      for (let i = 0; i < 256; i++) hist[i] += porBin;

      const mapa = new Float32Array(256);
      let acc = 0;
      for (let i = 0; i < 256; i++) {
        acc += hist[i];
        mapa[i] = (acc / n) * 100; // de volta à escala de L
      }
      mapas.push(mapa);
    }
  }

  // Interpolação bilinear entre os quatro blocos vizinhos. Sem ela a fronteira
  // entre blocos aparece como emenda visível na imagem corrigida.
  const saida = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) / alturaBloco - 0.5;
    const by0 = Math.max(0, Math.min(GRADE - 1, Math.floor(fy)));
    const by1 = Math.max(0, Math.min(GRADE - 1, by0 + 1));
    const ty = Math.max(0, Math.min(1, fy - by0));

    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / larguraBloco - 0.5;
      const bx0 = Math.max(0, Math.min(GRADE - 1, Math.floor(fx)));
      const bx1 = Math.max(0, Math.min(GRADE - 1, bx0 + 1));
      const tx = Math.max(0, Math.min(1, fx - bx0));

      const v = Math.max(0, Math.min(255, Math.round((L[y * width + x] / 100) * 255)));
      const m00 = mapas[by0 * GRADE + bx0];
      const m01 = mapas[by0 * GRADE + bx1];
      const m10 = mapas[by1 * GRADE + bx0];
      const m11 = mapas[by1 * GRADE + bx1];

      const a = m00 ? m00[v] : L[y * width + x];
      const b = m01 ? m01[v] : a;
      const c = m10 ? m10[v] : a;
      const d = m11 ? m11[v] : b;

      const cima = a + (b - a) * tx;
      const baixo = c + (d - c) * tx;
      saida[y * width + x] = cima + (baixo - cima) * ty;
    }
  }

  return saida;
}

// Corrige o balanço de branco subtraindo a dominante medida nos pixels neutros.
//
// Descartado o white patch, que assume que o pixel mais claro da cena é branco.
// Num prato com reflexo especular esse pixel é o brilho da luz, e não uma
// superfície branca, o que joga a correção para o lado errado.
//
// A subtração é parcial, nunca total. Zerar a dominante deixa a comida cinzenta:
// a luz quente de restaurante faz parte da aparência que se espera de um prato, e
// remover toda ela produz uma imagem tecnicamente neutra e visualmente sem vida.
const FORCA_MAXIMA_BRANCO = 0.8;

// A intensidade de cada correção sai do que foi medido, e não de um valor fixo.
//
// Descartado aplicar as duas sempre no máximo. Nessa forma o CLAHE ataca também a
// foto que já tem contraste bom e devolve uma imagem crocante demais, com a
// textura da comida exagerada. Correção automática que piora foto boa não serve.
export function pesosDeCorrecao({ color }) {
  const { ruim, bom } = LIMIARES.contraste;
  const pesoClahe = Math.max(0, Math.min(1, (bom - color.contrast) / (bom - ruim)));

  const forcaCast = Math.max(
    0,
    Math.min(1, (color.cast.strength - LIMIARES.dominante.bom) /
      (LIMIARES.dominante.ruim - LIMIARES.dominante.bom)),
  );

  return {
    clahe: pesoClahe,
    branco: forcaCast * FORCA_MAXIMA_BRANCO,
  };
}

export function corrigir(imageData, cast, { branco = 1, clahe = 1 } = {}) {
  const { data, width, height } = imageData;
  const total = width * height;

  const L = new Float32Array(total);
  const A = new Float32Array(total);
  const B = new Float32Array(total);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
    L[p] = lab.L;
    A[p] = lab.a;
    B[p] = lab.b;
  }

  // Mistura com o original em vez de substituir, para que a intensidade da
  // equalização acompanhe o quanto a foto precisa dela.
  let Lfinal = L;
  if (clahe > 0) {
    const equalizado = claheL(L, width, height);
    Lfinal = new Float32Array(total);
    for (let p = 0; p < total; p++) {
      Lfinal[p] = L[p] + (equalizado[p] - L[p]) * clahe;
    }
  }

  const desvioA = (cast?.a ?? 0) * branco;
  const desvioB = (cast?.b ?? 0) * branco;

  const saida = new ImageDataCompat(width, height);
  for (let p = 0, i = 0; p < total; p++, i += 4) {
    const { r, g, b } = labToRgb(Lfinal[p], A[p] - desvioA, B[p] - desvioB);
    saida.data[i] = r;
    saida.data[i + 1] = g;
    saida.data[i + 2] = b;
    saida.data[i + 3] = data[i + 3];
  }

  return saida;
}

// Aplica as duas correções na intensidade que as medidas pedirem, e informa o
// que foi feito para a interface poder dizer.
export function corrigirAuto(imageData, medidas) {
  const pesos = pesosDeCorrecao(medidas);
  const nenhuma = pesos.clahe < 0.02 && pesos.branco < 0.02;
  return {
    imagem: nenhuma ? imageData : corrigir(imageData, medidas.color.cast, pesos),
    pesos,
    aplicou: !nenhuma,
  };
}

// ImageData real só existe no navegador. Os scripts de calibração rodam no Node,
// então a saída é um objeto com a mesma forma, aceito por tudo que consome
// ImageData aqui e por putImageData depois da conversão em App.
class ImageDataCompat {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

export { ImageDataCompat };
