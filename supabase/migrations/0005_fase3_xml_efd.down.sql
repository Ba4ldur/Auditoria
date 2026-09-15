-- =============================================================================
-- Attivare Auditor — reversão da migração 0005
--
-- Desfaz exatamente o que `0005_fase3_xml_efd.sql` acrescenta, na ordem inversa.
-- Não é aplicado por `supabase db push`: existe para que a reversão de um
-- release seja um procedimento escrito e conferido, e não improvisado sob
-- pressão.
--
-- ADVERTÊNCIA — PERDA DE DADOS
--
-- Estas colunas guardam rastreabilidade, não dados derivados: `record_code`,
-- `line_number`, `field_name` e `parser_version` são o que liga uma ocorrência à
-- linha do arquivo que a produziu. Removê-las apaga a rastreabilidade das
-- auditorias já processadas, de forma irreversível — reprocessar o arquivo é o
-- único caminho de volta, e só funciona enquanto o arquivo original estiver
-- armazenado.
--
-- Antes de reverter:
--   1. Exporte as auditorias afetadas (tela de auditoria, exportação em CSV),
--      ou faça `pg_dump` das tabelas `audit_findings` e
--      `audit_finding_evidence`.
--   2. Confirme que a versão da aplicação que voltará a rodar é anterior à
--      fase 3. Uma aplicação da fase 3 contra o esquema revertido volta a
--      falhar na gravação das evidências — agora com a mensagem
--      "Banco de dados requer migração", e não em silêncio.
--
-- Reverter NÃO é necessário para voltar à aplicação da fase 2: as colunas
-- acrescentadas são ignoradas por ela. A reversão só se justifica para devolver
-- o banco a um estado exatamente anterior.
-- =============================================================================

alter table public.organization_settings
  drop constraint if exists organization_settings_indicio_factor_range;

alter table public.organization_settings
  drop column if exists indicio_factor;

drop index if exists public.audit_finding_evidence_origin_idx;

alter table public.audit_finding_evidence
  drop column if exists parser_version,
  drop column if exists field_name,
  drop column if exists line_number,
  drop column if exists record_code;

alter table public.audit_findings
  drop column if exists rule_version;

drop index if exists public.invoices_purpose_idx;

alter table public.invoices
  drop column if exists reform_taxes,
  drop column if exists purpose_field,
  drop column if exists purpose_code,
  drop column if exists extemporaneous,
  drop column if exists purpose;
