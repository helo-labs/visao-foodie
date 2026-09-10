import { useEffect, useState } from 'react';
import { reconhecerPrato } from '../lib/models/comida.js';

// O modelo tem dezenas de megabytes e é baixado na primeira vez. O progresso
// aparece na tela porque uma seção parada sem explicação por vinte segundos é
// indistinguível de uma seção quebrada.
export default function Prato({ fonte }) {
  const [estado, setEstado] = useState('carregando');
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState(null);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    if (!fonte) return;
    let vivo = true;
    setEstado('carregando');
    setResultado(null);
    setProgresso(0);
    setErro(null);

    reconhecerPrato(fonte, {
      aoProgredir: (p) => {
        if (vivo && p.status === 'progress' && p.progress != null) {
          setProgresso(Math.round(p.progress));
        }
      },
    })
      .then((r) => {
        if (!vivo) return;
        setResultado(r);
        setEstado('pronto');
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(String(e?.message ?? e));
        setEstado('erro');
      });

    return () => {
      vivo = false;
    };
  }, [fonte]);

  if (estado === 'carregando') {
    return (
      <div className="painel secao">
        <h3>Que prato é este</h3>
        <p className="ressalva">
          Baixando o modelo{progresso > 0 ? ` (${progresso}%)` : ''}. Só na primeira
          vez, depois fica no cache do navegador.
        </p>
      </div>
    );
  }

  if (estado === 'erro' || !resultado) {
    return (
      <div className="painel secao">
        <h3>Que prato é este</h3>
        <p className="ressalva">
          Não consegui carregar o modelo de reconhecimento{erro ? `: ${erro}` : '.'}
        </p>
      </div>
    );
  }

  const { topo, alternativas, ehComida, margem } = resultado;
  // Margem pequena quer dizer que o segundo colocado quase empatou, e nesse caso
  // afirmar o primeiro seria falsa precisão.
  const inseguro = margem < 0.08;

  return (
    <div className="painel secao">
      <h3>Que prato é este</h3>

      {ehComida ? (
        <>
          <p className="palpite">
            <strong>{topo.nome}</strong>
            <span>{(topo.score * 100).toFixed(0)}%</span>
          </p>
          {inseguro && (
            <p className="ressalva">
              O segundo colocado ficou muito perto, então trate como palpite fraco.
            </p>
          )}
          <ul className="alternativas">
            {alternativas.slice(1, 4).map((a) => (
              <li key={a.prompt}>
                {a.nome} <span>{(a.score * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="palpite">
          <strong>Não parece comida</strong>
        </p>
      )}

      <p className="ressalva">
        Reconhecimento sem treino, comparando a foto com uma lista de pratos escrita
        em texto. Trocar a lista muda o que ele reconhece. Medido contra 24 fotos de
        prato com nome conhecido, acerta 54% em primeiro lugar e 75% entre os três
        primeiros, contra 4% de acaso. Erra mais em prato de nome regional, que o
        modelo não viu no treino.
      </p>
    </div>
  );
}
