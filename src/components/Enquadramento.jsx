import { useEffect, useRef } from 'react';

// Desenha o círculo detectado sobre a foto.
//
// O enquadramento é mostrado, mas não entra na nota. A detecção acerta o prato em
// cerca de dois terços das fotos de teste, e a confiança calculada não distingue
// acerto de erro, então uma nota tirada dela seria um número inventado. Desenhar o
// círculo deixa a própria pessoa julgar se a leitura fez sentido.
export default function Enquadramento({ src, framing }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !src) return;

    const img = new Image();
    img.onload = () => {
      const largura = canvas.clientWidth;
      const escala = largura / img.width;
      const altura = img.height * escala;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = largura * dpr;
      canvas.height = altura * dpr;
      canvas.style.height = `${altura}px`;

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0, largura, altura);

      if (!framing?.disponivel) return;

      const menorLado = Math.min(largura, altura);
      const cx = framing.centro.x * largura;
      const cy = framing.centro.y * altura;
      const raio = framing.raio * menorLado;

      ctx.strokeStyle = '#25d07a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, raio, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#25d07a';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();

      // Cruz no centro do quadro, para a comparação com o centro do prato ficar visível.
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(largura / 2, 0);
      ctx.lineTo(largura / 2, altura);
      ctx.moveTo(0, altura / 2);
      ctx.lineTo(largura, altura / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    img.src = src;
  }, [src, framing]);

  const observacoes = [];
  if (framing?.disponivel) {
    if (framing.corte > 0.05) {
      observacoes.push(`O prato está cortado na borda do quadro, cerca de ${(framing.corte * 100).toFixed(0)}% do raio ficou de fora.`);
    }
    if (framing.descentralizacao > 0.18) {
      observacoes.push('O prato está bem deslocado do centro do quadro.');
    }
    if (framing.ocupacao < 0.45) {
      observacoes.push('O prato ocupa pouco do quadro. Chegue mais perto ou aproxime o enquadramento.');
    }
    if (framing.ocupacao > 1.1) {
      observacoes.push('O prato ocupa quase todo o quadro e as bordas ficaram apertadas.');
    }
    if (observacoes.length === 0) observacoes.push('Enquadramento sem problema aparente.');
  }

  return (
    <div className="painel secao">
      <h3>Enquadramento</h3>
      <canvas ref={ref} className="tela-enquadramento" />
      {framing?.disponivel ? (
        <>
          <ul className="observacoes">
            {observacoes.map((o) => <li key={o}>{o}</li>)}
          </ul>
          <p className="ressalva">
            Círculo localizado por transformada de Hough. O valor calculado é a fração
            do perímetro esperado que foi coberta por bordas, aqui{' '}
            {framing.confianca.toFixed(2)}, e ele mede o quanto o contorno fecha, não
            se o círculo caiu no prato certo. Nas fotos de teste a detecção acerta o
            prato em cerca de dois terços dos casos, e por isso esta leitura fica fora
            da nota. Confira no desenho se ela faz sentido.
          </p>
        </>
      ) : (
        <p className="ressalva">
          Nenhum prato redondo convincente foi encontrado. Isso é esperado em foto de
          hambúrguer em tábua, marmita ou tigela vista de lado.
        </p>
      )}
    </div>
  );
}
