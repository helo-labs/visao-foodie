import { useCallback, useEffect, useRef, useState } from 'react';
import { analisar } from './lib/analyze.js';
import CartaoMetrica from './components/CartaoMetrica.jsx';
import Histograma from './components/Histograma.jsx';
import exemplos from './exemplos.json';
import './App.css';

// TEXTO PROVISÓRIO. A copy da interface é da Heloisa e ainda não foi escrita.
const TEXTO = {
  titulo: 'Visão Foodie',
  subtitulo:
    'Análise de qualidade de foto de comida. Roda inteiramente no navegador, e nenhuma imagem sai do seu dispositivo.',
};

export default function App() {
  const [previa, setPrevia] = useState(null);
  const [analise, setAnalise] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const inputRef = useRef(null);
  const previaRef = useRef(null);

  // Object URLs precisam ser revogados na troca, senão o blob fica retido.
  useEffect(() => () => {
    if (previaRef.current) URL.revokeObjectURL(previaRef.current);
  }, []);

  const processar = useCallback(async (source, urlPrevia) => {
    setCarregando(true);
    setErro(null);
    // Limpa o resultado anterior antes de medir. Mantê-lo na tela faz a nota da
    // foto passada valer como se fosse a da foto nova enquanto a análise corre.
    setAnalise(null);
    try {
      const resultado = await analisar(source);
      if (previaRef.current) URL.revokeObjectURL(previaRef.current);
      previaRef.current = source instanceof Blob ? urlPrevia : null;
      setPrevia(urlPrevia);
      setAnalise(resultado);
    } catch (e) {
      console.error(e);
      setErro('Não consegui ler essa imagem. Tente um arquivo JPEG, PNG ou WebP.');
      setAnalise(null);
      setPrevia(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  const aoEscolherArquivo = useCallback(
    (arquivo) => {
      if (!arquivo) return;
      if (!arquivo.type.startsWith('image/')) {
        setErro('Esse arquivo não é uma imagem.');
        return;
      }
      processar(arquivo, URL.createObjectURL(arquivo));
    },
    [processar],
  );

  return (
    <div className="app">
      <header className="cabecalho">
        <h1>{TEXTO.titulo}</h1>
        <p>{TEXTO.subtitulo}</p>
      </header>

      <div
        className={`zona ${arrastando ? 'ativa' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          aoEscolherArquivo(e.dataTransfer.files?.[0]);
        }}
      >
        <strong>{carregando ? 'Analisando…' : 'Escolha uma foto ou arraste até aqui'}</strong>
        <span>JPEG, PNG ou WebP</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => aoEscolherArquivo(e.target.files?.[0])}
        />
      </div>

      {exemplos.length > 0 && (
        <div className="exemplos">
          <span>Ou teste com</span>
          {exemplos.map((ex) => (
            <button key={ex.arquivo} onClick={() => processar(ex.arquivo, ex.arquivo)}>
              {ex.rotulo}
            </button>
          ))}
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}

      {analise && (
        <div className="resultado">
          <div className="painel previa">
            <img src={previa} alt="Foto analisada" />
            <div className="meta">
              <span>
                {analise.dimensoes.largura} × {analise.dimensoes.altura}
              </span>
              <span>
                medido em {analise.analisadoEm.largura} × {analise.analisadoEm.altura}
              </span>
            </div>
          </div>

          <div>
            <div className="painel">
              <div className={`nota-geral ${analise.resultado.nivel}`}>
                <div className="valor">{analise.resultado.total.toFixed(0)}</div>
                <div className="rotulo">
                  de 100
                  <br />
                  qualidade técnica da foto
                </div>
              </div>
              {analise.resultado.itens.map((item) => (
                <CartaoMetrica key={item.id} item={item} />
              ))}
            </div>

            <div className="painel" style={{ marginTop: 16 }}>
              <Histograma histogram={analise.exposure.histogram} />
            </div>
          </div>
        </div>
      )}

      <p className="aviso">
        Os limiares que convertem cada medida em nota foram calibrados contra 24 fotos
        de prato e 48 versões degradadas com defeito conhecido. A medida de estouro de
        altas luzes é a menos confiável das cinco, porque fundo branco liso ainda a
        influencia, e separá-lo do prato depende da detecção de assunto.
      </p>
    </div>
  );
}
