// Leitura de metadados. É o sinal mais barato e o mais informativo dos três.
//
// A evidência é assimétrica, e a interface precisa dizer isso.
//
// Metadado de câmera PRESENTE é evidência boa de foto real. Modelo do aparelho,
// tempo de exposição, ISO e abertura são coisas que um gerador não tem motivo
// para inventar de forma consistente.
//
// Metadado AUSENTE não é evidência de quase nada. WhatsApp, Instagram e qualquer
// reenvio removem tudo, então a maior parte das fotos reais que circulam chega
// sem EXIF nenhum.

const CAMPOS_DE_CAMERA = ['Make', 'Model', 'ExposureTime', 'ISO', 'FNumber', 'FocalLength'];

// Assinaturas que geradores deixam no campo Software ou equivalentes.
const MARCAS_DE_GERADOR = [
  'dall-e', 'dalle', 'midjourney', 'stable diffusion', 'stablediffusion',
  'automatic1111', 'comfyui', 'firefly', 'imagen', 'flux', 'novelai',
  'craiyon', 'leonardo.ai', 'ideogram',
];

export async function analisarExif(arquivo) {
  let dados = null;
  try {
    const exifr = await import('exifr');
    dados = await exifr.parse(arquivo, { tiff: true, exif: true, ifd0: true, xmp: true });
  } catch {
    dados = null;
  }

  if (!dados) {
    return { temMetadados: false, camposDeCamera: [], gerador: null };
  }

  const camposDeCamera = CAMPOS_DE_CAMERA.filter(
    (c) => dados[c] !== undefined && dados[c] !== null && dados[c] !== '',
  );

  const textoSoftware = [dados.Software, dados.CreatorTool, dados.ProcessingSoftware]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const gerador = MARCAS_DE_GERADOR.find((m) => textoSoftware.includes(m)) ?? null;

  return {
    temMetadados: true,
    camposDeCamera,
    camera: [dados.Make, dados.Model].filter(Boolean).join(' ') || null,
    software: dados.Software ?? dados.CreatorTool ?? null,
    gerador,
  };
}
