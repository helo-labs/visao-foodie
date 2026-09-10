// Monta o conjunto de imagens GERADAS para validar o detector.
//
// Sem ele não há como afirmar nada sobre o detector: medir só em foto real diz
// quantos falsos positivos existem, e não se o detector separa alguma coisa.
//
// Não existe dataset público de comida gerada por IA, então a fonte é um dataset
// geral do Midjourney, filtrado com CLIP. O próprio CLIP que o projeto usa para
// reconhecer o prato serve para achar, entre milhares de imagens de todo tipo,
// as que são de comida.
//
// Uso: node scripts/baixar-geradas.mjs [quantidade]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

const RAIZ = new URL('..', import.meta.url).pathname;
const DIR = join(RAIZ, 'fotos-calibracao', 'geradas');
const COMIDA = join(DIR, 'comida');

const DATASET = 'ehristoforu/midjourney-images';
const CANDIDATAS = Number(process.argv[2] ?? 400);

const ROTULOS = [
  'a photo of a plated dish of food',
  'a photo of a person',
  'a landscape or scenery',
  'an abstract or fantasy artwork',
  'an animal',
  'a building or interior',
  'a vehicle',
];
const ROTULO_COMIDA = ROTULOS[0];
const CONFIANCA = 0.5;

async function linhas(offset, tamanho) {
  const url =
    'https://datasets-server.huggingface.co/rows' +
    `?dataset=${encodeURIComponent(DATASET)}&config=default&split=train` +
    `&offset=${offset}&length=${tamanho}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`datasets-server respondeu ${r.status}`);
  const d = await r.json();
  return d.rows.map((x) => x.row.image?.src).filter(Boolean);
}

async function main() {
  await mkdir(COMIDA, { recursive: true });

  // O filtro roda durante o download, e a imagem que não é de comida é descartada
  // na hora. Guardar tudo antes de filtrar exigiria quase um gigabyte para uma
  // dezena de imagens aproveitáveis, já que o dataset tem menos de 1% de comida.
  console.log('Carregando CLIP...');
  const clip = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', {
    dtype: 'q8',
  });

  console.log(`Varrendo ${CANDIDATAS} imagens do ${DATASET}...`);
  const PAGINA = 100;
  let vistas = 0;
  let guardadas = 0;

  for (let offset = 0; offset < CANDIDATAS; offset += PAGINA) {
    let urls;
    try {
      urls = await linhas(offset, Math.min(PAGINA, CANDIDATAS - offset));
    } catch {
      continue;
    }

    const lote = await Promise.all(
      urls.map(async (url, i) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          return { indice: offset + i, buffer: Buffer.from(await r.arrayBuffer()) };
        } catch {
          return null;
        }
      }),
    );

    for (const item of lote) {
      if (!item) continue;
      vistas++;
      try {
        const blob = new Blob([item.buffer]);
        const saida = await clip(await createImageBitmapCompat(blob), ROTULOS);
        const topo = saida[0];
        if (topo.label === ROTULO_COMIDA && topo.score >= CONFIANCA) {
          await writeFile(join(COMIDA, `mj-${String(item.indice).padStart(5, '0')}.jpg`), item.buffer);
          guardadas++;
        }
      } catch {
        // Imagem ilegível não interrompe o lote.
      }
    }
    process.stdout.write(`\r  ${vistas} vistas, ${guardadas} de comida`);
  }

  console.log(`\nPronto. ${guardadas} imagens de comida geradas em fotos-calibracao/geradas/comida/`);
}

// O transformers.js no Node aceita RawImage; o caminho mais curto a partir de um
// Buffer é passar pelo blob.
async function createImageBitmapCompat(blob) {
  const { RawImage } = await import('@huggingface/transformers');
  return RawImage.fromBlob(blob);
}

main().catch((e) => {
  console.error('Falhou:', e.message);
  process.exit(1);
});
