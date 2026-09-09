import { useEffect, useRef } from 'react';

// Histograma de luminância. As faixas vermelhas nas pontas marcam as zonas de
// clipping: o que cai ali perdeu informação na captura e não volta na edição.
export default function Histograma({ histogram }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !histogram) return;

    const dpr = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;
    canvas.width = largura * dpr;
    canvas.height = altura * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, largura, altura);

    const estilo = getComputedStyle(document.documentElement);
    const corBarra = estilo.getPropertyValue('--texto-fraco').trim() || '#888';
    const corRisco = estilo.getPropertyValue('--ruim').trim() || '#c0392b';

    // Escala pelo percentil 99 dos bins, não pelo máximo: um único pico enorme
    // (fundo branco liso, por exemplo) achataria todo o resto do gráfico.
    const bins = Array.from(histogram);
    const ordenado = [...bins].sort((a, b) => a - b);
    const teto = ordenado[Math.floor(ordenado.length * 0.99)] || Math.max(...bins) || 1;

    const larguraBin = largura / 256;

    ctx.fillStyle = corBarra;
    ctx.globalAlpha = 0.75;
    bins.forEach((valor, i) => {
      const h = Math.min(1, valor / teto) * (altura - 2);
      ctx.fillRect(i * larguraBin, altura - h, Math.max(larguraBin, 1), h);
    });

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = corRisco;
    ctx.fillRect(0, 0, larguraBin * 5, altura);
    ctx.fillRect(largura - larguraBin * 5, 0, larguraBin * 5, altura);
    ctx.globalAlpha = 1;
  }, [histogram]);

  return (
    <div className="histograma">
      <h3>Histograma</h3>
      <canvas ref={ref} />
      <div className="legenda">
        <span>preto</span>
        <span>branco</span>
      </div>
    </div>
  );
}
