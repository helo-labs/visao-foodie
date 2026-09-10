import { carregar } from './carregador.js';

const MODELO = 'Xenova/clip-vit-base-patch32';

// Reconhecimento do prato por CLIP, sem treino.
//
// Zero-shot: a lista de candidatos abaixo é passada como texto e o modelo pontua
// a imagem contra cada um. Trocar a lista muda o que ele reconhece, sem retreinar
// nada.
//
// Cada prato tem um nome em português, que é o que aparece na tela, e uma
// descrição em inglês, que é o que vai para o modelo. O CLIP foi treinado
// majoritariamente em texto inglês, e nome próprio de prato brasileiro sozinho
// diz pouco a ele. A descrição é o que dá alguma chance, porque descreve o que se
// vê no lugar de nomear.
//
// LISTA PROVISÓRIA. Ela define o que a ferramenta consegue reconhecer, então é
// decisão de produto e não de código, e está aqui só para o projeto rodar.
export const PRATOS = [
  // Brasil
  { nome: 'Feijoada', prompt: 'feijoada, a Brazilian black bean and pork stew served with rice' },
  { nome: 'Coxinha', prompt: 'coxinha, a Brazilian teardrop shaped fried chicken croquette' },
  { nome: 'Pão de queijo', prompt: 'pao de queijo, small round Brazilian cheese bread rolls' },
  { nome: 'Açaí na tigela', prompt: 'acai bowl, a purple frozen berry pulp in a bowl with granola and banana' },
  { nome: 'Moqueca', prompt: 'moqueca, a Brazilian fish and coconut milk stew in a clay pot' },
  { nome: 'Tapioca', prompt: 'tapioca crepe, a white cassava starch pancake folded with filling' },
  { nome: 'Brigadeiro', prompt: 'brigadeiro, small Brazilian chocolate fudge balls covered in sprinkles' },
  { nome: 'Picanha', prompt: 'picanha, grilled Brazilian rump cap beef sliced on a board' },
  { nome: 'Pastel', prompt: 'pastel, a Brazilian deep fried rectangular pastry turnover' },
  { nome: 'Farofa com arroz e feijão', prompt: 'a Brazilian plate of rice, beans and toasted cassava flour farofa' },

  // Comuns em delivery
  { nome: 'Hambúrguer', prompt: 'a hamburger with a bun, patty and toppings' },
  { nome: 'Pizza', prompt: 'a pizza with melted cheese and toppings' },
  { nome: 'Sushi', prompt: 'sushi rolls and nigiri on a plate' },
  { nome: 'Batata frita', prompt: 'a portion of french fries' },
  { nome: 'Salada', prompt: 'a fresh green salad with vegetables' },
  { nome: 'Massa', prompt: 'a plate of pasta with sauce' },
  { nome: 'Sanduíche', prompt: 'a sandwich with bread and filling' },
  { nome: 'Sopa', prompt: 'a bowl of soup' },
  { nome: 'Frango grelhado', prompt: 'grilled chicken on a plate' },
  { nome: 'Peixe', prompt: 'a cooked fish fillet on a plate' },
  { nome: 'Curry', prompt: 'a curry stew with rice' },
  { nome: 'Taco ou burrito', prompt: 'tacos or a burrito with tortilla' },
  { nome: 'Panqueca', prompt: 'a stack of pancakes' },
  { nome: 'Bolo', prompt: 'a slice of cake or a whole cake' },
  { nome: 'Torta', prompt: 'a pie or tart with a pastry crust' },
  { nome: 'Pão', prompt: 'bread loaves or bread rolls' },
  { nome: 'Sobremesa gelada', prompt: 'ice cream or a frozen dessert' },
  { nome: 'Café', prompt: 'a cup of coffee' },
  { nome: 'Ovos', prompt: 'cooked eggs, fried or scrambled' },
  { nome: 'Churrasco', prompt: 'grilled meat and barbecue on a grill' },
  { nome: 'Arroz', prompt: 'a plate of cooked rice with side dishes' },
  { nome: 'Camarão', prompt: 'shrimp or prawns on a plate' },
  { nome: 'Legumes assados', prompt: 'roasted vegetables on a tray' },
  { nome: 'Queijos e frios', prompt: 'a cheese and charcuterie board' },
  { nome: 'Doce árabe', prompt: 'baklava or a middle eastern nut pastry with syrup' },
  { nome: 'Homus ou pasta árabe', prompt: 'hummus or a middle eastern dip with pita bread' },
];

// Serve para dizer "isto não parece comida" em vez de forçar um prato.
const NAO_COMIDA = [
  { nome: 'Não parece comida', prompt: 'a photo of a person, an object, a landscape or an animal, not food' },
];

export async function reconhecerPrato(fonte, { aoProgredir, lista = PRATOS } = {}) {
  const candidatos = [...lista, ...NAO_COMIDA];
  const clip = await carregar('zero-shot-image-classification', MODELO, {
    progress_callback: aoProgredir,
  });

  const saida = await clip(fonte, candidatos.map((c) => c.prompt));
  const porPrompt = new Map(candidatos.map((c) => [c.prompt, c.nome]));

  const ordenado = saida
    .map((s) => ({ nome: porPrompt.get(s.label) ?? s.label, prompt: s.label, score: s.score }))
    .sort((a, b) => b.score - a.score);

  const topo = ordenado[0];
  return {
    topo,
    // A margem para o segundo colocado importa mais que o score absoluto: CLIP
    // distribui probabilidade entre os candidatos, então o valor de topo cai só
    // por haver muitos pratos parecidos na lista.
    margem: ordenado.length > 1 ? topo.score - ordenado[1].score : topo.score,
    ehComida: topo.nome !== NAO_COMIDA[0].nome,
    alternativas: ordenado.slice(0, 5),
  };
}
