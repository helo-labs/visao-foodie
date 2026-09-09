import { luma } from '../colorSpace.js';

// Resíduo de alta frequência, para medir a textura de ruído da imagem.
//
// Sensor de câmera produz ruído em toda a foto, inclusive nas áreas lisas, como
// uma parede de fundo ou o esmalte de um prato branco. Imagem gerada tende a ter
// essas mesmas áreas limpas demais, porque o ruído dela vem do processo de
// difusão e não de um sensor físico, e o passo final de remoção de ruído apaga o
// que restaria.
//
// O resíduo é a imagem menos a versão borrada dela, o que sobra sendo a alta
// frequência. O que interessa é o resíduo nas regiões LISAS: em região texturada
// o resíduo é dominado pelo detalhe da comida, que existe tanto em foto real
// quanto em imagem gerada e não distingue nada.
//
// Esse sinal também não sobrevive a recompressão agressiva, que suaviza a alta
// frequência de qualquer origem.

const GRADE = 16;
const FRACAO_LISA = 0.25; // quartil de blocos mais lisos

function borrar3x3(cinza, width, height) {
  const saida = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      saida[i] =
        (cinza[i - width - 1] + 2 * cinza[i - width] + cinza[i - width + 1] +
         2 * cinza[i - 1] + 4 * cinza[i] + 2 * cinza[i + 1] +
         cinza[i + width - 1] + 2 * cinza[i + width] + cinza[i + width + 1]) / 16;
    }
  }
  return saida;
}

function desvio(valores) {
  if (valores.length === 0) return 0;
  let soma = 0;
  for (const v of valores) soma += v;
  const media = soma / valores.length;
  let acc = 0;
  for (const v of valores) acc += (v - media) * (v - media);
  return Math.sqrt(acc / valores.length);
}

export function analisarRuido(imageData) {
  const { data, width, height } = imageData;
  const cinza = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    cinza[p] = luma(data[i], data[i + 1], data[i + 2]);
  }

  const suave = borrar3x3(cinza, width, height);
  const residuo = new Float32Array(width * height);
  for (let i = 0; i < cinza.length; i++) residuo[i] = cinza[i] - suave[i];

  const larguraBloco = Math.floor(width / GRADE);
  const alturaBloco = Math.floor(height / GRADE);
  const blocos = [];

  for (let by = 0; by < GRADE; by++) {
    for (let bx = 0; bx < GRADE; bx++) {
      const x0 = bx * larguraBloco;
      const y0 = by * alturaBloco;
      const x1 = Math.min(width - 1, x0 + larguraBloco);
      const y1 = Math.min(height - 1, y0 + alturaBloco);

      const tons = [];
      const res = [];
      for (let y = Math.max(1, y0); y < y1; y++) {
        for (let x = Math.max(1, x0); x < x1; x++) {
          tons.push(cinza[y * width + x]);
          res.push(residuo[y * width + x]);
        }
      }
      if (tons.length === 0) continue;
      blocos.push({ textura: desvio(tons), ruido: desvio(res) });
    }
  }

  if (blocos.length === 0) return { disponivel: false };

  // Blocos mais lisos primeiro, pela variação de tom do próprio bloco.
  blocos.sort((a, b) => a.textura - b.textura);
  const lisos = blocos.slice(0, Math.max(1, Math.floor(blocos.length * FRACAO_LISA)));
  const texturados = blocos.slice(-Math.max(1, Math.floor(blocos.length * FRACAO_LISA)));

  const ruidoLiso = lisos.reduce((a, b) => a + b.ruido, 0) / lisos.length;
  const ruidoTexturado = texturados.reduce((a, b) => a + b.ruido, 0) / texturados.length;

  return {
    disponivel: true,
    ruidoLiso,
    ruidoTexturado,
    // Quanto menor, mais limpas estão as áreas lisas em relação ao resto.
    razao: ruidoTexturado > 0 ? ruidoLiso / ruidoTexturado : 0,
  };
}
