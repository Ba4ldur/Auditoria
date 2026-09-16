# Proposta de regra: `VL_OPR` do registro C190

**Situação: proposta. Nenhuma regra implementada.**
O campo já é lido, gravado e inspecionável. Esta nota existe para que a decisão
de criar — ou não criar — uma regra sobre ele seja tomada com o problema
escrito, e não durante a implementação.

---

## 1. O que o campo é

`VL_OPR` é o valor da operação consolidado no registro analítico C190, por
combinação de CST de ICMS, CFOP e alíquota. Um documento com itens de
tratamentos diferentes gera vários C190, cada um com o seu `VL_OPR`.

Hoje o sistema:

- lê o campo (`efd-icms-ipi/layout.ts`, posição 5 do C190);
- usa-o para ranquear o **CFOP predominante** do documento (`ATT-FIS-006`);
- expõe-o na inspeção do registro, campo a campo, com o nome oficial;
- **não** o compara com nenhum outro valor.

## 2. Qual comparação seria feita

A candidata natural é a **soma dos `VL_OPR` de um documento contra o `VL_DOC` do
seu C100**:

```
Σ VL_OPR (C190 do documento)   ×   VL_DOC (C100 do documento)
```

Uma segunda candidata, mais estreita e provavelmente mais segura, é comparar os
valores por CST/CFOP do C190 com a soma dos itens correspondentes no C170:

```
VL_OPR do C190 (CST, CFOP, alíquota)  ×  Σ VL_ITEM dos C170 com o mesmo CST/CFOP
```

A segunda tem a vantagem de comparar duas declarações da **mesma** grandeza
dentro do mesmo documento, sem depender do que compõe o total.

## 3. Em quais operações

A comparação só faz sentido em documentos escriturados **documento a documento**
(C100 com seus C170/C190). Ficam de fora:

- documentos sem C190 no arquivo;
- documentos escriturados por registros de consolidação, que este parser não lê;
- documentos sem efeito fiscal (`COD_SIT` 02 a 05), já excluídos dos cruzamentos.

A divisão por escopo (saída própria × entrada de terceiro) **não** parece
aplicável aqui: os dois lados da comparação vêm do mesmo declarante, ao
contrário do confronto XML × EFD. Isso precisa ser confirmado.

## 4. Fundamento normativo — o que está confirmado e o que não está

**Confirmado nesta conversa** (Guia Prático da EFD ICMS/IPI 3.2.2, 11/02/2026,
Seção 10): CBS, IBS e IS **não integram o `VL_OPR` do C190**. Como o `VL_DOC` do
C100 tem regra **própria e diferente por exercício** — em 2026 esses tributos
também não o integram, mas a regra geral é que integrem o valor total do
documento —, os dois campos **podem divergir legitimamente a partir de 2027**,
por construção normativa.

Essa é a razão mais forte para não implementar a regra agora: a partir de 2027,
`Σ VL_OPR ≠ VL_DOC` passa a ser o comportamento **esperado** em qualquer
documento com tributos da reforma, e uma regra ingênua acusaria divergência em
todos eles.

**Não confirmado, e necessário antes de implementar:**

1. A definição oficial de `VL_OPR` no Guia Prático em vigor — se corresponde ao
   valor da operação com ou sem despesas acessórias, frete, seguro, descontos e
   IPI. Sem isso, não se sabe se `Σ VL_OPR` deveria igualar `VL_DOC` mesmo antes
   da reforma.
2. Se existe determinação expressa de que a soma dos C190 deva fechar com o
   `VL_DOC`, ou se a validação do PVA é outra.
3. Como a validação oficial do PVA trata o caso — uma regra que o PVA não impõe
   e que o sistema passa a impor produz "divergência" em arquivo aceito pela
   Receita.

## 5. Exceções conhecidas que a regra precisaria absorver

- **Tributos da reforma** (item 4): a partir de 2027, divergência esperada.
- **Documentos complementares** (`COD_SIT` 06/07): escrituram apenas o valor
  complementado, e a composição analítica acompanha.
- **Descontos, frete, seguro e outras despesas**: entram no `VL_DOC` e podem não
  entrar no `VL_OPR`, a depender da definição do item 4.1.
- **IPI**: compõe o total do documento em algumas operações e não em outras.
- **ICMS-ST**: o valor retido compõe o total do documento e não a operação
  própria.
- **Documentos sem C190**: ausência do registro não é divergência de valor.

A lista já mostra que a diferença entre os dois campos tem várias causas
legítimas. Uma regra que as ignore produziria ruído em escala, que é exatamente
o que as fases anteriores corrigiram em `ATT-FIS-004`, `005` e `006`.

## 6. Recomendação

**Não implementar ainda.** A comparação candidata mais promissora é a do item 2,
segunda forma (C190 × C170 dentro do documento), porque não depende da definição
de composição do total. Antes de escrever a regra:

1. confirmar os três pontos do item 4 em fonte oficial;
2. rodar a comparação **em modo observação** sobre arquivos reais, na tela de
   validação técnica, medindo quantos documentos divergiriam e por quê;
3. só então decidir entre regra com natureza `FATO`, regra com natureza
   `INDICIO`, ou nenhuma regra.

O passo 2 é o que esta fase de validação assistida torna possível: com arquivo
real em mãos, a pergunta "quantos documentos divergiriam?" deixa de ser
especulação.

## 7. O que já está pronto para essa investigação

- `VL_OPR` é lido e gravado por documento (`Invoice.cfops` deriva dele).
- A inspeção do C100 mostra o documento com todos os seus C190, campo a campo,
  ao lado da linha original do arquivo.
- A tela de validação técnica lista a contagem de C190 do arquivo.

Falta apenas a comparação — deliberadamente.
