import { rgbToLab, labChroma } from '../colorSpace.js';

// Contraste, saturação e dominante de cor, tudo medido em LAB.
//
// Contraste aqui é a amplitude do canal L entre os percentis 5 e 95, e não o
// desvio padrão: usar percentis ignora o punhado de pixels extremos que um
// reflexo ou uma sombra dura criam, e mede a faixa tonal que a foto realmente
// ocupa.
//
// Saturação é o croma médio (distância do eixo neutro). Comida dessaturada
// parece requentada, então é métrica de peso num contexto de venda.

// A dominante olha só para os pixels que deveriam ser neutros, os de menor croma
// da imagem, que são prato, toalha e fundo. Se esses estão puxados para um lado,
// existe dominante de verdade. Pixels muito escuros ou estourados ficam de fora
// porque a cor deles é pouco confiável.
//
// Descartada a hipótese do mundo cinza sobre a imagem inteira. Ela pressupõe uma
// cena de cores variadas que se anulam na média, e um prato de comida não é isso,
// é marrom, vermelho e amarelo. Medida assim, foto boa acusa mediana 22,6 de
// dominante no conjunto de calibração, acima do limiar de reprovação. A métrica
// estaria medindo que comida é quente de cor, não que o balanço de branco está
// errado.

const FRACAO_NEUTRA = 0.25; // quartil de menor croma
const L_MIN = 15;
const L_MAX = 95;

// Percentis por histograma, e não por ordenação.
//
// Ordenar as centenas de milhares de amostras de luminância e de croma respondia
// por quase toda a duração da medição de cor. A resolução de um histograma de
// mil posições é folgada para o uso que se faz aqui, que é achar um limiar de
// corte e a amplitude tonal.
const BINS = 1024;

function percentilDeHistograma(hist, total, p, escala) {
  const alvo = total * p;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= alvo) return (i / (hist.length - 1)) * escala;
  }
  return escala;
}

const L_ESCALA = 100;
const CROMA_ESCALA = 150; // croma em LAB raramente passa disso em imagem sRGB

export function measureColor(imageData) {
  const { data } = imageData;
  const total = data.length / 4;

  const lightness = new Float32Array(total);
  const cromas = new Float32Array(total);
  const canalA = new Float32Array(total);
  const canalB = new Float32Array(total);

  const histL = new Uint32Array(BINS);
  const histCroma = new Uint32Array(BINS);

  let sumChroma = 0;
  let candidatos = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
    const c = labChroma(lab);
    lightness[p] = lab.L;
    cromas[p] = c;
    canalA[p] = lab.a;
    canalB[p] = lab.b;
    sumChroma += c;

    const binL = Math.max(0, Math.min(BINS - 1, Math.round((lab.L / L_ESCALA) * (BINS - 1))));
    histL[binL]++;

    // Candidatos a neutro: nem escuros demais, nem estourados.
    if (lab.L >= L_MIN && lab.L <= L_MAX) {
      const binC = Math.max(0, Math.min(BINS - 1, Math.round((c / CROMA_ESCALA) * (BINS - 1))));
      histCroma[binC]++;
      candidatos++;
    }
  }

  let castA = 0;
  let castB = 0;
  let usados = 0;

  if (candidatos > 0) {
    const limite = percentilDeHistograma(histCroma, candidatos, FRACAO_NEUTRA, CROMA_ESCALA);
    for (let p = 0; p < total; p++) {
      if (lightness[p] >= L_MIN && lightness[p] <= L_MAX && cromas[p] <= limite) {
        castA += canalA[p];
        castB += canalB[p];
        usados++;
      }
    }
    if (usados > 0) {
      castA /= usados;
      castB /= usados;
    }
  }

  const p95 = percentilDeHistograma(histL, total, 0.95, L_ESCALA);
  const p05 = percentilDeHistograma(histL, total, 0.05, L_ESCALA);

  return {
    contrast: p95 - p05, // 0..100
    saturation: sumChroma / total,
    cast: {
      a: castA,
      b: castB,
      strength: Math.sqrt(castA * castA + castB * castB),
      pixelsUsados: usados,
    },
  };
}
