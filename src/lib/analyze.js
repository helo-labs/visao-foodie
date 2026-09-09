import { decode, toWorkingImageData } from './image.js';
import { measureSharpness } from './metrics/sharpness.js';
import { measureExposure } from './metrics/exposure.js';
import { measureColor } from './metrics/color.js';
import { avaliar } from './metrics/score.js';

// Ponto único de entrada da análise. Recebe File, Blob ou URL.
export async function analisar(source) {
  const bitmap = await decode(source);
  const imageData = toWorkingImageData(bitmap);

  // Guardado antes do close(): um ImageBitmap fechado passa a reportar 0 x 0.
  const dimensoes = { largura: bitmap.width, altura: bitmap.height };

  const sharpness = measureSharpness(imageData);
  const exposure = measureExposure(imageData);
  const color = measureColor(imageData);

  bitmap.close?.();

  return {
    dimensoes,
    analisadoEm: { largura: imageData.width, altura: imageData.height },
    sharpness,
    exposure,
    color,
    resultado: avaliar({ sharpness, exposure, color }),
  };
}
