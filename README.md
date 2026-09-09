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

## Enquadramento

O prato é localizado por transformada de Hough para círculos, em dois estágios,
que é a abordagem do `HOUGH_GRADIENT` do OpenCV. Cada pixel de borda vota ao
longo da própria normal do gradiente, num acumulador bidimensional de centros, e
o raio sai depois do histograma de distâncias ao centro escolhido. Descartado o
acumulador em três dimensões, que a 320x240 com 40 raios passaria de dois
milhões de posições.

O passo que decidiu o resultado foi borrar antes do Sobel. Sem isso os gradientes
mais fortes da foto são a textura da comida, que é de alta frequência, e não a
borda do prato, que é uma curva longa e lisa. Os votos se concentravam em
qualquer relevo e a taxa de acerto ficava perto de 5 em 12. Com a gaussiana de
sigma 2,4 subiu para cerca de 8 em 12.

**Esta leitura não entra na nota.** Dois terços de acerto não bastam para julgar o
enquadramento de ninguém, e o valor de confiança calculado mede o quanto o
contorno fecha, não se o círculo caiu no prato certo, então não serve de filtro.
A saída foi desenhar o círculo sobre a foto e deixar a conclusão com quem olha.

## Correção automática

Duas correções, ambas com intensidade decidida pelo que foi medido.

**Equalização adaptativa de contraste (CLAHE)** no canal L do LAB, com blocos de
8 por 8, corte de histograma e interpolação bilinear entre blocos. Descartada a
equalização global, que aplica uma curva só à imagem inteira e estoura o fundo
claro para levantar a comida na sombra. O corte do histograma é o que evita que
um bloco de tom quase uniforme receba uma curva íngreme e vire ruído amplificado,
e a interpolação é o que evita emenda visível entre blocos.

**Balanço de branco** subtraindo a dominante medida nos pixels neutros.
Descartado o white patch, que assume que o pixel mais claro é branco. Num prato
com reflexo especular esse pixel é o brilho da luz, e a correção iria para o lado
errado.

A subtração é parcial, no máximo 80%. Zerar a dominante deixa a comida cinzenta,
porque a luz quente faz parte da aparência que se espera de um prato.

Foto que já está boa passa intocada, e isso é intencional. Aplicar as duas
correções sempre no máximo devolve uma imagem crocante demais, com a textura da
comida exagerada, e correção automática que piora foto boa não serve.

## Sinais de imagem gerada

Três medidas baratas, apresentadas como sinais com explicação, sem veredito.
Detecção confiável de imagem gerada é problema em aberto, e chamar isto de
detector seria mentira.

**Metadados.** O sinal mais barato e o mais informativo. A evidência é
assimétrica e a interface diz isso. Metadado de câmera presente é boa evidência
de foto real. Metadado ausente não é evidência de quase nada, porque qualquer
reenvio por rede social remove tudo.

**Espectro de frequência.** FFT bidimensional radix-2 sobre um recorte central de
256 por 256, com janela de Hann nas duas direções. A janela não é detalhe: sem
ela a descontinuidade entre as bordas do recorte vira uma cruz brilhante no
espectro, que é artefato do corte e seria confundida com assinatura de
reamostragem. Os picos são procurados contra a mediana do próprio anel de
frequência, e não contra a média global, porque o espectro de imagem natural
decai com a distância do centro.

**Resíduo de ruído.** A imagem menos a versão borrada dela, medido nas regiões
lisas, onde o ruído de sensor aparece e o detalhe da comida não atrapalha.

### O que foi verificado e o que não foi

A FFT foi verificada contra padrões sintéticos de resposta conhecida. Ruído
aleatório dá zero picos, grade periódica e senoide disparam, gradiente liso se
comporta como esperado. Nas 24 fotos reais de referência, 23 dão zero picos e a
razão máxima fica entre 3,8 e 5,0, abaixo do limiar de 6. **Uma das 24 dispara um
falso positivo**, com 226 picos e razão 12.

O resíduo de ruído responde na direção certa a um controle, já que um filtro de
mediana derruba o valor medido. Mas o espalhamento entre fotos reais é grande,
de 0,50 a 5,85, e **nenhum limiar foi calibrado para ele**. A interface mostra o
número e diz isso.

**Nada disto foi validado contra imagens realmente geradas**, porque não montei um
conjunto delas. O que existe é a verificação de que as medidas computam o que
deveriam e de como se comportam em foto real. Poder discriminativo é outra
afirmação, e essa eu não posso fazer.

## Câmera ao vivo

Nota em tempo real pela webcam, a cada 350 ms, rodando só as três métricas
básicas. Enquadramento, espectro e correção ficam de fora porque somam algumas
centenas de milissegundos e travariam o vídeo.

## Desempenho

A análise completa leva cerca de 250 ms numa imagem de 1024 por 768, contra 810
ms na primeira versão. Duas mudanças responderam por quase toda a diferença.

**Tabela de 256 entradas para a conversão de gama.** A entrada é um byte, então só
existem 256 resultados possíveis, e a conversão era chamada três vezes por pixel.
Eram mais de dois milhões de `Math.pow` por análise.

**Percentis lidos de histograma em vez de lista ordenada.** Ordenar as centenas de
milhares de amostras de luminância e croma custava mais que todo o resto da
medição somado, e um histograma de mil posições tem resolução folgada para achar
um limiar de corte. A calibração não se move com a troca, ficando em 86,7 contra
86,6 antes.

## Limitações conhecidas

- **A detecção do prato acerta cerca de dois terços das fotos**, e por isso o
  enquadramento é informativo e não entra na nota.
- **Estouro de altas luzes é a métrica mais fraca das cinco.** O recorte central
  ajuda, mas fundo branco liso ainda influencia. A separação correta exige
  localizar o prato de forma confiável.
- **O gabarito das degradações não é perfeito.** "Estourada" multiplica o brilho
  por 2,6, e aplicado a uma foto originalmente subexposta o resultado pode ficar
  melhor que o original. Parte desse grupo provavelmente não é foto ruim.
- **O conjunto de referência é pequeno**, com 24 fotos, e vem de um catálogo, não
  de fotos de celular de restaurante, que é o caso de uso real.
- **Os sinais de imagem gerada não foram validados contra imagens geradas**, e o
  resíduo de ruído não tem limiar calibrado.
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

## Imagens

As fotos de exemplo em `public/exemplos/` vêm do Openverse sob licença Creative
Commons. Autoria e licença de cada uma estão em `public/exemplos/CREDITOS.md`.
As versões degradadas derivam da foto base e herdam a mesma licença.
