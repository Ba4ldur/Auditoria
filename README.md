# ATTIVARE AUDITOR

Motor de auditoria e cruzamento automatizado de obrigações fiscais, tributárias,
contábeis e trabalhistas.

O sistema recebe os arquivos que a empresa entregou ou utilizou, transforma cada
um deles em um **modelo normalizado** e executa regras de auditoria sobre esse
modelo. Toda ocorrência apontada mostra **de onde veio cada valor comparado**.

---

## 1. Objetivo

Identificar, a partir dos arquivos apresentados:

- documentos não escriturados;
- documentos escriturados sem arquivo de origem;
- diferenças de faturamento;
- diferenças de base de cálculo e de impostos;
- diferenças de valores entre declarações;
- inconsistências cadastrais;
- divergências entre períodos;
- possíveis erros de escrituração;
- riscos fiscais;
- obrigações incompatíveis entre si.

### Fato apurado × conclusão tributária

Esta é a premissa central do produto e está implementada no modelo de dados, não
apenas na documentação. Toda ocorrência carrega um campo `nature`:

| Natureza | Significado |
| --- | --- |
| `FATO` | Determinado integralmente pelos arquivos. Exemplo: a chave da NF-e consta no XML e não consta em nenhum registro C100 da EFD entregue. |
| `INDICIO` | Diferença aritmética cujo significado tributário depende da natureza da operação e exige análise humana. Exemplo: faturamento somado dos documentos diferente da receita declarada. |

Ocorrências de qualquer natureza podem trazer `humanReviewNote`, que declara
explicitamente o que o sistema **não** é capaz de concluir sozinho. Cada regra
também publica o campo `limitacoes`, exibido na tela *Regras de Auditoria*.

O sistema não infere legislação nem cria tratamento fiscal. Onde uma decisão
depende de interpretação (por exemplo, quais CFOPs compõem a receita bruta), o
comportamento é **parametrizável** e o padrão é não excluir nada, apresentando a
composição utilizada.

---

## 2. Obrigações suportadas

Implementadas neste release:

| Obrigação | Formato | Observações |
| --- | --- | --- |
| NF-e (modelo 55) | `.xml`, `.zip` | Layouts 3.10 e 4.00 |
| NFC-e (modelo 65) | `.xml`, `.zip` | Detectada pelo campo `mod` |
| EFD ICMS/IPI | `.txt` | Registros 0000, 0005, 0100, 0150, 0190, 0200, C100, C170, C190, C195, C197, E100, E110, E111 |
| EFD-Contribuições | `.txt` | Registros 0000, 0110, 0140, 0150, 0200, A100, C100, C170, C175, F100, M200, M600 |
| PGDAS-D | `.pdf` textual | Sem OCR; campos não identificados são sinalizados, nunca inventados |

Previstas na arquitetura (declaradas em `src/lib/domain/sources.ts`, sem parser
ainda): eSocial, EFD-Reinf, DCTFWeb, MIT, DARF, ECD, ECF, Balancete, Razão,
Folha de pagamento, NFS-e, CT-e, MDF-e e extratos bancários.

---

## 3. Arquitetura

A lógica de auditoria não vive em componentes React e não conhece formato de
arquivo. As camadas são independentes e se comunicam apenas pelo modelo
normalizado.

```
 upload  ──►  parsers  ──►  normalização  ──►  motor de regras  ──►  resultado
   │             │                │                   │                  │
   │             │                │                   │                  └─ relatórios
   │             │                │                   └─ score, evidências, rastreabilidade
   │             │                └─ direção da operação, deduplicação, dataset
   │             └─ XML · ZIP · SPED · PDF  →  Invoice / RevenueRecord / TaxRecord / Declaration
   └─ validação, hash SHA-256, identificação de CNPJ e competência
```

| Camada | Diretório | Responsabilidade |
| --- | --- | --- |
| Núcleo | `src/lib/core` | Dinheiro em centavos, CNPJ/CPF, competência, datas, chave da NF-e, hash, `Result` |
| Domínio | `src/lib/domain` | Modelo normalizado, entidades persistidas, catálogo de obrigações |
| Parsers | `src/lib/parsers` | XML, ZIP, SPED (framework + layouts), PDF; detecção automática de tipo |
| Normalização | `src/lib/normalization` | Verificação de identidade e montagem do `AuditDataset` |
| Motor de regras | `src/lib/audit-engine` | Regras, tolerância, política de receita, score, execução isolada |
| Dados | `src/lib/data` | Porta de persistência + adaptadores `LocalStore` e `SupabaseStore`; storage |
| Pipeline | `src/lib/pipeline` | Ingestão de upload e processamento da auditoria |
| Interface | `src/app`, `src/components` | App Router, componentes de UI e de domínio |

### Decisões relevantes

**Dinheiro em centavos.** Todo valor monetário é um inteiro (`Cents`, tipo
branded). Auditoria comparando `float` produziria divergências de R$ 0,000001.

**Parsers não lançam exceção.** Retornam `Result`. Um XML corrompido dentro de um
ZIP de dez mil documentos vira um erro individual; a auditoria continua.

**SPED é lido por registro, não como texto livre.** `src/lib/parsers/sped/reader.ts`
tokeniza as linhas por `|` e entrega um *generator* — um arquivo de centenas de
MB nunca é materializado como array. Cada obrigação declara seu layout de forma
declarativa (`defineLayout`), anotando o nome oficial de cada campo.

**Dois modos de persistência.** `LocalStore` (arquivo em `.data/`) para
desenvolvimento e demonstração; `SupabaseStore` (PostgreSQL) para produção. A
aplicação fala apenas com a interface `DataStore`.

**Processamento sem filas, mas pronto para elas.** `processAudit()` é uma função
pura em relação à infraestrutura, disparada por um endpoint dedicado
(`POST /api/auditorias/[id]/processar`). Mover a execução para um worker é trocar
o chamador, não a arquitetura.

---

## 4. Instalação

Requisitos: **Node.js 20.9+** (desenvolvido e validado em 22.x).

```bash
npm install
cp .env.example .env.local     # opcional: sem isso o sistema roda em modo local
npm run dev
```

Acesse `http://localhost:3000`. No modo local as credenciais padrão são
`auditor@attivare.local` / `attivare` (configuráveis, veja abaixo).

Para carregar a base de demonstração: **Configurações → Carregar dados de
demonstração**.

---

## 5. Variáveis de ambiente

Todas opcionais. Sem nenhuma delas o sistema roda em modo local.

| Variável | Padrão | Função |
| --- | --- | --- |
| `ATTIVARE_PERSISTENCE_MODE` | deduzido | `local` ou `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | — | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | Chave pública, usada pelo Supabase Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Chave de serviço, usada pelo servidor |
| `SUPABASE_STORAGE_BUCKET` | `fiscal-files` | Bucket privado dos arquivos fiscais |
| `ATTIVARE_ORGANIZATION_ID` | UUID fixo | Organização desta instalação |
| `ATTIVARE_AUTH_SECRET` | valor de desenvolvimento | Assinatura do cookie de sessão do modo local |
| `ATTIVARE_AUTH_EMAIL` | `auditor@attivare.local` | Operador do modo local |
| `ATTIVARE_AUTH_PASSWORD` | `attivare` | Senha do operador do modo local |
| `ATTIVARE_MAX_UPLOAD_BYTES` | `67108864` | Limite por arquivo (64 MB) |

> **Atenção:** enquanto `ATTIVARE_AUTH_SECRET` não for definido, o cookie de
> sessão do modo local é assinado com um segredo conhecido. A tela de
> Configurações exibe esse aviso. Não utilize o modo local com documentos
> fiscais reais.

**Trava de produção.** Com `NODE_ENV=production` e autenticação local, o
processo **não inicia** se `ATTIVARE_AUTH_SECRET` estiver ausente, igual ao valor
de desenvolvimento ou com menos de 32 caracteres, nem se `ATTIVARE_AUTH_PASSWORD`
for a senha de demonstração.

A regra está em `assertProductionSecurity()` (`src/lib/config/env.ts`) e é
executada por `src/instrumentation.ts`, que o Next chama **uma única vez, antes
de o servidor aceitar requisições**. Falhando, a mensagem diz exatamente o que
corrigir e o processo sai com código 1 — um servidor que não pode atender com
segurança não deve ser reportado como saudável ao orquestrador.

A verificação não se aplica à compilação: `next build` roda com
`NODE_ENV=production`, mas a máquina de build não tem — nem deve ter — o segredo
da instalação. A distinção usa `NEXT_PHASE`.

Nenhuma credencial é versionada; `.env.example` traz apenas os nomes das
variáveis.

---

## 6. Supabase

### 6.1 Migrações

Aplique, na ordem, os arquivos de `supabase/migrations/`:

| Arquivo | Conteúdo |
| --- | --- |
| `0001_schema.sql` | Tipos, tabelas, índices e triggers |
| `0002_rls.sql` | Row Level Security de todas as tabelas e do bucket de storage |
| `0003_seed_organization.sql` | Organização inicial e trigger que cria o perfil de cada novo usuário |
| `0004_fase2_validacao.sql` | Confiabilidade e log de leitura dos arquivos, origem (arquivo/registro/linha) nos dados normalizados, `cfop_rules` e `field_confirmations` |

Via CLI do Supabase:

```bash
supabase db push
```

Ou colando o conteúdo de cada arquivo no SQL Editor do painel, na ordem.

### 6.2 Tabelas

`organizations`, `profiles`, `organization_settings`, `companies`,
`company_regime_history`, `audits`, `audit_files`, `invoices`, `invoice_items`,
`revenue_records`, `tax_records`, `declarations`, `participant_records`,
`audit_rules`, `audit_findings`, `audit_finding_evidence`, `audit_comments`,
`cfop_rules`, `field_confirmations`.

Todas usam UUID, carregam `organization_id` e têm `created_at`/`updated_at` onde
faz sentido. Valores monetários são `bigint` em centavos; competência é
`char(7)` no formato `AAAA-MM`.

### 6.3 Isolamento e segurança

- **RLS em todas as tabelas de dados**, comparando `organization_id` com
  `public.current_organization_id()`, que resolve a organização do usuário
  autenticado pela tabela `profiles`.
- **Bucket privado** `fiscal-files`, com políticas que só liberam objetos cuja
  auditoria pertence à organização do usuário.
- **Download por endpoint autenticado** (`/api/arquivos/[id]`), que gera URL
  temporária de 60 segundos no Supabase ou transmite os bytes no modo local.
  Nenhum documento fiscal fica publicamente acessível.
- **Validação de extensão e tamanho** antes de qualquer leitura de conteúdo.
- **Hash SHA-256** de cada arquivo, com índice único por auditoria, detectando
  reenvio do mesmo documento.
- **Bloqueio por CNPJ**: arquivo cujo CNPJ difere do cadastrado é marcado
  `INCOMPATÍVEL` e não entra nos cruzamentos.

> **Nota sobre a chave de serviço.** O servidor consulta o PostgreSQL com a
> `service_role`, que por definição contorna o RLS; por isso **toda** consulta do
> `SupabaseStore` filtra `organization_id` explicitamente. O RLS permanece como
> defesa em profundidade e é a autoridade para qualquer acesso que não use a
> chave de serviço (cliente com chave anônima, ferramentas externas, consultas
> diretas). Se a sua instalação exigir que o próprio backend fique sujeito ao
> RLS, troque o cliente em `src/lib/data/index.ts` por um cliente com a sessão do
> usuário — a interface `DataStore` não muda.

---

## 7. Validação técnica do arquivo

Nenhum arquivo precisa entrar direto em uma auditoria para ser examinado. Cada
importação tem uma página própria — **Importações → arquivo**, rota
`/arquivos/[id]` — que mostra o que o sistema entendeu **antes** de o arquivo
participar de qualquer cruzamento.

### 7.1 Arquivo identificado

Tipo de obrigação, empresa e CNPJ detectados, competência ou período,
`COD_VER`/leiaute declarado, quantidade de linhas e quantidade de registros por
código. A identificação é feita na importação; a interpretação completa só
ocorre no processamento.

### 7.2 Status de confiabilidade

Toda importação carrega um dos cinco status, exibido antes de o arquivo ser
usado:

| Status | Significado |
| --- | --- |
| `VALIDADO` | Leitura completa, sem alertas |
| `VALIDADO_COM_ALERTAS` | Lido, mas com observações que o auditor deve ver |
| `REQUER_CONFERENCIA` | Leiaute não verificado, registro relevante não mapeado ou campo extraído sem confiança alta |
| `INCOMPATIVEL` | CNPJ do arquivo diferente do da empresa |
| `ERRO` | Não foi possível ler |

A classificação está em `src/lib/pipeline/reliability.ts` e é derivada do que a
leitura efetivamente encontrou. Na importação, quando o conteúdo ainda não foi
interpretado, o melhor status possível é `REQUER_CONFERENCIA`
(`classifyUploadReliability`) — o sistema nunca declara validado aquilo que
ainda não leu. `blocksAudit()` impede `INCOMPATIVEL` e `ERRO` de alimentar os
cruzamentos.

### 7.3 Log de leitura

`parseLog` guarda, por arquivo, os **avisos**, os **erros**, os **registros não
mapeados** (com a contagem de cada um) e o **leiaute não verificado**
(`COD_VER` declarado × versões verificadas pelo parser). Nada disso é ocultado
na interface.

### 7.4 Inspetor do SPED

Para EFD ICMS/IPI e EFD-Contribuições, a página lista **quantos registros de
cada código** existem no arquivo. Clicando em um código, abre-se a tabela
paginada dos registros daquele tipo, e cada linha mostra:

- a **linha original**, exatamente como está no arquivo (`|C100|0|...|`);
- a **interpretação do sistema**, campo a campo, com o **nome oficial** do Guia
  Prático (`src/lib/parsers/sped/fields.ts`, 355 campos catalogados) e o valor
  já convertido conforme o tipo declarado (valor, data, alíquota, código).

Posições presentes na linha e ausentes do catálogo aparecem como
`campo [posição]`, com o conteúdo bruto — o sistema não descarta silenciosamente
o que não conhece.

A inspeção é feita **sob demanda**, relendo os bytes do storage
(`src/lib/parsers/sped/inspect.ts`); nada é duplicado no banco.

### 7.5 Diagnóstico do C100

Painel específico com as contagens e os somatórios do C100 **separados por
`IND_OPER` (entrada/saída) e por `COD_SIT`**. Documentos cancelados, denegados
e numeração inutilizada nunca são somados como receita — aparecem em linha
própria, com o rótulo oficial da situação.

### 7.6 Rastreabilidade até a linha

Cada registro normalizado (nota, receita, tributo, declaração, participante)
carrega `RecordOrigin`: `fileId`, `fileName`, `recordCode`, `lineNumber` e
`entryName` (entrada do ZIP, quando aplicável). As evidências das ocorrências
levam os mesmos campos, de modo que qualquer valor apontado pode ser rastreado
até **arquivo → registro → linha**.

### 7.7 Conferência do PGDAS-D

Campos extraídos do PDF são exibidos com **valor extraído**, **confiança** e
**evidência** (o trecho de texto que originou a leitura). O auditor pode
confirmar ou corrigir manualmente competência, receita bruta do período, RBT12 e
total devido.

**A correção manual atua apenas na camada normalizada.** O arquivo original —
XML, SPED, PDF ou ZIP — permanece imutável no storage. A confirmação é gravada
em `field_confirmations` com o valor originalmente extraído, o valor confirmado,
quem confirmou e quando; a descrição do registro derivado passa a registrar
essa intervenção.

### 7.8 Reprocessamento

**Reprocessar arquivo** relê os bytes já armazenados, sem novo upload, e
regrava a interpretação com a **versão corrente do parser**. O `sha256` é
recalculado e conferido. As versões são constantes próprias
(`src/lib/parsers/versions.ts`), independentes da versão da aplicação:
`XML_PARSER_VERSION`, `ZIP_PARSER_VERSION`, `EFD_ICMS_IPI_PARSER_VERSION`,
`EFD_CONTRIB_PARSER_VERSION`, `PGDAS_PARSER_VERSION`.

### 7.9 Resultado não verificado

Quando um documento necessário não existe, ou quando um valor comparado não pôde
ser determinado com segurança, a regra devolve `NAO_VERIFICADO` com o motivo —
**não** uma divergência — e o resultado não entra no score. Ausência de dado não
vira apontamento.

---

## 8. Composição da receita e política de CFOP

O sistema **não presume** que a receita seja a soma das notas de saída.

### 8.1 Composição explícita

Toda receita apurada tem uma tela **Ver composição**
(`/auditorias/[id]/composicao`), que lista documento a documento: chave, número,
CFOP, valor, se foi **incluído** e **por quê**. Cada documento recebe um dos três
tratamentos:

| Tratamento | Quando |
| --- | --- |
| `INCLUIR` | Há regra configurada para o CFOP determinando inclusão |
| `EXCLUIR` | Há regra configurada determinando exclusão, ou a situação do documento é ineficaz (cancelado, denegado, inutilizado) |
| `REVISAR` | Não há CFOP no documento, ou **não há regra configurada para aquele CFOP** |

Documentos em `REVISAR` **nunca** são somados nem descartados: são contados à
parte e exibidos. Enquanto existir documento em revisão, as regras de
faturamento devolvem `NAO_VERIFICADO` em vez de uma conclusão.

O relatório informa sempre os dois números: **receita considerada** e
**documentos em revisão**.

### 8.2 Política de receita

**Configurações → Política de receita** mantém a tabela CFOP × tratamento ×
motivo × última alteração (`cfop_rules`). É o único lugar onde um CFOP passa a
ser tratado como receita ou como exclusão.

> **Padrão de produção: `REVISAR`.** O sistema não traz classificação de CFOP
> pronta. As regras dos dados de demonstração são gravadas com
> `source = 'DEMONSTRACAO'` e identificadas como tal na interface — elas existem
> para exercitar as telas, **não** são orientação tributária e não devem ser
> usadas como padrão de cliente. A classificação depende da natureza da operação
> e é responsabilidade de profissional habilitado.

### 8.3 Exportação

Todas as composições e listas saem em CSV por
`/api/auditorias/[id]/exportar?tipo=…`: `receita-xml`, `receita-efd`,
`receita-efd-contribuicoes`, `documentos-em-revisao`, `divergencias` e
`nao-encontrados`. Os arquivos usam **UTF-8 com BOM**, separador `;` e vírgula
decimal — abrem diretamente no Excel em português. Cada linha leva arquivo,
registro e número da linha de origem.

---

## 9. Estrutura de pastas

```
src/
├── app/
│   ├── (app)/                  # área autenticada (layout com sidebar)
│   │   ├── dashboard/
│   │   ├── empresas/           # lista, cadastro, detalhe + histórico de regime
│   │   ├── auditorias/         # lista, nova, workspace, relatório,
│   │   │                       #   composicao/ e documento/[chave]/
│   │   ├── arquivos/[id]/      # validação técnica: identificação, log,
│   │   │                       #   inspetor SPED, C100, confirmação de campos
│   │   ├── importacoes/
│   │   ├── divergencias/       # tabela com filtros + painel de evidências
│   │   ├── regras/             # configuração por regra
│   │   ├── relatorios/
│   │   └── configuracoes/      # + politica-receita/
│   ├── api/                    # upload, processamento, download, inspeção,
│   │                           #   reprocessamento, exportação CSV, demonstração
│   └── login/
├── instrumentation.ts          # verificação de segurança na subida do servidor
├── components/
│   ├── ui/                     # primitivas: Button, Card, Badge, Table, Field, Stat
│   ├── charts/                 # gráficos em SVG, sem biblioteca externa
│   └── domain/                 # dropzone, lista de arquivos, tabela e painel de ocorrências
└── lib/
    ├── core/                   # money, cnpj, competencia, dates, nfe-key, hash, result
    ├── domain/                 # model, entities, sources
    ├── parsers/
    │   ├── xml/                # NF-e / NFC-e
    │   ├── archive/            # ZIP
    │   ├── sped/               # reader, layout, efd-icms-ipi, efd-contribuicoes,
    │   │                       #   fields.ts (campos oficiais), inspect.ts
    │   ├── pdf/                # extração de texto + pgdasd
    │   ├── detect/identify     # identificação automática de tipo e de CNPJ
    │   ├── versions.ts         # versão de cada parser, independente do app
    │   └── index.ts            # registro de parsers
    ├── normalization/          # identity, dataset
    ├── audit-engine/
    │   ├── rules/              # fiscal, faturamento, contribuicoes
    │   ├── engine.ts  tolerance.ts  revenue-composition.ts  score.ts  types.ts
    ├── data/                   # types (porta), local-store, supabase-store, storage
    ├── pipeline/               # upload, process, reliability, confirmations
    ├── reports/                # csv
    ├── demo/                   # fixtures, pdf-writer, seed
    ├── auth/  config/  queries/  ui/
supabase/migrations/            # schema, RLS, seed
tests/                          # vitest
```

---

## 10. Como rodar

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm start` | Executa o build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript em modo estrito, sem emitir |
| `npm test` | Vitest |
| `npm run verify` | lint + typecheck + testes + build |

---

## 11. Como testar

```bash
npm test            # execução única
npm run test:watch  # modo observação
```

A suíte cobre aritmética monetária, CNPJ/CPF, competência, chave de acesso,
parser de XML, ZIP (deduplicação, inválidos, ignorados), leitor SPED, EFD
ICMS/IPI, EFD-Contribuições, PGDAS-D (incluindo PDF real gerado no próprio
teste), normalização, tolerância, score e todas as regras de auditoria.

A fase 2 acrescentou: catálogo de campos oficiais conferido contra as posições
que o parser realmente lê, inspeção e paginação dos registros, diagnóstico do
C100 por `COD_SIT`/`IND_OPER`, rastreabilidade até a linha, versão do parser,
registros e leiautes não reconhecidos, arquivos parcialmente válidos,
classificação de confiabilidade, composição da receita (incluídos, excluídos e
em revisão), bloqueio de conclusão quando a receita não foi identificada,
confirmação manual do PGDAS-D, reprocessamento sem novo upload, trava de
segurança de produção e formato do CSV.

Os arquivos de teste são gerados por `src/lib/demo/fixtures.ts`. **Nenhum CNPJ ou
dado real de cliente é utilizado**: os CNPJs são construídos a partir de bases
arbitrárias com dígitos verificadores válidos.

---

## 12. Como adicionar um parser

1. **Declare a obrigação** em `src/lib/domain/sources.ts`, preenchendo
   `extensions` e marcando `implemented: true`.

2. **Implemente `FileParser`** (`src/lib/parsers/types.ts`):

   ```ts
   export const meuParser: FileParser = {
     source: 'NFSE',
     detect(input) {
       if (input.extension !== '.xml') return null;
       if (!/<Rps\b/.test(input.head)) return null;
       return { source: 'NFSE', confidence: 0.9, reason: 'Elemento Rps encontrado.' };
     },
     async parse(input) {
       // devolva sempre Result; nunca lance excecao para arquivo malformado
       return ok({ source: 'NFSE', identity, invoices, revenues, taxes,
                   declarations: [], participants: [], messages, stats });
     },
   };
   ```

3. **Registre** em `PARSERS`, no `src/lib/parsers/index.ts`.

4. Se a obrigação for **SPED**, reaproveite o framework: crie um
   `layout.ts` com `defineLayout([...])`, um handler por registro, anotando a
   posição de cada campo com o nome oficial:

   ```ts
   {
     code: 'C100',
     description: 'Nota fiscal, NF-e e NFC-e',
     handle(record, state) {
       state.documents.push({
         indOper: field(record, 2),  // IND_OPER
         vlDoc:   money(record, 12), // VL_DOC
       });
     },
   }
   ```

5. **Identificação barata**: se ler o arquivo inteiro só para achar o CNPJ for
   caro, acrescente o caso em `src/lib/parsers/identify.ts`.

6. Escreva o **gerador de arquivo fictício** em `src/lib/demo/fixtures.ts` e os
   testes correspondentes.

Nada mais precisa mudar: normalização, motor de regras e interface consomem o
modelo normalizado.

---

## 13. Como adicionar uma regra de auditoria

1. Crie a regra em `src/lib/audit-engine/rules/`:

   ```ts
   export const attFisXxx: AuditRule = {
     id: 'att-fis-008',
     codigo: 'ATT-FIS-008',
     nome: 'Nome exibido da regra',
     descricao: 'O que a regra compara.',
     modulo: 'FISCAL',
     gravidade: 'ALTA',
     documentosNecessarios: ['XML_NFE', 'EFD_ICMS_IPI'],
     toleranciaPadrao: DEFAULT_TOLERANCE,
     limitacoes: 'O que a regra NAO consegue concluir sozinha.',
     executar({ dataset, config, revenuePolicy }) {
       // 1. documentos ausentes  -> resultado NAO_VERIFICADO
       // 2. regra inaplicavel    -> resultado NAO_APLICAVEL, com o motivo
       // 3. comparacao           -> compareValues(a, b, config.tolerancia)
       return { cruzamentosCorretos, findings };
     },
   };
   ```

2. Registre em `src/lib/audit-engine/rules/index.ts`.

3. Escreva o teste com um cenário que dispara e um que não dispara.

Regras da casa:

- **Nunca concluir sem evidência.** Todo `finding` deve trazer `evidencias`
  dizendo de onde veio cada valor, em vocabulário que o auditor reconheça
  (elemento do XML, campo do registro do SPED, campo do PDF) e o arquivo de
  origem.
- **Separar fato de conclusão.** Se a conclusão depende de interpretação
  tributária, use `natureza: 'INDICIO'` e preencha `analiseHumana`.
- **Não verificar não é conformidade.** Documento ausente gera
  `NAO_VERIFICADO`, que não afeta o score.
- **Tolerância vem da configuração**, nunca fixa no corpo da regra.

---

## 14. Regras implementadas

| Código | Módulo | Compara |
| --- | --- | --- |
| `ATT-FIS-001` | Fiscal | XML de NF-e sem escrituração na EFD ICMS/IPI (pela chave) |
| `ATT-FIS-002` | Fiscal | Registro C100 sem XML correspondente |
| `ATT-FIS-003` | Fiscal | Valor total do documento: XML × `VL_DOC` |
| `ATT-FIS-004` | Fiscal | Base de ICMS: XML × `VL_BC_ICMS` |
| `ATT-FIS-005` | Fiscal | ICMS: XML × `VL_ICMS` |
| `ATT-FIS-006` | Fiscal | CFOP predominante: XML × C170/C190 |
| `ATT-FIS-007` | Fiscal | Quantidade de documentos: XML × EFD |
| `ATT-FAT-001` | Faturamento | Documentos fiscais × receita bruta do PGDAS-D |
| `ATT-FAT-002` | Faturamento | EFD ICMS/IPI × PGDAS-D |
| `ATT-FAT-003` | Faturamento | EFD-Contribuições × PGDAS-D |
| `ATT-FAT-004` | Faturamento | Documentos fiscais × receita da EFD-Contribuições |
| `ATT-PIS-001` | Tributário | PIS dos documentos × apuração do registro M200 |
| `ATT-COF-001` | Tributário | COFINS dos documentos × apuração do registro M600 |

`ATT-PIS-001` e `ATT-COF-001` reportam `NAO_APLICAVEL` para empresas do Simples
Nacional, porque a Contribuição para o PIS/Pasep e a COFINS são recolhidas no
documento único de arrecadação (Lei Complementar 123/2006, art. 13).

### Tolerância

Cada regra tem `absoluteTolerance` (centavos) e `percentageTolerance` (pontos
percentuais), ajustáveis por organização na tela *Regras de Auditoria*. O padrão
é R$ 0,05 absolutos, tratado como arredondamento. A tolerância aplicada aparece
nas evidências da ocorrência.

### Score

Parte de 100 e desconta o peso da gravidade de cada ocorrência que exige ação
(`DIVERGENCIA` ou `ALERTA`). Pesos padrão, configuráveis em *Configurações*:

| Gravidade | Peso |
| --- | --- |
| INFO | 0 |
| BAIXA | 1 |
| MÉDIA | 3 |
| ALTA | 7 |
| CRÍTICA | 15 |

Nunca fica abaixo de zero. Faixas: **Excelente** (≥ 90), **Bom** (≥ 75),
**Atenção** (≥ 50), **Crítico** (< 50).

---

## 15. Dados de demonstração

Em **Configurações → Carregar dados de demonstração** o sistema cria a empresa
fictícia `COMERCIAL DEMONSTRAÇÃO LTDA` e uma auditoria da competência 08/2026,
gerando os arquivos e processando-os pelo **mesmo pipeline de uma importação
real**. Nada é simulado.

Inconsistências plantadas de propósito: NF-e emitida e não escriturada,
documento escriturado sem XML, valor total divergente, ICMS divergente, CFOP
divergente, receita do PGDAS-D abaixo do somatório dos documentos, XML repetido
dentro do ZIP e uma NF-e cancelada. O resultado é deliberadamente não conforme,
para exercitar todas as telas.

Os CFOPs usados pela demonstração são gravados na política de receita com
`source = 'DEMONSTRAÇÃO'`, de modo que **nenhum documento fica em revisão** e as
regras de faturamento chegam a uma conclusão — é isso que a demonstração precisa
mostrar. O caminho oposto (CFOP sem classificação → documento em revisão →
faturamento `NÃO VERIFICADO`) é coberto pelos testes, não pela base de
demonstração. Em uma instalação real, sem política configurada, todos os
documentos começam em revisão.

---

## 16. Checklist de produção

Percorra na ordem. Nenhum item depende de credencial versionada: todos são
variáveis de ambiente do provedor.

**Banco**

- [ ] Aplicar `0001_schema.sql`, `0002_rls.sql`, `0003_seed_organization.sql` e
      `0004_fase2_validacao.sql`, nessa ordem (`supabase db push`).
- [ ] Conferir que **todas** as tabelas de dados têm RLS habilitado e política
      comparando `organization_id` com `public.current_organization_id()`.
- [ ] Conferir as chaves únicas: `audit_files (audit_id, sha256)`,
      `cfop_rules (organization_id, cfop)`, `field_confirmations (file_id, field_key)`.
- [ ] Conferir que as FKs de `audit_files`, `invoices`, `revenue_records`,
      `tax_records`, `declarations` e `participant_records` apagam em cascata com
      a auditoria.

**Storage**

- [ ] Criar o bucket `fiscal-files` como **privado**.
- [ ] Aplicar as políticas de storage de `0002_rls.sql`.
- [ ] Confirmar que nenhum objeto é acessível sem autenticação (o download passa
      por `/api/arquivos/[id]`, que assina URL de 60 segundos).

**Ambiente**

- [ ] `ATTIVARE_PERSISTENCE_MODE=supabase`.
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e
      `SUPABASE_SERVICE_ROLE_KEY` definidos **apenas** no provedor. A chave de
      serviço nunca vai para o cliente nem para o repositório.
- [ ] `ATTIVARE_ORGANIZATION_ID` igual ao UUID da organização criada.
- [ ] `ATTIVARE_AUTH_SECRET` com 32 caracteres ou mais e diferente do valor de
      desenvolvimento — ou autenticação via Supabase Auth. Com `NODE_ENV=production`
      e autenticação local, o processo **falha no startup** se isso não estiver
      correto, e a senha de demonstração é sempre recusada.
- [ ] `ATTIVARE_MAX_UPLOAD_BYTES` ajustado ao maior SPED esperado.

**Verificação**

- [ ] `npm run verify` (lint + typecheck + testes + build) sem erros.
- [ ] Primeiro login criando o perfil na organização correta.
- [ ] Importar **um arquivo real** e percorrer a página do arquivo: tipo, CNPJ,
      competência, leiaute, contagem de registros, inspeção de um C100 e
      diagnóstico por `COD_SIT`.
- [ ] Configurar a **política de receita** da empresa antes da primeira auditoria
      de faturamento. Sem ela, os documentos ficam em revisão e o resultado sai
      como não verificado — que é o comportamento pretendido.
- [ ] Remover as regras de CFOP marcadas `DEMONSTRAÇÃO`, se os dados de
      demonstração tiverem sido carregados no ambiente.

---

## 17. Limitações conhecidas

- **PGDAS-D apenas textual.** PDFs digitalizados são recusados com mensagem
  explícita; não há OCR neste release, porque uma transcrição incorreta viraria
  um "fato" no motor de regras.
- **Layouts SPED verificados por versão.** O parser registra o `COD_VER` do
  registro 0000 e emite alerta quando a versão não consta na lista verificada.
  As posições dos campos seguem o Guia Prático de cada obrigação e estão
  anotadas campo a campo no código, para conferência.
- **FCP na EFD ICMS/IPI.** O registro C100 não possui campo de FCP; o valor não é
  afirmado como zero, e não há regra comparando FCP entre XML e EFD.
- **Processamento síncrono.** Adequado às ordens de grandeza testadas; para
  volumes muito maiores, mover `processAudit()` para um worker.
- **Relatório em PDF** é gerado pela impressão do navegador ("Salvar como PDF").
  A página já é um documento imprimível; um renderizador no servidor pode ser
  acrescentado sem alterar a marcação.
- **Classificação de CFOP não acompanha o produto.** Sem política de receita
  configurada, os documentos ficam em revisão e o faturamento sai como não
  verificado. Isso é deliberado: o tratamento de um CFOP depende da natureza da
  operação, e o sistema não emite conclusão tributária que não tenha sido
  parametrizada por profissional habilitado.
- **Comparação XML × SPED em nível de documento.** A tela documento a documento
  confronta os campos do XML com os do C100 e lista os itens dos dois lados; a
  regra `ATT-FIS-006`, porém, compara o **CFOP predominante** (o de maior valor),
  não item a item. Onde a comparação é agregada, a tela indica isso
  explicitamente.
- **Confirmação manual restrita ao PGDAS-D.** Os campos confirmáveis são
  competência, receita bruta do período, RBT12 e total devido. XML e SPED não
  têm correção manual: são arquivos estruturados cuja divergência de leitura
  deve ser tratada no parser, não no dado.

---

## 18. Aviso

O sistema é uma ferramenta técnica de auditoria. As diferenças apontadas são
fatos aritméticos apurados sobre os arquivos apresentados e **não constituem, por
si só, conclusão sobre a correção do tratamento tributário aplicado**, que
depende da natureza das operações e da análise de profissional habilitado.
