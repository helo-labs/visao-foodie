import { luma } from './colorSpace.js';

// Todas as métricas rodam numa versão redimensionada para este lado maior.
//
// Isso não é detalhe de performance: a variância do Laplaciano escala com a
// resolução. Uma foto de 4000px levemente tremida pontua mais alto que uma de
// 800px perfeitamente nítida, porque tem mais pixels contribuindo para a
// variância. Sem normalizar o tamanho antes de medir, o score vira ruído.
export const WORK_SIZE = 1024;

export async function decode(source) {
  const blob = source instanceof Blob ? source : await (await fetch(source)).blob();
  const bitmap = await createImageBitmap(blob);
  return bitmap;
}

// Reduz mantendo proporção; nunca amplia (ampliar inventaria nitidez que não existe).
export function toWorkingImageData(bitmap) {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > WORK_SIZE ? WORK_SIZE / longest : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);

  return ctx.getImageData(0, 0, w, h);
}

// Canal de luminância em Float32, que é o que quase toda métrica consome.
export function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = luma(data[i], data[i + 1], data[i + 2]);
  }
  return { gray, width, height };
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
