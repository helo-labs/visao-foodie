import { useEffect, useRef, useState } from 'react';
import { medirSlop, FAIXAS, REFERENCIA } from '../lib/models/slop.js';

function Espectro({ espectro }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !espectro) return;
    const { magnitude, lado } = espectro;

    // Escala logarítmica. Em escala linear o centro concentra tanta energia que
    // todo o resto vira preto, e é justamente o resto que interessa.
    let maximo = 0;
    for (let i = 0; i < magnitude.length; i++) {
      const v = Math.log1p(magnitude[i]);
      if (v > maximo) maximo = v;
    }

    canvas.width = lado;
    canvas.height = lado;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(lado, lado);
    for (let i = 0; i < magnitude.length; i++) {
      const v = maximo > 0 ? (Math.log1p(magnitude[i]) / maximo) * 255 : 0;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [espectro]);

  return <canvas ref={ref} className="tela-espectro" />;
}

function Sinal({ titulo, estado, classe = '', children }) {
  return (
    <div className={`sinal ${estado} ${classe}`}>
      <h4>{titulo}</h4>
      {children}
    </div>
  );
}

function estadoExif(sinais) {
  if (!sinais?.exif) return 'neutro';
  if (sinais.exif.gerador) return 'alerta';
  return sinais.exif.camposDeCamera.length >= 2 ? 'normal' : 'neutro';
}

function TextoExif({ exif }) {
  if (!exif) return <p>Não foi possível ler os metadados.</p>;
  if (exif.gerador) {
    return (
      <p>
        Os metadados trazem a assinatura de um gerador ({exif.gerador}). É o sinal
        mais forte que existe aqui.
      </p>
    );
  }
  if (exif.camposDeCamera.length >= 2) {
    return (
      <p>
        Há metadados de câmera{exif.camera ? ` (${exif.camera})` : ''}, com os campos{' '}
        {exif.camposDeCamera.join(', ')}. Boa evidência de foto de aparelho real.
      </p>
    );
  }
  return (
    <p>
      Não há metadados de câmera. Isso quase não diz nada, porque qualquer reenvio
      por rede social remove tudo, e a maior parte das fotos reais chega assim.
    </p>
  );
}

export default function Slop({ fonte, sinais }) {
  const [estado, setEstado] = useState('carregando');
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    if (!fonte) return;
    let vivo = true;
    setEstado('carregando');
    setResultado(null);

    medirSlop(fonte)
      .then((r) => {
        if (!vivo) return;
        setResultado(r);
        setEstado(r.disponivel ? 'pronto' : 'erro');
      })
      .catch(() => vivo && setEstado('erro'));

    return () => {
      vivo = false;
    };
  }, [fonte]);

  const pontuacao = resultado?.pontuacao ?? 0;
  const indiceFaixa = FAIXAS.findIndex((f) => f.rotulo === resultado?.faixa?.rotulo);

  return (
    <div className="painel secao">
      <h3>Cara de IA</h3>

      {estado === 'carregando' && <p className="ressalva">Medindo…</p>}
      {estado === 'erro' && <p className="ressalva">Não consegui medir.</p>}

      {estado === 'pronto' && (
        <>
          <div className="escala">
            <div className="trilho">
              <i style={{ left: `${Math.min(98, Math.max(0, pontuacao * 100))}%` }} />
            </div>
            <div className="faixas">
              {FAIXAS.map((f, i) => (
                <span key={f.rotulo} className={i === indiceFaixa ? 'atual' : ''}>
                  {f.rotulo}
                </span>
              ))}
            </div>
          </div>

          <p className="palpite">
            <strong>{resultado.faixa.rotulo}</strong>
            <span>{(pontuacao * 100).toFixed(0)} de 100</span>
          </p>
          <p className="ressalva">{resultado.faixa.descricao}</p>

          <p className="ressalva destaque">
            Isto <strong>não diz se a imagem foi gerada</strong>. Mede o quanto ela
            parece boa demais para ser real, comparando o estilo dela com descrições
            em texto. Foto de catálogo bem produzida pontua alto junto com imagem
            gerada, porque as duas são brilhantes e perfeitas demais, e nenhuma
            formulação testada separou as duas coisas.
            <br />
            <br />
            Como referência, medido em {REFERENCIA.reais} fotos reais e{' '}
            {REFERENCIA.geradas} imagens geradas: foto de celular fica em torno de{' '}
            {Math.round(REFERENCIA.medianaRealCelular * 100)}, foto de catálogo em{' '}
            {Math.round(REFERENCIA.medianaRealCatalogo * 100)} e imagem gerada em{' '}
            {Math.round(REFERENCIA.medianaGerada * 100)}.
          </p>
        </>
      )}

      <h4 className="subsecao">Evidência de apoio</h4>

      <div className="sinais">
        <Sinal titulo="Metadados" estado={estadoExif(sinais)}>
          <TextoExif exif={sinais?.exif} />
        </Sinal>

        <Sinal
          titulo="Espectro de frequência"
          estado={sinais?.picos?.picos > 0 ? 'alerta' : 'normal'}
          classe="com-espectro"
        >
          <Espectro espectro={sinais?.espectro} />
          {sinais?.picos?.picos > 0 ? (
            <p>
              {sinais.picos.picos} ponto{sinais.picos.picos > 1 ? 's' : ''} destoa
              {sinais.picos.picos > 1 ? 'm' : ''} do próprio anel de frequência.
              Reamostragem periódica, como a de interpoladores de difusão, deixa marca
              assim.
            </p>
          ) : (
            <p>
              Espectro decai de forma suave, sem picos isolados, que é o padrão de foto
              de câmera. Redimensionar ou recomprimir apaga essa assinatura, então a
              ausência dela não inocenta nada.
            </p>
          )}
        </Sinal>
      </div>
    </div>
  );
}
