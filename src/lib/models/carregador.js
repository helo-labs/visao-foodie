// Carregamento sob demanda dos modelos, direto do CDN do Hugging Face.
//
// Nada é hospedado por nós. Além de não custar nada, isso escapa do limite de 25MB
// por arquivo do Cloudflare Pages, que qualquer um destes pesos estouraria.
//
// Descartado carregar no início da página. São dezenas de megabytes, e quem só
// quer a nota de qualidade da foto não deve pagar esse download.
//
// A própria biblioteca entra por import dinâmico, e não estático. Com import
// estático o empacotador junta o transformers.js ao pacote principal e passa de
// um megabyte, que todo mundo baixaria mesmo sem chegar perto do reconhecimento.
//
// O runtime ONNX também vem do CDN. Empacotado, ele entra no dist como um wasm de
// 23MB, que é quase o limite de 25MB por arquivo do Cloudflare Pages e é peso que
// não precisa sair do nosso lado.
//
// ATENÇÃO: a versão abaixo tem que ser a mesma que o @huggingface/transformers
// declara em onnxruntime-web. Versão diferente carrega um runtime incompatível
// com os artefatos que a biblioteca espera, e a falha aparece só em execução.
// Conferir com:
//   node -e "console.log(require('./node_modules/@huggingface/transformers/package.json').dependencies['onnxruntime-web'])"
const VERSAO_ONNX = '1.26.0-dev.20260416-b7804b056c';

let biblioteca = null;

async function lib() {
  if (!biblioteca) {
    biblioteca = import('@huggingface/transformers').then((m) => {
      m.env.allowLocalModels = false;
      m.env.backends.onnx.wasm.wasmPaths =
        `https://cdn.jsdelivr.net/npm/onnxruntime-web@${VERSAO_ONNX}/dist/`;
      return m;
    });
  }
  return biblioteca;
}

const cache = new Map();

// Uma promessa por modelo, guardada no cache. Chamadas simultâneas para o mesmo
// modelo compartilham o mesmo download em vez de disparar vários.
export function carregar(tarefa, modelo, opcoes = {}) {
  const chave = `${tarefa}:${modelo}`;
  if (!cache.has(chave)) {
    cache.set(
      chave,
      lib()
        .then((m) => m.pipeline(tarefa, modelo, { dtype: 'q8', ...opcoes }))
        .catch((e) => {
        // Sem isso um erro de rede deixaria a promessa falha presa no cache e
        // toda tentativa seguinte falharia sem nem tentar baixar de novo.
          cache.delete(chave);
          throw e;
        }),
    );
  }
  return cache.get(chave);
}

export function jaCarregado(tarefa, modelo) {
  return cache.has(`${tarefa}:${modelo}`);
}
