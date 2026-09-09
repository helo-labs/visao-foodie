// Traduz as medidas brutas em notas de 0 a 100 e num diagnóstico legível.
//
// Os limiares abaixo foram calibrados contra o conjunto de referência
// (24 fotos de prato + 48 versões degradadas com defeito conhecido). Para cada
// métrica, o par [ruim, bom] foi posicionado entre a distribuição das fotos boas
// e a das degradadas. Recalibre com `node scripts/calibrar.mjs` se trocar o
// conjunto.
//
// Percentis observados nas fotos boas, para referência:
//
//   métrica      p10     p50     p90
//   nitidez      207    1317    6475
//   brilho       106     143     171
//   contraste     63      80      89
//   saturação     18      25      39
//   dominante    1,4     4,9    11,5
//   estouro       0,0     0,3     2,1   (região central, em %)
export const LIMIARES = {
  // Escala logarítmica, porque a nitidez das fotos boas varia de ~200 a ~7000,
  // três ordens de grandeza. Rampa linear descartada, já que nela tudo acima de
  // mil satura em 100 e as diferenças que importam, na faixa baixa, ficam
  // espremidas perto de zero.
  nitidez: { ruim: 40, bom: 500 },
  brilho: { min: 60, ideal: [100, 175], max: 215 },
  // Medidos na região central. No quadro inteiro os dois grupos se sobrepõem,
  // porque foto boa com fundo branco chega a 34% de pixels em 255, contra 26% de
  // uma foto propositalmente estourada. No miolo a separação é limpa, com 2,1%
  // nas boas (p90) contra 28,9% nas estouradas.
  estouroAltas: { bom: 0.03, ruim: 0.18 },
  estouroSombras: { bom: 0.03, ruim: 0.15 },
  contraste: { ruim: 30, bom: 65 },
  saturacao: { ruim: 9, bom: 22, excesso: 60 },
  dominante: { bom: 8, ruim: 25 },
};

// Uma foto não pode valer mais que seu pior defeito permite, e os defeitos se
// dividem em duas naturezas.
//
// Irrecuperáveis são foco errado e pixel estourado, que se perdem na captura.
// Nenhuma edição traz de volta e a foto precisa ser refeita, então impõem teto
// duro.
//
// Corrigíveis são dominante de cor, saturação e contraste, que se resolvem na
// edição e são o que a correção automática da Fase 2 conserta. Impõem teto mais
// alto, o bastante para a foto não passar de "atenção" sem desabar para "ruim".
//
// Descartada a média ponderada pura, sem teto nenhum, porque perdoa demais. Uma
// foto borrada a ponto de ser inutilizável tira 58 nela, já que as outras quatro
// métricas continuam boas e carregam a nota.
//
// Descartado também o teto único para toda métrica. Com pesos de 0,10 a 0,15, um
// defeito corrigível zerado custa só 10 a 15 pontos na média, mas sob teto duro
// derruba uma foto boa e amarelada para 50, como se estivesse tremida.
const METRICAS_DE_CAPTURA = ['nitidez', 'exposicao'];

const TETO_BASE = 40;
const TETO_INCLINACAO = 0.6;

const TETO_CORRIGIVEL_BASE = 60;
const TETO_CORRIGIVEL_INCLINACAO = 0.4;

// A mesma regra vale dentro de "Exposição", que é composta de três medidas.
// Sem ela o sinal se dilui. Numa foto com um terço do miolo estourado a nota de
// estouro zera, mas responde por 30% de uma métrica que pesa 30% no total, um
// peso efetivo de 9% que a foto absorve sem sair da faixa boa.
function aplicarTeto(media, pior) {
  return Math.min(media, TETO_BASE + TETO_INCLINACAO * pior);
}

function aplicarTetoCorrigivel(media, pior) {
  return Math.min(media, TETO_CORRIGIVEL_BASE + TETO_CORRIGIVEL_INCLINACAO * pior);
}

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

function rampaCrescente(v, ruim, bom) {
  return clamp(((v - ruim) / (bom - ruim)) * 100);
}

function rampaCrescenteLog(v, ruim, bom) {
  const l = Math.log10(Math.max(v, 1e-3));
  return clamp(((l - Math.log10(ruim)) / (Math.log10(bom) - Math.log10(ruim))) * 100);
}

function rampaDecrescente(v, bom, ruim) {
  return clamp(100 - ((v - bom) / (ruim - bom)) * 100);
}

function faixa(v, min, [idealLo, idealHi], max) {
  if (v >= idealLo && v <= idealHi) return 100;
  if (v < idealLo) return clamp(((v - min) / (idealLo - min)) * 100);
  return clamp(((max - v) / (max - idealHi)) * 100);
}

function nivel(nota) {
  if (nota >= 70) return 'bom';
  if (nota >= 40) return 'atencao';
  return 'ruim';
}

export function avaliar({ sharpness, exposure, color }) {
  const itens = [];

  // --- Nitidez ---
  const notaNitidez = rampaCrescenteLog(
    sharpness.sharpest,
    LIMIARES.nitidez.ruim,
    LIMIARES.nitidez.bom,
  );
  itens.push({
    id: 'nitidez',
    titulo: 'Nitidez',
    nota: notaNitidez,
    nivel: nivel(notaNitidez),
    medida: sharpness.sharpest.toFixed(0),
    explicacao:
      'Variância do Laplaciano na região mais nítida da foto. O Laplaciano responde forte em bordas definidas e quase zero em áreas lisas, então borrão derruba a variância. Medir por blocos e ficar com o mais nítido evita acusar de tremida a foto que só tem fundo desfocado de propósito.',
    conselho:
      notaNitidez >= 70
        ? 'Foco está bom.'
        : 'A foto está borrada. Apoie o celular em algo firme, toque na tela para focar no prato e refaça.',
  });

  // --- Exposição ---
  const notaBrilho = faixa(
    exposure.mean,
    LIMIARES.brilho.min,
    LIMIARES.brilho.ideal,
    LIMIARES.brilho.max,
  );
  const notaAltas = rampaDecrescente(
    exposure.highlightClippedMiolo,
    LIMIARES.estouroAltas.bom,
    LIMIARES.estouroAltas.ruim,
  );
  const notaSombras = rampaDecrescente(
    exposure.shadowClippedMiolo,
    LIMIARES.estouroSombras.bom,
    LIMIARES.estouroSombras.ruim,
  );
  // O clipping pesa mais que o brilho médio: brilho tem conserto na edição,
  // pixel estourado na captura não volta.
  const notaExposicao = aplicarTeto(
    notaBrilho * 0.45 + notaAltas * 0.3 + notaSombras * 0.25,
    Math.min(notaBrilho, notaAltas, notaSombras),
  );

  const escura = exposure.mean < LIMIARES.brilho.ideal[0];
  itens.push({
    id: 'exposicao',
    titulo: 'Exposição',
    nota: notaExposicao,
    nivel: nivel(notaExposicao),
    medida: `média ${exposure.mean.toFixed(0)}`,
    explicacao:
      'Brilho médio, e pixels perdidos no preto absoluto ou no branco estourado dentro da região central. O brilho médio tem conserto na edição; pixel estourado na captura não volta. O clipping é medido no miolo porque fundo branco de catálogo enche o topo do histograma sem que a foto esteja estourada.',
    conselho:
      notaExposicao >= 70
        ? 'Iluminação está bem resolvida.'
        : escura
          ? 'Foto escura. Aproxime-se de uma janela ou acenda mais luz, porque luz natural lateral funciona melhor que flash.'
          : 'Há áreas estouradas de branco. Tire o prato da luz direta ou reduza a exposição antes de fotografar.',
  });

  // --- Contraste ---
  const notaContraste = rampaCrescente(
    color.contrast,
    LIMIARES.contraste.ruim,
    LIMIARES.contraste.bom,
  );
  itens.push({
    id: 'contraste',
    titulo: 'Contraste',
    nota: notaContraste,
    nivel: nivel(notaContraste),
    medida: color.contrast.toFixed(0),
    explicacao:
      'Amplitude do canal L do espaço LAB entre os percentis 5 e 95. Usar percentis em vez do desvio padrão ignora os poucos pixels extremos de um reflexo ou de uma sombra dura, e mede a faixa tonal que a foto realmente ocupa.',
    conselho:
      notaContraste >= 70
        ? 'Boa separação entre claros e escuros.'
        : 'A foto está lavada, tudo no mesmo tom. Luz vinda de um lado só cria sombra e dá volume ao prato.',
  });

  // --- Saturação ---
  const excesso = color.saturation > LIMIARES.saturacao.excesso;
  const notaSaturacao = excesso
    ? clamp(100 - (color.saturation - LIMIARES.saturacao.excesso) * 3)
    : rampaCrescente(color.saturation, LIMIARES.saturacao.ruim, LIMIARES.saturacao.bom);
  itens.push({
    id: 'saturacao',
    titulo: 'Saturação',
    nota: notaSaturacao,
    nivel: nivel(notaSaturacao),
    medida: color.saturation.toFixed(1),
    explicacao:
      'Croma médio em LAB, ou seja o quanto as cores se afastam do cinza. Medido em LAB e não no S do HSV, que exagera a saturação de tons escuros.',
    conselho:
      notaSaturacao >= 70
        ? 'Cores com boa presença.'
        : excesso
          ? 'Cores exageradas, com aparência artificial. Reduza a saturação na edição.'
          : 'Cores apagadas. Confira o balanço de branco e evite fotografar sob luz fluorescente.',
  });

  // --- Dominante de cor ---
  const notaDominante = rampaDecrescente(
    color.cast.strength,
    LIMIARES.dominante.bom,
    LIMIARES.dominante.ruim,
  );
  itens.push({
    id: 'dominante',
    titulo: 'Dominante de cor',
    nota: notaDominante,
    nivel: nivel(notaDominante),
    medida: color.cast.strength.toFixed(1),
    explicacao:
      'Desvio do neutro medido apenas nos pixels de menor croma da imagem, que são prato, toalha e fundo, e deveriam ser cinza. Medir a imagem inteira não funciona, porque comida é marrom, vermelha e amarela por natureza, e a média acusaria dominante em toda foto boa.',
    conselho:
      notaDominante >= 70
        ? 'Cores neutras, sem dominante aparente.'
        : color.cast.b > 8
          ? 'Dominante amarelada, típica de lâmpada quente. Ajuste o balanço de branco.'
          : color.cast.a > 8
            ? 'Dominante avermelhada. Ajuste o balanço de branco.'
            : 'Existe uma dominante de cor na imagem. Ajuste o balanço de branco.',
  });

  const pesos = { nitidez: 0.3, exposicao: 0.3, contraste: 0.15, saturacao: 0.15, dominante: 0.1 };
  const media = itens.reduce((acc, item) => acc + item.nota * pesos[item.id], 0);
  const piorCaptura = Math.min(
    ...itens.filter((i) => METRICAS_DE_CAPTURA.includes(i.id)).map((i) => i.nota),
  );
  const piorCorrigivel = Math.min(
    ...itens.filter((i) => !METRICAS_DE_CAPTURA.includes(i.id)).map((i) => i.nota),
  );

  const total = Math.min(
    aplicarTeto(media, piorCaptura),
    aplicarTetoCorrigivel(media, piorCorrigivel),
  );

  return { total, nivel: nivel(total), media, piorCaptura, piorCorrigivel, itens };
}
