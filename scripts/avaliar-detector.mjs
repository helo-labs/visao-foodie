// Mede o detector de imagem gerada contra os dois conjuntos de referência.
//
// Este script existe porque a pergunta "o detector funciona?" não tem resposta sem
// os dois lados. Medir só em foto real diz quantos falsos positivos existem e nada
// sobre o que ele pega. Medir só em imagem gerada diz o contrário. As taxas que a
// interface mostra saem daqui.
//
// Uso:
//   node scripts/avaliar-detector.mjs                  # o modelo em uso
//   node scripts/avaliar-detector.mjs <id> [dtype]     # qualquer outro candidato

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline, env } from '@huggingface/transformers';
import { MODELO } from '../src/lib/models/detectorIA.js';

env.allowLocalModels = false;

const RAIZ = new URL('..', import.meta.url).pathname;
const REAIS = join(RAIZ, 'fotos-calibracao', 'originais');
const GERADAS = join(RAIZ, 'fotos-calibracao', 'geradas', 'comida');

const ROTULOS_ARTIFICIAIS = /^(ai|artificial|fake|generated|ai_gen|aigenerated|deepfake)/i;

function pontuacao(saida) {
  let melhor = 0;
  for (const { label, score } of saida) {
    if (ROTULOS_ARTIFICIAIS.test(String(label).replace(/[\s-]/g, '_'))) {
      melhor = Math.max(melhor, score);
    }
  }
  return melhor;
}

async function medirPasta(detector, pasta) {
  let arquivos;
  try {
    arquivos = (await readdir(pasta)).filter((a) => /\.(jpg|jpeg|png|webp)$/i.test(a));
  } catch {
    return [];
  }
  const notas = [];
  for (const arquivo of arquivos) {
    try {
      notas.push(pontuacao(await detector(join(pasta, arquivo), { top_k: 5 })));
    } catch {
      // Imagem ilegível não interrompe a medição.
    }
  }
  return notas;
}

const pct = (v, q) => {
  if (v.length === 0) return '-';
  const s = [...v].sort((a, b) => a - b);
  return (s[Math.min(s.length - 1, Math.floor(s.length * q))] * 100).toFixed(0) + '%';
};

async function main() {
  const id = process.argv[2] ?? MODELO.id;
  const dtype = process.argv[3] ?? (process.argv[2] ? 'q8' : MODELO.dtype);

  console.log(`Modelo: ${id} (${dtype})\n`);
  const detector = await pipeline('image-classification', id, { dtype });

  const reais = await medirPasta(detector, REAIS);
  const geradas = await medirPasta(detector, GERADAS);

  if (geradas.length === 0) {
    console.error('Sem imagens geradas. Rode antes: node scripts/baixar-geradas.mjs 6000');
    process.exit(1);
  }

  console.log(`REAIS    n=${String(reais.length).padStart(3)}  p25=${pct(reais, 0.25)} p50=${pct(reais, 0.5)} p75=${pct(reais, 0.75)} p90=${pct(reais, 0.9)}`);
  console.log(`GERADAS  n=${String(geradas.length).padStart(3)}  p25=${pct(geradas, 0.25)} p50=${pct(geradas, 0.5)} p75=${pct(geradas, 0.75)} p90=${pct(geradas, 0.9)}`);

  console.log('\nlimiar   acusa foto real     pega gerada');
  let melhor = null;
  for (const t of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const fp = reais.filter((s) => s > t).length / reais.length;
    const tp = geradas.filter((s) => s > t).length / geradas.length;
    // Youden J: maximiza detecção menos falso positivo, sem favorecer nenhum dos
    // dois lados. Serve de ponto de partida para escolher o limiar.
    const j = tp - fp;
    if (!melhor || j > melhor.j) melhor = { t, fp, tp, j };
    console.log(
      `  ${String(Math.round(t * 100)).padStart(3)}%   ${(fp * 100).toFixed(0).padStart(3)}%` +
      `                ${(tp * 100).toFixed(0).padStart(3)}%`,
    );
  }

  console.log(
    `\nmelhor separação no limiar de ${Math.round(melhor.t * 100)}%: ` +
    `pega ${(melhor.tp * 100).toFixed(0)}% das geradas, acusa ${(melhor.fp * 100).toFixed(0)}% das reais`,
  );
  console.log('\nAtualize TAXAS em src/lib/models/detectorIA.js com estes números.');
}

main().catch((e) => {
  console.error('Falhou:', e.message);
  process.exit(1);
});
