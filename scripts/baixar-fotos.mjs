// Monta o material fotográfico do projeto a partir de dois bancos livres.
//
//   Openverse  (api.openverse.org)  -> imagens com licença Creative Commons e
//                                      autoria declarada. São as que vão pro
//                                      repositório como exemplos da interface.
//   TheMealDB  (themealdb.com)      -> fotos de prato para o conjunto de
//                                      calibração, que fica fora do repositório.
//
// Bancos de imagem só publicam foto boa. Como precisamos calibrar os limiares
// contra fotos ruins também, derivamos versões degradadas a partir das boas, com
// desfoque, subexposição, estouro e baixo contraste. A vantagem é ter gabarito,
// já que sabemos qual defeito foi introduzido e com que intensidade.
//
// Uso: node scripts/baixar-fotos.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

import { carregarComoImageData } from './carregar.mjs';
import { measureSharpness } from '../src/lib/metrics/sharpness.js';
import { measureExposure } from '../src/lib/metrics/exposure.js';
import { measureColor } from '../src/lib/metrics/color.js';
import { avaliar } from '../src/lib/metrics/score.js';

// A foto que vira o exemplo "Boa" é escolhida pelo próprio analisador, e não
// pela ordem em que o Openverse devolveu. Sem isso o resultado depende da sorte:
// a primeira candidata da busca tinha dominante amarelada forte e tirava 67, o
// que faz o exemplo rotulado "Boa" parecer um defeito da ferramenta.
async function notaDe(buffer) {
  const imageData = await carregarComoImageData(buffer);
  const sharpness = measureSharpness(imageData);
  const exposure = measureExposure(imageData);
  const color = measureColor(imageData);
  return avaliar({ sharpness, exposure, color }).total;
}

const RAIZ = new URL('..', import.meta.url).pathname;
const DIR_EXEMPLOS = join(RAIZ, 'public', 'exemplos');
const DIR_CALIBRACAO = join(RAIZ, 'fotos-calibracao');

const UA = 'visao-foodie/0.1 (projeto de estudo)';

async function baixar(url) {
  const resposta = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status} em ${url}`);
  return Buffer.from(await resposta.arrayBuffer());
}

// --- Openverse: exemplos da interface, com atribuição ---

async function buscarOpenverse(quantidade) {
  const url =
    'https://api.openverse.org/v1/images/' +
    `?q=${encodeURIComponent('plated food dish')}` +
    `&page_size=${quantidade * 3}` +
    '&license_type=commercial' +
    '&mature=false';

  const resposta = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resposta.ok) throw new Error(`Openverse respondeu ${resposta.status}`);
  const { results } = await resposta.json();
  return results.filter((r) => r.url);
}

// --- TheMealDB: conjunto de calibração ---

async function buscarMealDb(letras) {
  const pratos = [];
  for (const letra of letras) {
    const resposta = await fetch(
      `https://www.themealdb.com/api/json/v1/1/search.php?f=${letra}`,
      { headers: { 'User-Agent': UA } },
    );
    if (!resposta.ok) continue;
    const dados = await resposta.json();
    for (const prato of dados.meals ?? []) {
      if (prato.strMealThumb) {
        pratos.push({ nome: prato.strMeal, url: prato.strMealThumb });
      }
    }
  }
  return pratos;
}

// --- Degradações controladas ---
//
// Cada entrada é um defeito conhecido. O nome do arquivo carrega o gabarito,
// então dá para conferir se o analisador reprova exatamente o que deveria.

const DEGRADACOES = [
  { nome: 'tremida-leve', aplicar: (img) => img.blur(1.6) },
  { nome: 'tremida-forte', aplicar: (img) => img.blur(5) },
  { nome: 'escura', aplicar: (img) => img.linear(0.45, 0) },
  { nome: 'muito-escura', aplicar: (img) => img.linear(0.24, 0) },
  { nome: 'estourada', aplicar: (img) => img.linear(1.75, 12) },
  { nome: 'lavada', aplicar: (img) => img.linear(0.42, 78) },
  { nome: 'dessaturada', aplicar: (img) => img.modulate({ saturation: 0.3 }) },
  // Multiplicador por canal, e não tint(). O tint do sharp converte para cinza
  // antes de tingir, o que apaga a cor original da foto e produz uma degradação
  // que nenhuma correção de balanço de branco consegue desfazer.
  { nome: 'amarelada', aplicar: (img) => img.linear([1.28, 1.0, 0.58], [0, 0, 0]) },
];

async function main() {
  await mkdir(DIR_EXEMPLOS, { recursive: true });
  await mkdir(join(DIR_CALIBRACAO, 'originais'), { recursive: true });
  await mkdir(join(DIR_CALIBRACAO, 'degradadas'), { recursive: true });

  // 1. Exemplos da interface -------------------------------------------------

  console.log('Buscando no Openverse…');
  const candidatos = await buscarOpenverse(4);
  const exemplos = [];
  const creditos = [];

  const avaliadas = [];
  for (const item of candidatos.slice(0, 10)) {
    try {
      const bruto = await baixar(item.url);
      const nota = await notaDe(bruto);
      avaliadas.push({ item, bruto, nota });
      console.log(`  ${nota.toFixed(0).padStart(3)}/100  ${item.title.slice(0, 50)}`);
    } catch (e) {
      console.log(`  pulei um candidato: ${e.message}`);
    }
  }

  avaliadas.sort((a, b) => b.nota - a.nota);
  const escolhida = avaliadas[0];
  let base = null;

  if (escolhida) {
    base = escolhida.bruto;
    const arquivo = 'boa.jpg';
    await sharp(base)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(join(DIR_EXEMPLOS, arquivo));

    exemplos.push({ rotulo: 'Boa', arquivo: `/exemplos/${arquivo}` });
    creditos.push(
      `- \`${arquivo}\`, "${escolhida.item.title}", por ${escolhida.item.creator}. ` +
        `Licença CC ${escolhida.item.license.toUpperCase()} ${escolhida.item.license_version}. ` +
        `Origem: ${escolhida.item.foreign_landing_url}`,
    );
    console.log(`  escolhida: ${escolhida.item.title} (${escolhida.nota.toFixed(0)}/100)`);
  }

  if (!base) throw new Error('Nenhuma imagem do Openverse pôde ser baixada.');

  // Variantes derivadas da mesma foto: a diferença de nota fica atribuível ao
  // defeito introduzido, e não a mudança de assunto entre uma foto e outra.
  const paraInterface = [
    { nome: 'tremida', rotulo: 'Tremida', aplicar: (img) => img.blur(4) },
    { nome: 'escura', rotulo: 'Escura', aplicar: (img) => img.linear(0.35, 0) },
    { nome: 'estourada', rotulo: 'Estourada', aplicar: (img) => img.linear(2.6, 35) },
    { nome: 'lavada', rotulo: 'Lavada', aplicar: (img) => img.linear(0.4, 80) },
  ];

  for (const variante of paraInterface) {
    const arquivo = `${variante.nome}.jpg`;
    const img = sharp(base)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true });
    await variante
      .aplicar(img)
      .jpeg({ quality: 82 })
      .toFile(join(DIR_EXEMPLOS, arquivo));
    exemplos.push({ rotulo: variante.rotulo, arquivo: `/exemplos/${arquivo}` });
  }

  await writeFile(
    join(RAIZ, 'src', 'exemplos.json'),
    JSON.stringify(exemplos, null, 2) + '\n',
  );

  await writeFile(
    join(DIR_EXEMPLOS, 'CREDITOS.md'),
    '# Créditos das imagens de exemplo\n\n' +
      'A foto base veio do Openverse sob licença Creative Commons.\n' +
      'As demais são versões degradadas dela, geradas por `scripts/baixar-fotos.mjs`,\n' +
      'e herdam a mesma licença.\n\n' +
      creditos.join('\n') +
      '\n',
  );
  console.log(`  ${exemplos.length} exemplos em public/exemplos/`);

  // 2. Conjunto de calibração ------------------------------------------------

  console.log('Buscando no TheMealDB…');
  const pratos = await buscarMealDb(['b', 'c', 'k', 'p', 's']);
  const selecionados = pratos.slice(0, 24);

  let indice = 0;
  for (const prato of selecionados) {
    const slug = prato.nome
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    try {
      const bruto = await baixar(prato.url);
      await sharp(bruto)
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toFile(join(DIR_CALIBRACAO, 'originais', `${slug}.jpg`));

      // Só as primeiras rendem variantes; 24 x 8 seria excesso para calibrar.
      if (indice < 6) {
        for (const d of DEGRADACOES) {
          const img = sharp(bruto).resize({
            width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true,
          });
          await d
            .aplicar(img)
            .jpeg({ quality: 88 })
            .toFile(join(DIR_CALIBRACAO, 'degradadas', `${slug}--${d.nome}.jpg`));
        }
      }
      indice++;
    } catch (e) {
      console.log(`  pulei ${prato.nome}: ${e.message}`);
    }
  }

  await writeFile(
    join(DIR_CALIBRACAO, 'LEIA-ME.md'),
    '# Conjunto de calibração\n\n' +
      'Pasta fora do controle de versão. Recrie com `node scripts/baixar-fotos.mjs`.\n\n' +
      '- `originais/` traz fotos de prato do TheMealDB, sem alteração.\n' +
      '- `degradadas/` traz versões com um defeito conhecido, indicado no nome\n' +
      '  do arquivo após `--`. Servem de gabarito para ajustar os limiares em\n' +
      '  `src/lib/metrics/score.js`.\n',
  );

  console.log(`  ${indice} originais e ${Math.min(indice, 6) * DEGRADACOES.length} degradadas em fotos-calibracao/`);
  console.log('Pronto.');
}

main().catch((e) => {
  console.error('Falhou:', e.message);
  process.exit(1);
});
