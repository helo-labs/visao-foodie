// Carrega uma imagem no formato que as métricas esperam, fora do navegador.
//
// No site, toWorkingImageData() usa canvas. Aqui o sharp faz o mesmo papel:
// reduz o lado maior para WORK_SIZE, nunca amplia, e entrega RGBA cru. O que
// sai daqui é intercambiável com um ImageData de verdade, então os scripts
// rodam exatamente o mesmo código de medição que roda em produção.

import sharp from 'sharp';
import { WORK_SIZE } from '../src/lib/image.js';

export async function carregarComoImageData(caminhoOuBuffer) {
  const img = sharp(caminhoOuBuffer);
  const meta = await img.metadata();
  const maior = Math.max(meta.width, meta.height);
  const escala = maior > WORK_SIZE ? WORK_SIZE / maior : 1;

  const { data, info } = await img
    .resize({
      width: Math.round(meta.width * escala),
      height: Math.round(meta.height * escala),
      fit: 'fill',
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}
