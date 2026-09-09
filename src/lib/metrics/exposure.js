import { luma } from '../colorSpace.js';
import { percentile } from '../image.js';

// Exposição pelo histograma de luminância.
//
// São dois defeitos diferentes e o diagnóstico precisa separá-los.
//
// Exposição média errada deixa a foto inteira escura ou clara demais, e tem
// conserto, basta puxar o brilho.
//
// Clipping são pixels colados em 0 ou em 255. A informação se perdeu na captura e
// nenhum ajuste traz de volta, porque sombra chapada continua chapada. Por isso o
// clipping pesa mais na nota que o brilho médio.

const SHADOW_FLOOR = 4;
const HIGHLIGHT_CEIL = 251;

// O clipping é medido duas vezes, no quadro inteiro e só no miolo. A nota usa o
// miolo, e o quadro inteiro fica para exibição.
//
// Medir só o quadro inteiro não separa nada, porque foto de catálogo costuma ter
// fundo branco liso que enche o topo do histograma sem que a foto esteja
// estourada. No conjunto de referência, foto boa chega a 34% dos pixels em 255,
// mais que os 26% de uma foto deliberadamente estourada.
//
// Como o prato fica no meio do quadro e o fundo nas bordas, a região central
// separa os dois casos sem precisar localizar o assunto, o que só chega na Fase 2
// com o Hough Circles.
const MIOLO = 0.6;

export function measureExposure(imageData) {
  const { data, width, height } = imageData;
  const histogram = new Uint32Array(256);
  const values = [];

  let shadowClipped = 0;
  let highlightClipped = 0;
  let sum = 0;

  const margemX = Math.floor((width * (1 - MIOLO)) / 2);
  const margemY = Math.floor((height * (1 - MIOLO)) / 2);
  let miolo = 0;
  let mioloEstourado = 0;
  let mioloChapado = 0;

  const total = data.length / 4;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = luma(data[i], data[i + 1], data[i + 2]);
    const bin = Math.min(255, Math.max(0, Math.round(y)));
    histogram[bin]++;
    values.push(y);
    sum += y;
    if (bin <= SHADOW_FLOOR) shadowClipped++;
    if (bin >= HIGHLIGHT_CEIL) highlightClipped++;

    const x = p % width;
    const linha = (p - x) / width;
    if (
      x >= margemX && x < width - margemX &&
      linha >= margemY && linha < height - margemY
    ) {
      miolo++;
      if (bin >= HIGHLIGHT_CEIL) mioloEstourado++;
      if (bin <= SHADOW_FLOOR) mioloChapado++;
    }
  }

  values.sort((a, b) => a - b);

  return {
    histogram,
    mean: sum / total,
    p5: percentile(values, 0.05),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    shadowClipped: shadowClipped / total,
    highlightClipped: highlightClipped / total,
    // Usados na nota; os do quadro inteiro ficam para exibição.
    highlightClippedMiolo: miolo > 0 ? mioloEstourado / miolo : 0,
    shadowClippedMiolo: miolo > 0 ? mioloChapado / miolo : 0,
  };
}
