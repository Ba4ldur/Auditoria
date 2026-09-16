-- =============================================================================
-- Attivare Auditor — Fase 4: validação técnica assistida
--
-- Acrescenta a tabela que registra a conferência manual de documentos feita por
-- uma pessoa durante a validação do motor.
--
-- O registro não altera dado algum da auditoria: é a prova de que alguém
-- habilitado olhou o documento, comparou a leitura do sistema com o arquivo
-- original e se pronunciou. É esse registro que sustenta afirmar, depois, que o
-- motor foi validado — e por quem.
--
-- COMPATIBILIDADE
--   * Idempotente e aditiva: cria uma tabela nova; nada existente é alterado.
--   * Reversível por 0006_fase4_validacao_tecnica.down.sql.
--
-- ORDEM: aplicar depois de 0005.
-- =============================================================================

do $$ begin
  create type document_validation_status as enum (
    'CORRETO', 'PARSER_INCORRETO', 'CRUZAMENTO_INCORRETO', 'REQUER_ANALISE'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.document_validations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  -- Chave de acesso do documento conferido. Texto, e não referência à tabela
  -- de documentos: a conferência sobrevive ao reprocessamento do arquivo, que
  -- regrava os documentos com novos identificadores.
  access_key text not null,
  status document_validation_status not null,
  note text,
  validated_by text not null,
  validated_at timestamptz not null default now(),
  -- Uma conferência por documento por auditoria: a última se sobrepõe à
  -- anterior, e o histórico de quem conferiu fica no campo validated_by.
  constraint document_validations_unique unique (audit_id, access_key)
);

create index if not exists document_validations_audit_idx
  on public.document_validations (audit_id, status);

-- -----------------------------------------------------------------------------
-- RLS: mesma política das demais tabelas de dados da organização.
-- -----------------------------------------------------------------------------
alter table public.document_validations enable row level security;
alter table public.document_validations force row level security;

drop policy if exists document_validations_select on public.document_validations;
create policy document_validations_select on public.document_validations for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists document_validations_insert on public.document_validations;
create policy document_validations_insert on public.document_validations for insert to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists document_validations_update on public.document_validations;
create policy document_validations_update on public.document_validations for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists document_validations_delete on public.document_validations;
create policy document_validations_delete on public.document_validations for delete to authenticated
  using (organization_id = public.current_organization_id());
