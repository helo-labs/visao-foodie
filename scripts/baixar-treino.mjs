// Baixa o conjunto de treino do detector, com volume dos dois lados.
//
//   REAIS    ethz/food101, 101 mil fotos de comida de verdade.
//   GERADAS  TurkishCodeMan/recipe-synthetic-images-10k, 10 mil imagens de receita
//            geradas por IA, mais imagens de comida filtradas do DiffusionDB, que
//            é outro gerador e entra para o treino não ficar preso a um só.
//
// Todas as imagens são reamostradas para o mesmo lado e recodificadas em JPEG com
// a mesma qualidade.
//
// Isso não é economia de disco, é o cuidado central do experimento. Se as reais
// vierem grandes e limpas e as geradas vierem pequenas e recomprimidas, o
// classificador aprende a reconhecer a FONTE em vez da IA, acerta quase tudo na
// validação e não vale nada em foto de gente.
//
// Uso: node scripts/baixar-treino.mjs [porLado]

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import sharp from 'sharp';

// A varredura precisa de milhares de chamadas à API, e sem token a cota anônima
// devolve 429 no meio do caminho. O token só precisa de permissão de leitura.
let TOKEN = process.env.HF_TOKEN ?? '';
try {
  TOKEN = TOKEN || (await readFile(join(homedir(), '.hf-token'), 'utf8')).trim();
} catch {
  // Segue sem token, sujeito ao limite anônimo.
}
const CABECALHOS = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

const RAIZ = new URL('..', import.meta.url).pathname;
const DIR = join(RAIZ, 'fotos-calibracao', 'treino');

const LADO = 384;
const QUALIDADE = 85;
const POR_LADO = Number(process.argv[2] ?? 4000);

// Comida é menos de 1% do que estes datasets contêm, então a varredura é ampla e
// o download é só do que passa no filtro de prompt. Somados, os espelhos do
// DiffusionDB rendem algumas centenas de imagens de comida gerada, que é o que
// existe de fato publicado.
//
// Descartado TurkishCodeMan/recipe-synthetic-images-10k, que pelo nome seria a
// fonte ideal. A coluna de imagem dele são páginas de receita renderizadas em
// texto, não fotos de prato, e treinar nisso produziria um classificador de
// "página com letra".
const PALAVRAS_DE_COMIDA =
  /\b(food|dish|meal|plate of|cake|pizza|burger|soup|salad|dessert|breakfast|dinner|cuisine|cooking|bread|pasta|steak|sushi|noodles|sandwich|coffee|pastry|cookie|pie|bowl of|fruit|cheese|chocolate|ice cream)\b/i;

const porPrompt = (linha) => PALAVRAS_DE_COMIDA.test(String(linha.prompt ?? ''));

const FONTES = {
  reais: [{ dataset: 'ethz/food101', config: 'default', split: 'train', coluna: 'image' }],
  // Ficaram de fora rbeauchamp/diffusion_db_dedupe_from50k_train e
  // svjack/diffusiondb_random_10k: o visualizador dos dois responde 500, com
  // estouro de limite de leitura do parquet no lado do servidor.
  geradas: [
    { dataset: 'whosouravsharma/text-to-image-diffusiondb-2M', config: 'default', split: 'train', coluna: 'image', filtro: porPrompt, varrer: 18219 },
    { dataset: 'svjack/diffusiondb_2m_random_50k', config: 'default', split: 'train', coluna: 'image', filtro: porPrompt, varrer: 8338 },
  ],
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Espera entre páginas e recuo exponencial no 429.
//
// O datasets-server limita por taxa mesmo com token, e a versão sem espera desta
// função varria dezenas de páginas por segundo, tomava 429 em todas e as engolia
// no catch. O resultado era uma varredura que parecia rodar até o fim e devolvia
// treze imagens.
const ESPERA_ENTRE_PAGINAS = 1500;
const TENTATIVAS = 5;

async function linhas(fonte, offset, tamanho) {
  const url =
    'https://datasets-server.huggingface.co/rows' +
    `?dataset=${encodeURIComponent(fonte.dataset)}&config=${fonte.config}&split=${fonte.split}` +
    `&offset=${offset}&length=${tamanho}`;

  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    const r = await fetch(url, { headers: CABECALHOS });
    if (r.ok) {
      const d = await r.json();
      return d.rows.map((x) => x.row).filter((l) => (fonte.filtro ? fonte.filtro(l) : true));
    }
    if (r.status === 429) {
      await dormir(20000 * (tentativa + 1));
      continue;
    }
    throw new Error(`HTTP ${r.status}`);
  }
  throw new Error('429 persistente');
}

async function normalizarEGravar(url, destino) {
  const r = await fetch(url);
  if (!r.ok) return false;
  const bruto = Buffer.from(await r.arrayBuffer());
  await sharp(bruto)
    .resize({ width: LADO, height: LADO, fit: 'cover', position: 'centre' })
    .jpeg({ quality: QUALIDADE })
    .toFile(destino);
  return true;
}

async function baixarClasse(nome, fontes, alvo) {
  const destino = join(DIR, nome);
  await mkdir(destino, { recursive: true });

  // Retomar de onde parou, para uma varredura interrompida não recomeçar do zero.
  let total = 0;
  try {
    total = (await readdir(destino)).filter((a) => a.endsWith('.jpg')).length;
  } catch {
    total = 0;
  }
  if (total >= alvo) {
    console.log(`  ${nome}: ${total} já baixadas, pulando`);
    return total;
  }
  const PAGINA = 100;

  for (const fonte of fontes) {
    if (total >= alvo) break;
    const limiteVarredura = fonte.varrer ?? alvo * 4;
    let falhas = 0;

    for (let offset = 0; offset < limiteVarredura && total < alvo; offset += PAGINA) {
      let lote;
      try {
        lote = await linhas(fonte, offset, PAGINA);
      } catch (e) {
        falhas++;
        // Falha em cascata quer dizer que o servidor não vai voltar tão cedo, e
        // continuar varrendo só queima offsets sem baixar nada.
        if (falhas > 8) {
          console.log(`\n  desisti de ${fonte.dataset} em ${offset}: ${e.message}`);
          break;
        }
        continue;
      }
      falhas = 0;
      await dormir(ESPERA_ENTRE_PAGINAS);
      if (lote.length === 0) continue;

      const resultados = await Promise.all(
        lote.map(async (linha, i) => {
          const src = linha[fonte.coluna]?.src;
          if (!src) return false;
          const arquivo = join(
            destino,
            `${fonte.dataset.split('/')[1].slice(0, 14)}-${String(offset + i).padStart(6, '0')}.jpg`,
          );
          try {
            return await normalizarEGravar(src, arquivo);
          } catch {
            return false;
          }
        }),
      );

      total += resultados.filter(Boolean).length;
      process.stdout.write(`\r  ${nome}: ${total}/${alvo}  (varrendo ${fonte.dataset.split('/')[1].slice(0, 20)} em ${offset})`);
    }
  }
  console.log();
  return total;
}

async function main() {
  console.log(`Baixando ${POR_LADO} por lado, tudo em ${LADO}px e JPEG ${QUALIDADE}.`);
  const reais = await baixarClasse('reais', FONTES.reais, POR_LADO);
  const geradas = await baixarClasse('geradas', FONTES.geradas, POR_LADO);
  console.log(`\nPronto. ${reais} reais e ${geradas} geradas em fotos-calibracao/treino/`);
}

main().catch((e) => {
  console.error('Falhou:', e.message);
  process.exit(1);
});
