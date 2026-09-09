# Visão Foodie

Análise de qualidade técnica de foto de comida. Você escolhe uma foto e ela
devolve uma nota de 0 a 100, o que está errado e o que fazer para melhorar.

Roda inteiramente no navegador. Não existe servidor. A imagem é lida em um
`<canvas>`, medida ali e descartada, e nenhum byte sai do dispositivo.

> A apresentação do projeto, com descrição curta, posicionamento e texto da
> página inicial, ainda não foi escrita. O que está aqui descreve só o
> funcionamento.

## O que é medido

Cinco métricas, todas de visão computacional clássica, sem modelo treinado.

| Métrica | Como é medida |
|---|---|
| **Nitidez** | Variância do Laplaciano na região mais nítida da imagem |
| **Exposição** | Brilho médio e pixels perdidos no preto ou no branco, na região central |
| **Contraste** | Amplitude do canal L (LAB) entre os percentis 5 e 95 |
| **Saturação** | Croma médio em LAB |
| **Dominante de cor** | Desvio do neutro medido só nos pixels de menor croma |

### Decisões que não são óbvias

**Tudo é medido em LAB, não em RGB.** Em RGB a distância numérica entre duas
cores não corresponde ao quanto o olho as vê como diferentes. LAB é
perceptualmente uniforme, então contraste e saturação medidos nele batem com o
que a pessoa percebe.

**A nitidez é medida por blocos, não na imagem inteira.** Foto boa de comida tem
fundo desfocado de propósito. Se o fundo ocupa metade do quadro, ele derruba a
variância global e a foto é acusada de tremida sem ser. O código divide a imagem
em 64 blocos e fica com o percentil 90, de modo que só é considerada borrada a
foto em que nem a parte mais nítida tem borda definida.

**A imagem é redimensionada antes de medir.** A variância do Laplaciano escala
com a resolução, então uma foto de 4000px levemente tremida pontua acima de uma
de 800px perfeitamente nítida. Sem normalizar o lado maior para 1024px, o score
vira ruído.

**A nitidez usa escala logarítmica.** Nas fotos boas do conjunto de referência
ela varia de cerca de 200 a cerca de 7000, três ordens de grandeza. Numa rampa
linear tudo acima de mil satura em 100 e as diferenças que importam ficam
espremidas perto de zero.

**A dominante de cor ignora a comida.** A hipótese do mundo cinza aplicada à
imagem inteira não serve aqui. Ela pressupõe uma cena de cores variadas que se
anulam na média, e um prato de comida não é isso, é marrom, vermelho e amarelo.
Medida assim, foto boa acusa dominante altíssima, com mediana 22,6 contra um
limiar de reprovação de 18, ou seja a métrica estaria medindo que comida é quente
de cor. A saída é olhar só para os pixels de menor croma, que deveriam ser
neutros, como prato, toalha e fundo. Com isso a mediana das fotos boas cai para
4,9.

**O clipping é medido na região central.** No quadro inteiro, foto boa com fundo
branco de catálogo chega a 34% dos pixels em 255, mais do que uma foto
propositalmente estourada, que dá 26%. Os grupos se sobrepõem e a métrica não
separa nada. Como o prato fica no meio e o fundo nas bordas, medir só o miolo
resolve sem precisar detectar o assunto, com 2,1% nas boas contra 28,9% nas
estouradas.

**O pior defeito limita a nota, mas nem todo defeito pesa igual.** Uma média
ponderada simples perdoa demais, e uma foto borrada a ponto de ser inutilizável
tira 58 nela. Mas aplicar o mesmo teto a tudo também erra, porque derruba para 50
uma foto boa que só tem dominante amarelada, como se estivesse tremida. Os
defeitos são de duas naturezas.

- **Irrecuperáveis** (foco, exposição) se perderam na captura e a foto precisa
  ser refeita. Teto duro.
- **Corrigíveis** (cor, contraste, saturação) se resolvem na edição. Teto mais
  alto, o bastante para a foto não passar de "atenção" sem desabar para "ruim".

## Calibração

Os limiares não foram chutados. `scripts/baixar-fotos.mjs` monta um conjunto de
referência com 24 fotos de prato do TheMealDB e 48 versões degradadas com defeito
conhecido e intensidade controlada, entre desfoque, subexposição, estouro, baixo
contraste, dessaturação e dominante. Como o defeito é introduzido de propósito,
existe gabarito.

`scripts/calibrar.mjs` roda **as mesmas funções de medição que rodam no
navegador**, fora dele. As métricas recebem um `{ data, width, height }`, que é a
forma de um `ImageData`, e só o carregamento é específico do navegador. No script
o `sharp` faz esse papel. Nada é reimplementado, então um número errado no script
é um número errado no site.

Separação obtida com os limiares atuais.

| Grupo | Nota média |
|---|---|
| fotos boas | 86,6 |
| amarelada | 69,2 |
| estourada | 67,1 |
| dessaturada | 60,0 |
| lavada | 51,4 |
| tremida (leve) | 45,4 |
| escura | 42,3 |
| tremida (forte) | 40,0 |
| muito escura | 27,4 |

## Limitações conhecidas

- **Estouro de altas luzes é a métrica mais fraca das cinco.** O recorte central
  ajuda, mas fundo branco liso ainda influencia. A separação correta exige
  localizar o prato.
- **O gabarito das degradações não é perfeito.** "Estourada" multiplica o brilho
  por 2,6, e aplicado a uma foto originalmente subexposta o resultado pode ficar
  melhor que o original. Parte desse grupo provavelmente não é foto ruim.
- **O conjunto de referência é pequeno**, com 24 fotos, e vem de um catálogo, não
  de fotos de celular de restaurante, que é o caso de uso real.
- **A ferramenta não sabe que comida está na foto** e não avalia composição,
  apetite ou estilo, só qualidade técnica de captura.

## Rodando

```bash
npm install
npm run dev
```

Para recriar o material fotográfico e recalibrar.

```bash
node scripts/baixar-fotos.mjs   # baixa exemplos e conjunto de referência
node scripts/calibrar.mjs       # mede tudo e imprime a tabela
node scripts/calibrar.mjs ordenar
```

`fotos-calibracao/` fica fora do controle de versão e é recriável pelo script.

## Próximos passos

**Fase 2.** Localizar o prato com Hough Circles para avaliar enquadramento,
correção automática com CLAHE e balanço de branco mostrando antes e depois, e
webcam com nota em tempo real. É onde o `opencv.js` entra. A Fase 1 não precisa
dele, e por isso a página carrega instantânea.

**Fase 3.** Painel de suspeita de imagem gerada por IA, com metadados EXIF,
espectro de frequência e resíduo de ruído. Sinais com explicação, sem veredito.

## Imagens

As fotos de exemplo em `public/exemplos/` vêm do Openverse sob licença Creative
Commons. Autoria e licença de cada uma estão em `public/exemplos/CREDITOS.md`.
As versões degradadas derivam da foto base e herdam a mesma licença.
