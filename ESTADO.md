# Onde paramos

Última sessão: 09/09/2026.

## O bloqueio

O carregamento dos modelos trava no navegador e foi aí que a sessão parou.

O sintoma engana. Todas as requisições de rede completam com sucesso, incluindo
o `model_quantized.onnx` do CLIP e o wasm do runtime ONNX, e nenhum erro aparece
no console. Mesmo assim a promessa do `pipeline()` nunca resolve, e a seção fica
em "carregando" para sempre.

Diagnóstico até onde chegou:

- Não é rede. O CDN do Hugging Face entrega 10MB em 2,2s por `curl` na mesma
  máquina, e o trace de requisições do navegador mostra tudo em 200 ou 206.
- Não é bloqueador de anúncio. Foi desativado e o comportamento continuou.
- Trava **depois** do download, na criação da sessão do runtime ONNX.

Duas correções aplicadas, com efeito parcial:

1. `env.backends.onnx.wasm.numThreads = 1`, porque o runtime multi-thread depende
   de `SharedArrayBuffer`, que exige isolamento de origem (COOP e COEP) que uma
   página estática não manda. **Isso resolveu o Firefox**, que passou a carregar
   em 90s. O Chromium continuou travando.
2. `device: 'wasm'` fixo no `pipeline()`, para o Chromium não tentar WebGPU e
   pendurar na criação da sessão. **Esta correção não chegou a ser testada.**

## Retomando daqui

1. Testar a correção 2 nos três navegadores. O arquivo é
   `src/lib/models/carregador.js`.
2. Se o Chromium continuar travando, o próximo suspeito é o `dtype: 'q8'` fixo no
   mesmo arquivo. Vale testar `fp32` e `q4`, porque o problema pode estar na
   variante quantizada e não no backend.
3. Terceira hipótese, ainda não investigada: os dois componentes que usam CLIP
   (`Prato.jsx` e `Slop.jsx`) montam juntos e disputam o mesmo carregamento. O
   cache em `carregador.js` deveria fazer os dois compartilharem a mesma
   promessa, mas isso não foi verificado sob concorrência real.

Um limite de 3 minutos já foi posto no carregamento, então hoje a falha aparece
na tela em vez de pendurar. Isso é diagnóstico, não conserto.

## O que funciona

- As cinco métricas de qualidade, com nota, histograma e os cinco exemplos.
  Independem de modelo e nunca falharam.
- O reconhecimento de prato e o indicador de cara de IA, **quando o modelo
  carrega**. Confirmado no Firefox e, antes das últimas mudanças, no Chromium.

## Pendências que não são bug

- A copy da interface e a descrição do repositório no GitHub. Nada disso foi
  escrito, porque é decisão da Heloisa. O texto que está lá é provisório e está
  marcado como tal em `src/App.jsx`.
- Deploy. O projeto nunca foi publicado, então não existe link.
- O token do Hugging Face em `~/.hf-token` acabou entrando no histórico da
  conversa. Vale revogar e gerar outro.
- `dist/` contém um wasm de 23MB que o Vite emite mesmo com o runtime apontado
  para o CDN. Não é baixado por ninguém em execução, mas pesa no deploy.

## O achado principal da sessão

Está no README, na seção "Por que não um detector de verdade", e é um resultado
negativo. Três detectores prontos foram medidos e nenhum serve, e um
classificador treinado sobre os embeddings do CLIP chegou a 96% de acerto na
validação e 79% de falso positivo em fontes de fora. Ele aprendeu a separar
Food-101 de DiffusionDB, ou seja os datasets, e não IA de foto.

Os scripts de treino e avaliação continuam no repositório de propósito, porque a
investigação é o conteúdo do projeto.
