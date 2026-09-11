-- =============================================================================
-- Attivare Auditor — Fase 2: validação técnica e rastreabilidade
--
-- Acrescenta:
--   * origem por registro e linha nos dados normalizados;
--   * confiabilidade, versão de parser e log de leitura por arquivo;
--   * política de receita por CFOP;
--   * confirmações manuais de campos extraídos.
--
-- A migração é idempotente e não remove dados existentes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type file_reliability as enum (
    'VALIDADO', 'VALIDADO_COM_ALERTAS', 'REQUER_CONFERENCIA', 'INCOMPATIVEL', 'ERRO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type cfop_treatment as enum ('INCLUIR', 'EXCLUIR', 'REVISAR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cfop_rule_source as enum ('CONFIGURADO', 'DEMONSTRACAO');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Arquivos: confiabilidade, versão do parser e log de leitura
-- -----------------------------------------------------------------------------
alter table public.audit_files
  add column if not exists reliability file_reliability not null default 'REQUER_CONFERENCIA',
  add column if not exists parser_version text,
  add column if not exists parse_log jsonb,
  add column if not exists inspection jsonb;

create index if not exists audit_files_reliability_idx
  on public.audit_files (organization_id, reliability);

-- -----------------------------------------------------------------------------
-- Origem por registro e linha nos dados normalizados
--
-- Sem isso, uma divergência aponta o arquivo mas não a linha que produziu o
-- valor — que é justamente o que a conferência manual exige.
-- -----------------------------------------------------------------------------
do $$
declare
  target text;
begin
  foreach target in array array[
    'invoices', 'revenue_records', 'tax_records', 'declarations', 'participant_records'
  ] loop
    execute format(
      'alter table public.%I
         add column if not exists origin_record_code text,
         add column if not exists origin_line_number integer,
         add column if not exists origin_entry_name text;',
      target
    );
  end loop;
end $$;

-- O registro de participantes passou a guardar o arquivo de origem.
alter table public.participant_records
  add column if not exists file_id uuid references public.audit_files (id) on delete set null,
  add column if not exists file_name text;

-- Índice que sustenta a navegação "desta linha do SPED veio este documento".
create index if not exists invoices_origin_idx
  on public.invoices (audit_id, origin_record_code, origin_line_number);

-- -----------------------------------------------------------------------------
-- Política de receita por CFOP
-- -----------------------------------------------------------------------------
create table if not exists public.cfop_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cfop char(4) not null,
  description text,
  treatment cfop_treatment not null,
  reason text,
  rule_source cfop_rule_source not null default 'CONFIGURADO',
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint cfop_rules_cfop_format check (cfop ~ '^[0-9]{4}$'),
  constraint cfop_rules_unique unique (organization_id, cfop)
);

create index if not exists cfop_rules_organization_idx on public.cfop_rules (organization_id, cfop);

comment on table public.cfop_rules is
  'Tratamento de cada CFOP na composição da receita. CFOP ausente desta tabela '
  'permanece em revisão: o sistema não infere tratamento tributário.';

-- -----------------------------------------------------------------------------
-- Confirmações manuais de campos extraídos
--
-- A correção atua na camada normalizada; o arquivo original permanece imutável.
-- O valor lido pelo parser é preservado ao lado do valor confirmado.
-- -----------------------------------------------------------------------------
create table if not exists public.field_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  file_id uuid not null references public.audit_files (id) on delete cascade,
  field text not null,
  original_value text,
  confirmed_value text not null,
  confirmed_by text not null,
  confirmed_at timestamptz not null default now(),
  note text,
  constraint field_confirmations_unique unique (file_id, field)
);

create index if not exists field_confirmations_audit_idx
  on public.field_confirmations (audit_id);

-- -----------------------------------------------------------------------------
-- A lista solta de CFOPs excluídos deu lugar à tabela cfop_rules.
-- -----------------------------------------------------------------------------
alter table public.organization_settings
  drop column if exists revenue_cfop_exclusions;

-- -----------------------------------------------------------------------------
-- RLS das novas tabelas
-- -----------------------------------------------------------------------------
do $$
declare
  target text;
begin
  foreach target in array array['cfop_rules', 'field_confirmations'] loop
    execute format('alter table public.%I enable row level security;', target);
    execute format('alter table public.%I force row level security;', target);

    execute format('drop policy if exists %1$s_select on public.%1$I;', target);
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using (organization_id = public.current_organization_id());',
      target
    );

    execute format('drop policy if exists %1$s_insert on public.%1$I;', target);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated
         with check (organization_id = public.current_organization_id());',
      target
    );

    execute format('drop policy if exists %1$s_update on public.%1$I;', target);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated
         using (organization_id = public.current_organization_id())
         with check (organization_id = public.current_organization_id());',
      target
    );

    execute format('drop policy if exists %1$s_delete on public.%1$I;', target);
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated
         using (organization_id = public.current_organization_id());',
      target
    );
  end loop;
end $$;
