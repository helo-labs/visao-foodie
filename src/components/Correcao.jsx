import { useEffect, useRef } from 'react';

function desenhar(canvas, buffer) {
  if (!canvas || !buffer) return;
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  const ctx = canvas.getContext('2d');
  // O buffer devolvido pela correção tem a forma de ImageData mas não é um, porque
  // a mesma função roda no Node nos scripts de calibração.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height), 0, 0);
}

export default function Correcao({ original, correcao }) {
  const antesRef = useRef(null);
  const depoisRef = useRef(null);

  useEffect(() => {
    desenhar(antesRef.current, original);
    desenhar(depoisRef.current, correcao?.imagem);
  }, [original, correcao]);

  if (!correcao?.aplicou) {
    return (
      <div className="painel secao">
        <h3>Correção automática</h3>
        <p className="ressalva">
          Nada a corrigir. O contraste e o balanço de branco já estão dentro da faixa
          esperada, e forçar uma correção aqui só pioraria a foto.
        </p>
      </div>
    );
  }

  const feito = [];
  if (correcao.pesos.clahe >= 0.02) {
    feito.push(`equalização adaptativa de contraste a ${(correcao.pesos.clahe * 100).toFixed(0)}%`);
  }
  if (correcao.pesos.branco >= 0.02) {
    feito.push(`remoção de ${(correcao.pesos.branco * 100).toFixed(0)}% da dominante de cor`);
  }

  return (
    <div className="painel secao">
      <h3>Correção automática</h3>
      <div className="antes-depois">
        <figure>
          <canvas ref={antesRef} />
          <figcaption>Original</figcaption>
        </figure>
        <figure>
          <canvas ref={depoisRef} />
          <figcaption>Corrigida</figcaption>
        </figure>
      </div>
      <p className="ressalva">
        Aplicado {feito.join(' e ')}. A intensidade sai do que foi medido, então foto
        que já está boa passa intocada. Foco e áreas estouradas não aparecem aqui
        porque não têm conserto depois da captura.
      </p>
    </div>
  );
}
