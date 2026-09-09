import { useCallback, useEffect, useRef, useState } from 'react';
import { analisar } from '../lib/analyze.js';

// Nota ao vivo pela câmera.
//
// Roda só as três métricas básicas, no modo rápido. Enquadramento, espectro e
// correção somam algumas centenas de milissegundos e travariam o vídeo, além de
// não terem uso enquanto a pessoa ainda está procurando o ângulo.
const INTERVALO = 350;

export default function Webcam({ aoFechar }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [nota, setNota] = useState(null);
  const [erro, setErro] = useState(null);
  const rodando = useRef(true);

  useEffect(() => {
    let stream = null;
    rodando.current = true;

    async function iniciar() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
          audio: false,
        });
        if (!rodando.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        medir();
      } catch (e) {
        setErro(
          e?.name === 'NotAllowedError'
            ? 'Permissão de câmera negada.'
            : 'Não consegui abrir a câmera neste dispositivo.',
        );
      }
    }

    async function medir() {
      if (!rodando.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        try {
          const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
          if (blob) {
            const r = await analisar(blob, { completo: false });
            if (rodando.current) setNota(r.resultado);
          }
        } catch {
          // Quadro perdido não interrompe o laço.
        }
      }
      if (rodando.current) setTimeout(medir, INTERVALO);
    }

    iniciar();

    return () => {
      rodando.current = false;
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const fechar = useCallback(() => {
    rodando.current = false;
    aoFechar();
  }, [aoFechar]);

  return (
    <div className="painel secao webcam">
      <div className="linha-titulo">
        <h3>Câmera ao vivo</h3>
        <button className="botao-texto" onClick={fechar}>Fechar</button>
      </div>

      {erro ? (
        <p className="erro">{erro}</p>
      ) : (
        <div className="webcam-area">
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} hidden />
          {nota && (
            <div className={`selo ${nota.nivel}`}>
              <strong>{nota.total.toFixed(0)}</strong>
              <span>
                {nota.itens
                  .filter((i) => i.nivel !== 'bom')
                  .map((i) => i.titulo)
                  .join(', ') || 'tudo certo'}
              </span>
            </div>
          )}
        </div>
      )}
      <p className="ressalva">
        Mede nitidez, exposição e cor a cada {INTERVALO} ms. Enquadramento, espectro e
        correção ficam de fora aqui porque são pesados demais para tempo real.
      </p>
    </div>
  );
}
