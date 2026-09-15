-- =============================================================================
-- Attivare Auditor — Fase 3: cruzamento XML NF-e/NFC-e × EFD ICMS/IPI
--
-- Acrescenta:
--   * finalidade normalizada do documento fiscal, com o campo e o valor de
--     origem (finNFe no XML, COD_SIT no registro C100);
--   * versão da regra na ocorrência;
--   * campo, linha, registro e versão do parser na evidência.
--
-- CORREÇÃO DE DEFEITO: as colunas `record_code` e `line_number` de
-- `audit_finding_evidence` eram gravadas pela aplicação desde a fase 2, mas
-- nunca foram criadas por nenhuma migração. Em modo `supabase`, toda gravação
-- de evidência falhava com "column does not exist", e com ela a persistência do
-- resultado da auditoria. As colunas são criadas aqui.
--
-- A migração é idempotente e não remove dados existentes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Documentos fiscais: finalidade normalizada
--
-- A finalidade decide se dois documentos são comparáveis campo a campo. Um
-- documento complementar escritura apenas o valor complementado; uma devolução
-- inverte o sentido da operação. Guardar o código bruto e o nome do campo ao
-- lado da finalidade normalizada é o que permite conferir a leitura contra o
-- leiaute da obrigação.
-- -----------------------------------------------------------------------------
alter table public.invoices
  add column if not exists purpose text not null default 'INDEFINIDA',
  add column if not exists extemporaneous boolean not null default false,
  add column if not exists purpose_code text,
  add column if not exists purpose_field text;

create index if not exists invoices_purpose_idx
  on public.invoices (audit_id, purpose);

-- -----------------------------------------------------------------------------
-- Ocorrências: versão da regra
--
-- A versão da aplicação não serve: um release pode não tocar em nenhuma regra, e
-- a mudança de um critério de comparação precisa ser rastreável por si só.
-- -----------------------------------------------------------------------------
alter table public.audit_findings
  add column if not exists rule_version text not null default '';

-- -----------------------------------------------------------------------------
-- Evidências: campo, registro, linha e versão do parser
-- -----------------------------------------------------------------------------
alter table public.audit_finding_evidence
  add column if not exists record_code text,
  add column if not exists line_number integer,
  add column if not exists field_name text,
  add column if not exists parser_version text;

-- Conferência de rastreabilidade: dada uma evidência, chegar ao arquivo, ao
-- registro e à linha que produziram o valor.
create index if not exists audit_finding_evidence_origin_idx
  on public.audit_finding_evidence (finding_id, record_code, line_number);
