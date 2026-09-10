# Visão Foodie

Você escolhe uma foto de comida e ela responde três coisas.

1. **Que prato é este**, por reconhecimento sem treino
2. **A foto está boa**, com nota de 0 a 100 e o que corrigir
3. **Tem cara de IA**, como escala e não como veredito

Roda inteiramente no navegador. Não existe servidor. A imagem é lida em um
`<canvas>`, medida ali e descartada, e nenhum byte sai do dispositivo. Os modelos
vêm do CDN do Hugging Face, e o mesmo CLIP serve o reconhecimento do prato e o
indicador de cara de IA, então o segundo sai de graça.

> A apresentação do projeto, com descrição curta, posicionamento e texto da
> página inicial, ainda não foi escrita. O que está aqui descreve só o
> funcionamento.

## Qualidade da foto

Cinco métricas, todas de visão computacional clássica em JS puro sobre
`ImageData`, sem biblioteca de visão e sem modelo.

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

## Que prato é este

Reconhecimento por CLIP, sem treino. A lista de pratos é passada como texto e o
modelo pontua a foto contra cada um, então trocar a lista muda o que ele
reconhece sem retreinar nada.

Cada prato tem nome em português, que aparece na tela, e uma descrição em inglês,
que é o que vai para o modelo. O CLIP foi treinado majoritariamente em texto
inglês, e nome próprio de prato brasileiro sozinho diz pouco a ele, então a
descrição descreve o que se vê em vez de nomear.

Medido contra as 24 fotos de prato com nome conhecido do conjunto de referência,
usando os próprios nomes como candidatos: **acerta 54% em primeiro lugar e 75%
entre os três primeiros, contra 4% de acaso**. Os erros se concentram em prato de
nome regional que o modelo não viu no treino.

## Cara de IA

Indicador contínuo do quanto a imagem parece boa demais para ser real. **Não diz
se a imagem foi gerada**, e a diferença não é rodeio.

O CLIP compara a foto com descrições de estilo, umas de foto de câmera e outras
de imagem gerada e render, e o indicador é o peso que fica do lado sintético.
Custa zero download extra, porque o CLIP já é carregado para reconhecer o prato.

Medido em 74 fotos reais contra 93 imagens geradas, a mediana fica em 32 para
foto de celular, 78 para foto de catálogo e 81 para imagem gerada.

Foto de catálogo pontuar junto com imagem gerada não é defeito da medida, é o que
ela mede. As duas são brilhantes e perfeitas demais. Nenhuma formulação de texto
testada separou as duas coisas: todo candidato que derrubava a foto de estúdio
derrubava a imagem gerada junto, e a separação caía de 58 para 34 pontos.

Como evidência de apoio, ficam os metadados EXIF e o espectro de frequência.

## Por que não um detector de verdade

Esta parte é o resultado principal do projeto, e é um resultado negativo.

**Três detectores prontos, medidos no mesmo conjunto:**

| modelo | tamanho | acusa foto real | pega gerada |
|---|---|---|---|
| SMOGY-Ai-images-detector | 50MB | 67% | (inutilizável) |
| ai-vs-human-SigLIP | 84MB | 0% | 23% |
| Organika/sdxl-detector | 337MB | 8% | 53% |

O único que presta pesa 337MB, que ninguém espera baixar numa página. O mais
óbvio da categoria acusa dois terços das fotos reais de serem geradas, e a
suspeita é que foto de catálogo, lisa e bem iluminada, caia no que ele aprendeu
como sintético.

**Depois disso, treinei um classificador próprio** sobre os embeddings do CLIP, o
que resolveria o tamanho de uma vez, já que uma regressão logística de 512 pesos
ocupa poucos KB. Real vindo do Food-101, gerado vindo do DiffusionDB, classes
equilibradas, regularização escolhida por validação.

| | acusa foto real | pega gerada |
|---|---|---|
| validação, mesmas fontes | 0% | 96% |
| teste com fontes de fora | **79%** | 95% |

O modelo não aprendeu a distinguir IA de foto. Aprendeu a distinguir **Food-101
de DiffusionDB**, ou seja, os datasets. Em imagem de fora ele acusa quatro em cada
cinco fotos reais.

Sem o teste com fontes que o modelo nunca viu, esse classificador teria sido
publicado com "96% de acurácia" no README.

O que faltou não foi volume, foi **diversidade de fontes**. Um lado real vindo de
uma origem só e um lado gerado vindo de outra dão ao classificador um atalho mais
fácil que o problema de verdade. Corrigir isso exige real de várias origens e
gerado de vários geradores, com pelo menos um gerador inteiro fora do treino, e
imagem de comida gerada é escassa: nos datasets públicos que consegui varrer, ela
é menos de 1% do conteúdo.

Daí a escolha final. Como a pergunta não precisava de veredito, medir estilo com
o CLIP entrega um indicador honesto e de graça, em vez de um classificador que
finge certeza.

## Reprodutibilidade

```bash
node scripts/baixar-fotos.mjs        # exemplos e conjunto de referência
node scripts/calibrar.mjs            # métricas de qualidade
node scripts/baixar-geradas.mjs 6000 # imagens geradas, filtradas por CLIP
node scripts/baixar-treino.mjs 900   # conjunto de treino, exige token do HF
node scripts/treinar-detector.mjs    # treina e mede o classificador descartado
node scripts/avaliar-detector.mjs    # mede um detector pronto qualquer
```

`fotos-calibracao/` fica fora do controle de versão e é recriável pelos scripts.

## Limitações conhecidas

- **Cara de IA não separa foto de catálogo de imagem gerada**, e a interface diz
  isso no lugar onde o número aparece.
- **O reconhecimento erra prato de nome regional**, que o CLIP não viu no treino.
  A lista de pratos é editável e define o que a ferramenta consegue reconhecer.
- **Estouro de altas luzes é a métrica de qualidade mais fraca das cinco.** O
  recorte central ajuda, mas fundo branco liso ainda influencia.
- **O conjunto de referência é pequeno**, com 24 fotos de prato, e vem de um
  catálogo, não de fotos de celular de restaurante.

## Imagens

As fotos de exemplo em `public/exemplos/` vêm do Openverse sob licença Creative
Commons. Autoria e licença de cada uma estão em `public/exemplos/CREDITOS.md`.
As versões degradadas derivam da foto base e herdam a mesma licença.
