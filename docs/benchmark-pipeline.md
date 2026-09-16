# Benchmark do pipeline XML NF-e × EFD ICMS/IPI

**Status: medido, não estimado.** Todos os números abaixo vêm de uma execução
real do código de produção (`parseFile`, `buildDataset`, `reconcile`,
`runAudit`, `LocalStore`) contra fixtures sintéticas geradas para este teste.
Os dados brutos estão em `scripts/benchmark/results.json`, gravados pela
própria execução — nada aqui foi extrapolado sem dizer explicitamente que é
extrapolação.

Ambiente da medição: Node `v22.22.2`, processo único, sem paralelismo do
Vitest (`fileParallelism: false`), sem `--expose-gc` (os deltas de heap abaixo
são aproximados — ver seção *Memória*). Execução em 16/09/2026.

## Como reproduzir

```bash
npm run bench                        # 1.000, 10.000 e 50.000 documentos
BENCHMARK_SIZES=1000 npm run bench   # uma escala só, mais rápido
```

## O que é medido, e o que não é

Cada tamanho gera N vendas de saída própria (NF-e) mais um arquivo de EFD
ICMS/IPI com os N documentos correspondentes escriturados (C100/C170/C190), e
mede, na ordem real do pipeline:

1. **Parsing** — `parseFile` em cada um dos N XML, sequencialmente, mais o
   arquivo da EFD. Sequencial de propósito: é assim que
   `src/lib/pipeline/process.ts` processa hoje, um arquivo por vez.
2. **Normalização** — `buildDataset`, uma vez, sobre todos os payloads.
3. **Reconciliação** — `reconcile(dataset)`.
4. **Regras** — `runAudit`. Como a reconciliação já está em cache (mesmo
   objeto `dataset`), esta etapa mede só o custo das regras em si — do jeito
   que acontece em produção, onde todas as regras de uma auditoria
   compartilham a mesma reconciliação.
5. **Persistência (local)** — `LocalStore.saveDataset` + `replaceFindings`
   (escrita) e `loadDataset` + `listFindings` (releitura), contra um arquivo
   JSON temporário.

**Não medido: persistência via Supabase/PostgREST.** Não há projeto Supabase
nem driver Postgres (`pg`) disponível neste ambiente, e instalar um driver só
para este benchmark ampliaria o escopo desta etapa. Isso importa para a
conclusão sobre síncrono vs. background — ver a seção final.

**Não medido: upload dos arquivos.** A geração das fixtures (montar o XML e o
texto da EFD) fica de fora do tempo medido — no mundo real esse tempo é gasto
uma vez, no computador do auditor, antes do upload, não durante o
processamento da auditoria.

## Resultados

Números exatos de `scripts/benchmark/results.json` (execução única por
tamanho — ver *Limitações*):

| Documentos | Parsing | Normalização | Reconciliação | Regras | Persistência (escrita) | Persistência (releitura) | **Total** |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.000 | 479,9 ms | 3,3 ms | 4,1 ms | 13,7 ms | 58,8 ms | 1,3 ms | **561,0 ms** |
| 10.000 | 3.852,9 ms | 37,4 ms | 38,9 ms | 72,6 ms | 568,0 ms | 0,4 ms | **4.570,1 ms** |
| 50.000 | 19.779,6 ms | 210,7 ms | 251,6 ms | 376,3 ms | 2.755,7 ms | 0,4 ms | **23.374,3 ms** |

Tamanho dos arquivos de entrada e do arquivo local resultante:

| Documentos | EFD de entrada | Arquivo local final (JSON) |
| ---: | ---: | ---: |
| 1.000 | 0,40 MB | 5,04 MB |
| 10.000 | 3,95 MB | 50,32 MB |
| 50.000 | 19,75 MB | 251,63 MB |

### Leitura dos números

- **O parsing domina o tempo total em todas as escalas** — 85,6% do total em
  1.000 documentos, 84,3% em 10.000, 84,6% em 50.000. Escala de forma
  aproximadamente linear: ~0,48 ms/documento em 1.000, ~0,385 ms/documento em
  10.000 e ~0,396 ms/documento em 50.000. A maior parte é o custo fixo de
  `fast-xml-parser` por arquivo, multiplicado por N arquivos — não há indício
  de comportamento quadrático nessas três escalas.
- **Normalização, reconciliação e regras são baratas mesmo em 50.000
  documentos** — juntas somam 838,6 ms, cerca de 3,6% do total. A
  reconciliação por `Map` (chave de acesso → documento) e as regras por
  regime de escopo não mostram sinal de degradação com o volume testado.
- **A persistência local cresce mais rápido que o parsing entre 10.000 e
  50.000** (568,0 ms → 2.755,7 ms, ~4,85×, para 5× mais documentos — ainda
  sublinear, mas a se observar). A causa é conhecida e está no próprio código:
  `LocalStore.persist()` faz `JSON.stringify` do banco inteiro e reescreve o
  arquivo a cada `saveDataset`/`replaceFindings` — duas serializações
  completas de um arquivo que, em 50.000 documentos, já passa de 250 MB. Isso
  é uma característica do adaptador **local** (pensado para desenvolvimento e
  demonstração), não do adaptador Supabase, que grava em lotes (chunks de 500
  linhas) via `insert()` — um padrão diferente, que este benchmark não mede.

### Memória

Os deltas de heap gravados em `results.json` são **aproximados**: sem
`--expose-gc`, o coletor de lixo do V8 pode rodar entre a medição "antes" e
"depois" de forma não determinística — por isso a reconciliação em 50.000
documentos aparece com delta **negativo** (-45,2 MB): não significa que a
etapa liberou memória, significa que o GC rodou no meio da janela medida. O
delta de heap não é um número confiável etapa a etapa; é reportado mesmo
assim, junto com esta ressalva, em vez de omitido.

O número de memória confiável desta medição é outro: **RSS de pico, obtido
por amostragem externa com `ps` a cada 1 segundo durante uma execução
isolada** de 50.000 documentos (processo Vitest + worker Node, medidos
juntos, já que rodam como uma única árvore de processos neste ambiente):

```
MAXRSS_KB=1.762.484   →   1,72 GB de pico
```

Esse número inclui a sobrecarga do próprio framework Vitest (carregamento de
módulos, instrumentação de cobertura desligada, etc.), não só as alocações do
benchmark — é um teto realista para "quanto de RAM este processo usou",
não uma medição isolada da lógica de negócio.

## Quando o processamento síncrono deixa de ser adequado

**Pelos números medidos aqui, o pipeline em si (parsing + normalização +
reconciliação + regras) não é o fator limitante até 50.000 documentos.**
23,4 segundos ficam confortavelmente dentro dos dois limites de tempo já
declarados no código:

- `src/app/api/auditorias/[id]/processar/route.ts`: `maxDuration = 600`
  (10 minutos) — a rota que dispara `processAudit`.
- `src/app/api/arquivos/[id]/inspecao/route.ts`: `maxDuration = 120` — não
  processa a auditoria inteira, mas está no mesmo raciocínio de limite de
  plataforma.

Extrapolando linearmente a partir da razão medida em 50.000 documentos
(23,4 s / 50.000 ≈ 0,468 ms/documento — **isto é extrapolação, não medição**):
para consumir os 600 s do `maxDuration` só nas etapas aqui medidas seriam
necessários da ordem de **1,3 milhão de documentos** — muito acima do volume
anual de NF-e de uma empresa de porte médio a grande.

**O ponto onde o síncrono provavelmente deixa de ser adequado não está nas
etapas medidas aqui — está nas duas que não puderam ser medidas neste
ambiente:**

1. **Upload dos arquivos.** Em produção, cada XML chega por um upload HTTP
   individual antes de `processAudit` sequer começar; N uploads sequenciais
   somam uma latência que este benchmark, ao gerar os arquivos em memória, não
   captura.
2. **Persistência via Supabase/PostgREST.** `SupabaseStore` grava em lotes
   via chamadas de rede (`insert()` em chunks, ver `src/lib/data/supabase-store.ts`).
   Cada lote é uma requisição HTTP com latência de rede real — em 50.000
   documentos, isso significa dezenas a centenas de requisições sequenciais
   para invoices, itens, findings e evidências. Sem um projeto Supabase
   disponível para medir, não há como transformar isso em um número sem
   inventá-lo — e este relatório se recusa a fazer isso.

**Recomendação concreta:** antes de decidir o limite exato para mover
`processAudit` para um worker em segundo plano, instrumentar a mesma
decomposição em estágios (já pronta neste benchmark, reaproveitável) contra um
projeto Supabase real, com uma competência de tamanho representativo. Só isso
permite medir o estágio que realmente falta. Até lá, a recomendação
operacional é: **se uma auditoria demorar mais que alguns segundos para
processar em produção, o gargalo quase certamente está na gravação via
Supabase ou no upload, não no pipeline em memória** — e é ali que a primeira
otimização (lotes maiores, gravação paralela de invoices/findings, ou
finalmente um worker) deve mirar, não no parser nem nas regras.

## Limitações desta medição

- Roda em uma única máquina, uma única vez por tamanho — não é uma média de
  múltiplas execuções nem reporta desvio padrão. Números absolutos variam
  conforme a máquina e entre execuções (uma segunda execução completa, feita
  para conferir estabilidade, produziu 561,0 ms / 4.570,1 ms / 23.374,3 ms
  contra 559,6 ms / 4.480 ms / 22.090 ms da execução anterior — variação de
  1 a 6%, consistente com ruído de medição, não com uma tendência). A ordem
  de grandeza e as proporções entre etapas são o que importa.
- Os documentos sintéticos são uniformes (uma saída própria por documento,
  sem mistura de entradas, cancelamentos, devoluções ou tributos da reforma
  em volume). Uma competência real tem composição mais heterogênea; a
  reconciliação por `Map` não deve ser sensível a isso, mas não foi testada
  sob essa variação em escala.
- Não mede o parser de EFD-Contribuições nem PGDAS-D, fora do escopo desta
  etapa.
