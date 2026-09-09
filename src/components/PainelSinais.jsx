import { useEffect, useRef } from 'react';

function Espectro({ espectro }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !espectro) return;
    const { magnitude, lado } = espectro;

    // Escala logarítmica. Em escala linear o centro do espectro concentra tanta
    // energia que todo o resto vira preto, e é justamente o resto que interessa.
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

export default function PainelSinais({ sinais }) {
  if (!sinais) return null;
  const { exif, picos, ruido, espectro } = sinais;

  const temCamera = exif.camposDeCamera.length >= 2;
  const estadoExif = exif.gerador ? 'alerta' : temCamera ? 'normal' : 'neutro';

  const estadoPicos = picos.picos > 0 ? 'alerta' : 'normal';

  return (
    <div className="painel secao">
      <h3>Sinais de imagem gerada</h3>
      <p className="ressalva destaque">
        Isto não é um detector e não dá veredito. Detecção confiável de imagem
        gerada é problema em aberto, e o que está aqui são três medidas baratas,
        cada uma com o próprio alcance e as próprias falhas. A conclusão é sua.
      </p>

      <div className="sinais">
        <Sinal titulo="Metadados" estado={estadoExif}>
          {exif.gerador ? (
            <p>
              Os metadados trazem a assinatura de um gerador de imagem
              ({exif.gerador}). É o sinal mais forte que existe aqui.
            </p>
          ) : temCamera ? (
            <p>
              Há metadados de câmera{exif.camera ? ` (${exif.camera})` : ''}, com os
              campos {exif.camposDeCamera.join(', ')}. Isso é boa evidência de que a
              foto saiu de um aparelho de verdade.
            </p>
          ) : (
            <p>
              Não há metadados de câmera. Isso quase não diz nada, porque WhatsApp,
              Instagram e qualquer reenvio removem tudo, e a maior parte das fotos
              reais que circulam chega assim.
            </p>
          )}
        </Sinal>

        <Sinal titulo="Espectro de frequência" estado={estadoPicos} classe="com-espectro">
          <Espectro espectro={espectro} />
          {picos.picos > 0 ? (
            <p>
              {picos.picos} ponto{picos.picos > 1 ? 's' : ''} do espectro
              {picos.picos > 1 ? ' destoam' : ' destoa'} do próprio anel de
              frequência, com o maior chegando a {picos.maiorRazao.toFixed(1)} vezes a
              mediana. Reamostragem periódica, como a de interpoladores de difusão e
              GAN, deixa marca assim.
            </p>
          ) : (
            <p>
              O espectro decai de forma suave, sem picos isolados. É o padrão de foto
              de câmera. Vale lembrar que redimensionar ou recomprimir apaga essa
              assinatura, então a ausência dela não inocenta nada.
            </p>
          )}
        </Sinal>

        <Sinal titulo="Resíduo de ruído" estado="neutro">
          {ruido.disponivel ? (
            <p>
              Ruído de {ruido.ruidoLiso.toFixed(2)} nas áreas lisas contra{' '}
              {ruido.ruidoTexturado.toFixed(2)} nas texturadas, razão{' '}
              {ruido.razao.toFixed(2)}. Sensor de câmera deixa ruído até em área lisa;
              imagem gerada costuma ter essas áreas limpas demais.{' '}
              <strong>
                Sem limiar calibrado.
              </strong>{' '}
              Nas 24 fotos reais de referência esse valor variou de 0,50 a 5,85, e sem
              um conjunto de imagens geradas para comparar não há corte defensável.
              O número está aqui como medida, não como acusação.
            </p>
          ) : (
            <p>Não foi possível medir.</p>
          )}
        </Sinal>
      </div>
    </div>
  );
}
