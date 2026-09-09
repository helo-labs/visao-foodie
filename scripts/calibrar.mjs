// Roda as métricas do navegador sobre o conjunto de calibração, no Node.
//
// As funções de medida recebem um objeto { data, width, height }, exatamente a
// forma de um ImageData. Só o carregamento é específico do navegador, então aqui
// o sharp faz esse papel e o resto do código é o mesmo que roda em produção.
// Nada é reimplementado: se o número sair errado aqui, sai errado no site.
//
// Uso: node scripts/calibrar.mjs [ordenar|tabela]

import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

import { carregarComoImageData } from './carregar.mjs';
import { measureSharpness } from '../src/lib/metrics/sharpness.js';
import { measureExposure } from '../src/lib/metrics/exposure.js';
import { measureColor } from '../src/lib/metrics/color.js';
import { avaliar } from '../src/lib/metrics/score.js';

const RAIZ = new URL('..', import.meta.url).pathname;
const DIR = join(RAIZ, 'fotos-calibracao');

async function medir(caminho) {
  const imageData = await carregarComoImageData(caminho);
  const sharpness = measureSharpness(imageData);
  const exposure = measureExposure(imageData);
  const color = measureColor(imageData);
  return {
    sharpness,
    exposure,
    color,
    resultado: avaliar({ sharpness, exposure, color }),
  };
}

const pad = (v, n) => String(v).padStart(n);
const padDir = (v, n) => String(v).padEnd(n);

async function listar(sub) {
  try {
    const arquivos = await readdir(join(DIR, sub));
    return arquivos.filter((a) => a.endsWith('.jpg')).map((a) => join(DIR, sub, a));
  } catch {
    return [];
  }
}

async function main() {
  const originais = await listar('originais');
  const degradadas = await listar('degradadas');

  if (originais.length === 0) {
    console.error('Sem fotos. Rode antes: node scripts/baixar-fotos.mjs');
    process.exit(1);
  }

  const linhas = [];
  for (const [grupo, arquivos] of [['original', originais], ['degradada', degradadas]]) {
    for (const arquivo of arquivos) {
      const m = await medir(arquivo);
      const defeito = grupo === 'degradada'
        ? basename(arquivo, '.jpg').split('--')[1]
        : '-';
      linhas.push({
        nome: basename(arquivo, '.jpg'),
        grupo,
        defeito,
        nitidez: m.sharpness.sharpest,
        brilho: m.exposure.mean,
        estouro: m.exposure.highlightClipped * 100,
        sombras: m.exposure.shadowClipped * 100,
        contraste: m.color.contrast,
        saturacao: m.color.saturation,
        dominante: m.color.cast.strength,
        nota: m.resultado.total,
      });
    }
  }

  console.log(
    padDir('foto', 46) + pad('nitidez', 9) + pad('brilho', 8) + pad('estouro%', 9) +
    pad('sombra%', 9) + pad('contr', 7) + pad('satur', 7) + pad('domin', 7) + pad('NOTA', 7),
  );
  console.log('-'.repeat(101));

  const ordenadas = process.argv[2] === 'ordenar'
    ? [...linhas].sort((a, b) => a.nota - b.nota)
    : linhas;

  for (const l of ordenadas) {
    console.log(
      padDir(l.nome.slice(0, 45), 46) +
      pad(l.nitidez.toFixed(0), 9) +
      pad(l.brilho.toFixed(0), 8) +
      pad(l.estouro.toFixed(1), 9) +
      pad(l.sombras.toFixed(1), 9) +
      pad(l.contraste.toFixed(0), 7) +
      pad(l.saturacao.toFixed(1), 7) +
      pad(l.dominante.toFixed(1), 7) +
      pad(l.nota.toFixed(0), 7),
    );
  }

  // Resumo por defeito: é aqui que se vê se a métrica separa o que deveria.
  console.log('\nResumo por grupo (média das notas e da métrica alvo):\n');
  const porDefeito = new Map();
  for (const l of linhas) {
    const chave = l.grupo === 'original' ? 'original' : l.defeito;
    if (!porDefeito.has(chave)) porDefeito.set(chave, []);
    porDefeito.get(chave).push(l);
  }

  const alvo = {
    'tremida-leve': 'nitidez', 'tremida-forte': 'nitidez',
    escura: 'brilho', 'muito-escura': 'brilho', estourada: 'estouro',
    lavada: 'contraste', dessaturada: 'saturacao', amarelada: 'dominante',
    original: 'nitidez',
  };

  console.log(padDir('grupo', 18) + pad('n', 4) + pad('nota média', 13) + '   métrica alvo');
  console.log('-'.repeat(66));
  for (const [chave, itens] of porDefeito) {
    const media = itens.reduce((a, b) => a + b.nota, 0) / itens.length;
    const campo = alvo[chave] ?? 'nitidez';
    const mediaAlvo = itens.reduce((a, b) => a + b[campo], 0) / itens.length;
    console.log(
      padDir(chave, 18) + pad(itens.length, 4) + pad(media.toFixed(1), 13) +
      `   ${campo} = ${mediaAlvo.toFixed(1)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
