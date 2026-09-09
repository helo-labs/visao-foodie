import { toGrayscale, percentile } from '../image.js';

// Nitidez pela variância do Laplaciano.
//
// O Laplaciano é a segunda derivada da imagem: responde forte em bordas e perto
// de zero em áreas lisas. Foto nítida tem bordas marcadas, logo variância alta;
// foto tremida borra as bordas e a variância despenca.
//
// A medida global tem um problema conhecido: foto boa de comida costuma ter
// fundo desfocado de propósito. Se o fundo ocupa metade do quadro, ele derruba
// a variância global e a foto é acusada de tremida sem ser. Por isso medimos
// por blocos e ficamos com a região mais nítida, de modo que só é tremida a foto
// em que nem a parte mais nítida tem borda definida.

const GRID = 8;                  // 8x8 = 64 blocos
const SHARPEST_PERCENTILE = 0.9; // ignora outlier isolado, sem cair na média

export function laplacianMap(gray, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      out[i] =
        gray[i - width] +
        gray[i - 1] -
        4 * gray[i] +
        gray[i + 1] +
        gray[i + width];
    }
  }
  return out;
}

function variance(values) {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  return acc / values.length;
}

export function measureSharpness(imageData) {
  const { gray, width, height } = toGrayscale(imageData);
  const lap = laplacianMap(gray, width, height);

  const tileW = Math.floor(width / GRID);
  const tileH = Math.floor(height / GRID);
  const tiles = [];

  for (let ty = 0; ty < GRID; ty++) {
    for (let tx = 0; tx < GRID; tx++) {
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = tx === GRID - 1 ? width - 1 : x0 + tileW;
      const y1 = ty === GRID - 1 ? height - 1 : y0 + tileH;

      const vals = [];
      for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y++) {
        for (let x = Math.max(1, x0); x < Math.min(width - 1, x1); x++) {
          vals.push(lap[y * width + x]);
        }
      }
      tiles.push({ tx, ty, variance: variance(vals) });
    }
  }

  const sorted = tiles.map((t) => t.variance).sort((a, b) => a - b);

  return {
    sharpest: percentile(sorted, SHARPEST_PERCENTILE),
    median: percentile(sorted, 0.5),
    global: variance(Array.from(lap)),
    tiles,
  };
}
