import { carregar } from './carregador.js';

const MODELO = 'Xenova/clip-vit-base-patch32';

// Indicador de "cara de IA", por comparação de estilo no CLIP.
//
// Não afirma origem, e a diferença não é rodeio. Detecção confiável de imagem
// gerada é problema em aberto, e tudo que foi testado aqui erra demais para
// acusar alguém. Um detector treinado especificamente para isso, com 337MB, pega
// metade das geradas e ainda assim acusa uma foto real a cada doze.
//
// O que dá para medir com honestidade é outra coisa: o quanto a imagem parece boa
// demais para ser real. Isso é estilo, e comparar imagem com descrição de estilo é
// exatamente o que o CLIP faz. Sai de graça, porque o CLIP já é carregado para
// reconhecer o prato.
//
// A consequência a assumir é que foto de catálogo pontua alto junto com imagem
// gerada. Não é defeito da medida, é o que ela mede: as duas são brilhantes e
// perfeitas demais. Separar as duas pelo texto não funcionou. Todo candidato que
// derrubava a foto de estúdio derrubava a imagem gerada junto, e a separação caía
// de 58 para 34 pontos.
//
// Descartado treinar um classificador sobre os embeddings do CLIP, que era o
// plano. Com real vindo do Food-101 e gerado do DiffusionDB, ele chega a 96% de
// acerto na validação e desaba em imagem de fora, acusando 79% das fotos reais de
// serem geradas. Aprendeu a reconhecer o dataset, não a IA.

const DESCRICOES_REAIS = [
  'a real photograph of food taken with a phone camera',
  'a photograph of a meal on a table in a restaurant',
];

const DESCRICOES_SLOP = [
  'a hyperreal AI generated image of food, glossy and too perfect',
  'a 3D render of food, computer generated',
  'a digital illustration of food, artstation style',
];

// Medido em 74 fotos reais (TheMealDB e Food-101) contra 93 imagens geradas
// (Midjourney e DiffusionDB). São as faixas que a interface usa para descrever o
// resultado em palavras, em vez de fingir um corte binário.
export const FAIXAS = [
  {
    ate: 0.35,
    rotulo: 'Cara de foto',
    descricao: 'Tem a irregularidade que se espera de uma imagem de câmera.',
  },
  {
    ate: 0.6,
    rotulo: 'Ambíguo',
    descricao: 'Nem uma coisa nem outra. Foto bem produzida cai bastante nesta faixa.',
  },
  {
    ate: 0.8,
    rotulo: 'Polida demais',
    descricao:
      'Textura e brilho no território onde caem tanto imagem gerada quanto foto de catálogo muito trabalhada.',
  },
  {
    ate: 1.01,
    rotulo: 'No extremo da escala',
    descricao:
      'Pontuação típica de imagem gerada. Foto de catálogo com produção pesada também chega aqui, então isto não é acusação.',
  },
];

export const REFERENCIA = {
  reais: 74,
  geradas: 93,
  medianaRealCelular: 0.32,
  medianaRealCatalogo: 0.78,
  medianaGerada: 0.81,
};

export async function medirSlop(fonte, { aoProgredir } = {}) {
  try {
    const clip = await carregar('zero-shot-image-classification', MODELO, {
      progress_callback: aoProgredir,
    });

    const saida = await clip(fonte, [...DESCRICOES_REAIS, ...DESCRICOES_SLOP]);

    const pontuacao = saida
      .filter((s) => DESCRICOES_SLOP.includes(s.label))
      .reduce((a, b) => a + b.score, 0);

    const faixa = FAIXAS.find((f) => pontuacao < f.ate) ?? FAIXAS[FAIXAS.length - 1];

    return { disponivel: true, pontuacao, faixa };
  } catch (e) {
    return { disponivel: false, erro: String(e?.message ?? e) };
  }
}
