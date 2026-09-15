-- =============================================================================
-- Attivare Auditor — Fase 3: cruzamento XML NF-e/NFC-e × EFD ICMS/IPI
--
-- Acrescenta:
--   * finalidade normalizada do documento fiscal, com o campo e o valor de
--     origem (finNFe no XML, COD_SIT no registro C100);
--   * tributos da reforma (IBS, CBS, Imposto Seletivo) declarados no documento;
--   * versão da regra na ocorrência;
--   * campo, linha, registro e versão do parser na evidência;
--   * fator de penalidade das ocorrências de natureza INDICIO.
--
-- CORREÇÃO DE DEFEITO: as colunas `record_code` e `line_number` de
-- `audit_finding_evidence` eram gravadas pela aplicação desde a fase 2, mas
-- nunca foram criadas por nenhuma migração. Em modo `supabase`, toda gravação
-- de evidência falhava com "column does not exist", e com ela a persistência do
-- resultado da auditoria. As colunas são criadas aqui.
--
-- COMPATIBILIDADE COM INSTALAÇÕES EXISTENTES
--   * Idempotente: todo comando usa `if not exists`; reaplicar não tem efeito.
--   * Aditiva: nenhuma coluna é removida, renomeada ou tem o tipo alterado, e
--     nenhum dado é reescrito.
--   * Sem `not null` sem default: as colunas obrigatórias têm default, de modo
--     que as linhas já gravadas permanecem válidas sem reescrita da tabela.
--   * Sem bloqueio longo: em PostgreSQL 11+, `add column ... default` não
--     reescreve a tabela; os `create index` são os únicos comandos que tomam
--     lock de escrita, e o fazem por tabela.
--   * Reversível: `0005_fase3_xml_efd.down.sql` desfaz exatamente estes
--     comandos. Ver a advertência de perda de dados naquele arquivo.
--
-- ORDEM: aplicar depois de 0001, 0002, 0003 e 0004.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Documentos fiscais: finalidade normalizada e tributos da reforma
--
-- A finalidade decide se dois documentos são comparáveis campo a campo. Um
-- documento complementar escritura apenas o valor complementado; uma devolução
-- inverte o sentido da operação. Guardar o código bruto e o nome do campo ao
-- lado da finalidade normalizada é o que permite conferir a leitura contra o
-- leiaute da obrigação.
--
-- `reform_taxes` é jsonb e admite nulo de propósito: nulo significa que a fonte
-- não declarou IBS, CBS nem Imposto Seletivo, o que é diferente de declarar
-- zero. As regras dependem dessa distinção para não concluir sobre o que não
-- leram.
-- -----------------------------------------------------------------------------
alter table public.invoices
  add column if not exists purpose text not null default 'INDEFINIDA',
  add column if not exists extemporaneous boolean not null default false,
  add column if not exists purpose_code text,
  add column if not exists purpose_field text,
  add column if not exists reform_taxes jsonb;

-- Filtra documentos por finalidade dentro de uma auditoria (telas de composição
-- e diagnóstico). Sem ele, a filtragem varre todos os documentos da auditoria.
create index if not exists invoices_purpose_idx
  on public.invoices (audit_id, purpose);

-- -----------------------------------------------------------------------------
-- Ocorrências: versão da regra
--
-- A versão da aplicação não serve: um release pode não tocar em nenhuma regra, e
-- a mudança de um critério de comparação precisa ser rastreável por si só.
--
-- O default vazio é deliberado: as ocorrências gravadas antes desta migração
-- foram produzidas por regras cuja versão não era registrada, e marcá-las com
-- uma versão qualquer seria afirmar o que não se sabe. A aplicação exibe o campo
-- apenas quando preenchido.
-- -----------------------------------------------------------------------------
alter table public.audit_findings
  add column if not exists rule_version text not null default '';

-- -----------------------------------------------------------------------------
-- Evidências: campo, registro, linha e versão do parser
--
-- Tipos escolhidos:
--   * `record_code`   text    — código do registro SPED (`C100`) ou elemento do
--                               XML (`infNFe`). Texto, não enum: o conjunto
--                               cresce a cada obrigação suportada.
--   * `line_number`   integer — linha do arquivo original, base 1. `integer`
--                               cobre 2,1 bilhões de linhas, muito além do maior
--                               SPED possível; `bigint` custaria espaço sem uso.
--   * `field_name`    text    — nome oficial do campo no leiaute (`VL_DOC`,
--                               `total/ICMSTot/vNF`). Comprimento variável,
--                               inclui caminhos de XML.
--   * `parser_version` text   — versão semântica do parser (`1.0.0`).
-- Todas admitem nulo: nem toda evidência vem de origem orientada a linha, e uma
-- evidência de contagem apurada pela própria regra não tem campo de leiaute.
-- -----------------------------------------------------------------------------
alter table public.audit_finding_evidence
  add column if not exists record_code text,
  add column if not exists line_number integer,
  add column if not exists field_name text,
  add column if not exists parser_version text;

-- Conferência de rastreabilidade: dada uma ocorrência, chegar ao arquivo, ao
-- registro e à linha que produziram cada valor.
create index if not exists audit_finding_evidence_origin_idx
  on public.audit_finding_evidence (finding_id, record_code, line_number);

-- -----------------------------------------------------------------------------
-- Score: peso das ocorrências de natureza INDICIO
--
-- Um indício é uma diferença cuja leitura fiscal depende de análise humana.
-- Pesá-lo como divergência confirmada tornaria o score pessimista a ponto de
-- deixar de informar; ignorá-lo o tornaria cego. O padrão é metade do peso da
-- gravidade. A restrição de intervalo é aplicada no banco porque um fator fora
-- de [0, 1] produziria score sem significado.
-- -----------------------------------------------------------------------------
alter table public.organization_settings
  add column if not exists indicio_factor numeric(4, 3) not null default 0.5;

do $$ begin
  alter table public.organization_settings
    add constraint organization_settings_indicio_factor_range
    check (indicio_factor >= 0 and indicio_factor <= 1);
exception when duplicate_object then null; end $$;
