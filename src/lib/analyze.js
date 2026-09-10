import { decode, toWorkingImageData } from './image.js';
import { measureSharpness } from './metrics/sharpness.js';
import { measureExposure } from './metrics/exposure.js';
import { measureColor } from './metrics/color.js';
import { avaliar } from './metrics/score.js';
import { calcularEspectro, analisarPicos } from './signals/spectrum.js';
import { analisarExif } from './signals/exif.js';

// Ponto único de entrada. Recebe File, Blob ou URL.
//
export async function analisar(source, { completo = true } = {}) {
  const bitmap = await decode(source);
  // Guardado antes do close(): um ImageBitmap fechado passa a reportar 0 x 0.
  const dimensoes = { largura: bitmap.width, altura: bitmap.height };
  const imageData = toWorkingImageData(bitmap);
  bitmap.close?.();

  const sharpness = measureSharpness(imageData);
  const exposure = measureExposure(imageData);
  const color = measureColor(imageData);
  const medidas = { sharpness, exposure, color };

  const base = {
    dimensoes,
    analisadoEm: { largura: imageData.width, altura: imageData.height },
    ...medidas,
    resultado: avaliar(medidas),
  };

  if (!completo) return base;

  const espectro = calcularEspectro(imageData);
  const picos = analisarPicos(espectro);
  const exif = await analisarExif(source);

  return {
    ...base,
    imageData,
    sinais: { espectro, picos, exif },
  };
}
