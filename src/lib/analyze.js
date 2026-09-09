import { decode, toWorkingImageData } from './image.js';
import { measureSharpness } from './metrics/sharpness.js';
import { measureExposure } from './metrics/exposure.js';
import { measureColor } from './metrics/color.js';
import { measureFraming } from './metrics/framing.js';
import { avaliar } from './metrics/score.js';
import { corrigirAuto } from './correct.js';
import { calcularEspectro, analisarPicos } from './signals/spectrum.js';
import { analisarRuido } from './signals/noise.js';
import { analisarExif } from './signals/exif.js';

// Ponto único de entrada. Recebe File, Blob ou URL.
//
// O modo rápido existe para a webcam, que reanalisa a cada quadro. Enquadramento,
// espectro e correção custam algumas centenas de milissegundos somados, o que é
// irrelevante para uma foto escolhida e inviável a 30 quadros por segundo.
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

  const framing = measureFraming(imageData);
  const correcao = corrigirAuto(imageData, medidas);

  const espectro = calcularEspectro(imageData);
  const picos = analisarPicos(espectro);
  const ruido = analisarRuido(imageData);
  const exif = await analisarExif(source);

  return {
    ...base,
    imageData,
    framing,
    correcao,
    sinais: { espectro, picos, ruido, exif },
  };
}
