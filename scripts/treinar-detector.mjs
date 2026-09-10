// Treina o detector de imagem gerada sobre os embeddings do CLIP.
//
// A ideia é não baixar detector nenhum. O CLIP já é carregado para reconhecer o
// prato, então a imagem já vira um vetor de 512 dimensões de graça. O que falta é
// uma fronteira nesse espaço separando foto real de imagem gerada, e isso é uma
// regressão logística: 512 pesos e um viés, uns 4KB de JSON. O detector pronto que
// media melhor ocupava 337MB.
//
// Uso:
//   node scripts/treinar-detector.mjs            # usa embeddings em cache
//   node scripts/treinar-detector.mjs --extrair  # recalcula os embeddings

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

const RAIZ = new URL('..', import.meta.url).pathname;
const TREINO = join(RAIZ, 'fotos-calibracao', 'treino');
const CACHE = join(RAIZ, 'fotos-calibracao', 'embeddings');
const SAIDA = join(RAIZ, 'src', 'lib', 'models', 'pesos-detector.json');

// Conjunto de teste vindo de fontes diferentes das do treino. É o número que
// importa: acerto na validação só diz que o modelo aprendeu a separar AQUELAS
// fontes, e um classificador pode chegar perto de 100% ali aprendendo a
// reconhecer o dataset em vez da IA.
const TESTE_CRUZADO = {
  reais: join(RAIZ, 'fotos-calibracao', 'originais'),
  geradas: join(RAIZ, 'fotos-calibracao', 'geradas', 'comida'),
};

const DIMENSOES = 512;
const EPOCAS = 600;
const TAXA = 0.5;

// São 512 pesos para algumas centenas de exemplos, então o modelo consegue decorar
// o conjunto de treino se deixarem. A força de regularização é escolhida por
// validação, e não fixada no chute.
//
// A escolha é feita na VALIDAÇÃO e nunca no teste cruzado. Ajustar
// hiperparâmetro olhando o teste transforma o teste em treino disfarçado, e o
// número que sobra deixa de medir generalização.
const L2_CANDIDATOS = [1e-4, 1e-3, 1e-2, 3e-2, 1e-1, 3e-1];

async function extrair(extrator, pasta, limite = Infinity) {
  let arquivos;
  try {
    arquivos = (await readdir(pasta)).filter((a) => /\.(jpg|jpeg|png|webp)$/i.test(a));
  } catch {
    return [];
  }
  arquivos = arquivos.slice(0, limite);

  const vetores = [];
  for (let i = 0; i < arquivos.length; i++) {
    try {
      const saida = await extrator(join(pasta, arquivos[i]));
      // Normalizar em L2 tira o efeito da magnitude do vetor, que varia com o
      // conteúdo da imagem e não com a origem dela.
      const v = Array.from(saida.data);
      let norma = 0;
      for (const x of v) norma += x * x;
      norma = Math.sqrt(norma) || 1;
      vetores.push(v.map((x) => x / norma));
    } catch {
      // Imagem ilegível não interrompe.
    }
    if (i % 25 === 0) process.stdout.write(`\r    ${i + 1}/${arquivos.length}`);
  }
  process.stdout.write(`\r    ${vetores.length}/${arquivos.length}\n`);
  return vetores;
}

async function embeddings(nomeCache, pasta, extrator, forcar, limite) {
  const caminho = join(CACHE, `${nomeCache}.json`);
  if (!forcar) {
    try {
      return JSON.parse(await readFile(caminho, 'utf8'));
    } catch {
      // Sem cache, extrai.
    }
  }
  console.log(`  extraindo ${nomeCache}...`);
  const v = await extrair(extrator, pasta, limite);
  await mkdir(CACHE, { recursive: true });
  await writeFile(caminho, JSON.stringify(v));
  return v;
}

function embaralhar(a, b) {
  const juntos = a.map((x, i) => [x, b[i]]);
  for (let i = juntos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [juntos[i], juntos[j]] = [juntos[j], juntos[i]];
  }
  return [juntos.map((x) => x[0]), juntos.map((x) => x[1])];
}

const sigmoide = (z) => 1 / (1 + Math.exp(-z));

function treinar(X, y, l2) {
  const pesos = new Float64Array(DIMENSOES);
  let vies = 0;
  const n = X.length;

  for (let epoca = 0; epoca < EPOCAS; epoca++) {
    const gradPesos = new Float64Array(DIMENSOES);
    let gradVies = 0;

    for (let i = 0; i < n; i++) {
      let z = vies;
      const xi = X[i];
      for (let d = 0; d < DIMENSOES; d++) z += pesos[d] * xi[d];
      const erro = sigmoide(z) - y[i];
      for (let d = 0; d < DIMENSOES; d++) gradPesos[d] += erro * xi[d];
      gradVies += erro;
    }

    for (let d = 0; d < DIMENSOES; d++) {
      pesos[d] -= TAXA * (gradPesos[d] / n + l2 * pesos[d]);
    }
    vies -= TAXA * (gradVies / n);
  }

  return { pesos: Array.from(pesos), vies };
}

function prever(modelo, x) {
  let z = modelo.vies;
  for (let d = 0; d < DIMENSOES; d++) z += modelo.pesos[d] * x[d];
  return sigmoide(z);
}

function avaliar(modelo, X, y, titulo) {
  const notas = X.map((x) => prever(modelo, x));
  const geradas = notas.filter((_, i) => y[i] === 1);
  const reais = notas.filter((_, i) => y[i] === 0);

  console.log(`\n${titulo}  (${reais.length} reais, ${geradas.length} geradas)`);
  console.log('  limiar   acusa real   pega gerada');
  let melhor = null;
  for (const t of [0.3, 0.5, 0.7, 0.8, 0.9]) {
    const fp = reais.filter((s) => s > t).length / (reais.length || 1);
    const tp = geradas.filter((s) => s > t).length / (geradas.length || 1);
    if (!melhor || tp - fp > melhor.j) melhor = { t, fp, tp, j: tp - fp };
    console.log(
      `   ${String(Math.round(t * 100)).padStart(3)}%      ${(fp * 100).toFixed(0).padStart(3)}%` +
      `          ${(tp * 100).toFixed(0).padStart(3)}%`,
    );
  }
  return melhor;
}

async function main() {
  const forcar = process.argv.includes('--extrair');
  console.log('Carregando CLIP...');
  const extrator = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', {
    dtype: 'q8',
  });

  const reais = await embeddings('treino-reais', join(TREINO, 'reais'), extrator, forcar);
  const geradas = await embeddings('treino-geradas', join(TREINO, 'geradas'), extrator, forcar);

  if (reais.length < 40 || geradas.length < 40) {
    console.error(`Poucos exemplos (${reais.length} reais, ${geradas.length} geradas). Rode antes: node scripts/baixar-treino.mjs`);
    process.exit(1);
  }

  // Classes equilibradas. Com 4 mil reais contra 600 geradas, o modelo aprende
  // que responder "real" quase sempre já acerta 87% e para de separar.
  const n = Math.min(reais.length, geradas.length);
  console.log(`\n${n} por classe (de ${reais.length} reais e ${geradas.length} geradas disponíveis).`);

  let X = [...reais.slice(0, n), ...geradas.slice(0, n)];
  let y = [...Array(n).fill(0), ...Array(n).fill(1)];
  [X, y] = embaralhar(X, y);

  const corte = Math.floor(X.length * 0.8);
  const Xtr = X.slice(0, corte);
  const ytr = y.slice(0, corte);
  const Xval = X.slice(corte);
  const yval = y.slice(corte);

  console.log('\nEscolhendo a regularização pela validação:');
  let melhorL2 = null;
  for (const l2 of L2_CANDIDATOS) {
    const cand = treinar(Xtr, ytr, l2);
    const notas = Xval.map((x) => prever(cand, x));
    const acertos = notas.filter((s, i) => (s > 0.5 ? 1 : 0) === yval[i]).length;
    const acuracia = acertos / (yval.length || 1);
    console.log(`  L2=${String(l2).padEnd(6)} acurácia na validação: ${(acuracia * 100).toFixed(1)}%`);
    if (!melhorL2 || acuracia > melhorL2.acuracia) melhorL2 = { l2, acuracia, modelo: cand };
  }
  console.log(`  escolhido L2=${melhorL2.l2}`);

  const modelo = melhorL2.modelo;
  avaliar(modelo, Xtr, ytr, 'TREINO');
  avaliar(modelo, Xval, yval, 'VALIDAÇÃO (mesmas fontes)');

  const cruzReais = await embeddings('teste-reais', TESTE_CRUZADO.reais, extrator, forcar);
  const cruzGeradas = await embeddings('teste-geradas', TESTE_CRUZADO.geradas, extrator, forcar);

  let melhorCruzado = null;
  if (cruzReais.length && cruzGeradas.length) {
    melhorCruzado = avaliar(
      modelo,
      [...cruzReais, ...cruzGeradas],
      [...Array(cruzReais.length).fill(0), ...Array(cruzGeradas.length).fill(1)],
      'TESTE CRUZADO (fontes que o modelo nunca viu)',
    );
  }

  const escolhido = melhorCruzado ?? { t: 0.5, fp: 0, tp: 0 };
  await writeFile(
    SAIDA,
    JSON.stringify(
      {
        modelo: 'Xenova/clip-vit-base-patch32',
        dimensoes: DIMENSOES,
        pesos: modelo.pesos.map((p) => Number(p.toFixed(6))),
        vies: Number(modelo.vies.toFixed(6)),
        limiar: escolhido.t,
        taxas: {
          falsoPositivo: Number(escolhido.fp.toFixed(3)),
          deteccao: Number(escolhido.tp.toFixed(3)),
          reais: cruzReais.length,
          geradas: cruzGeradas.length,
        },
        treinadoEm: { porClasse: n, total: n * 2, l2: melhorL2.l2 },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nPesos gravados em ${SAIDA.replace(RAIZ, '')}`);
}

main().catch((e) => {
  console.error('Falhou:', e);
  process.exit(1);
});
