-- =============================================================================
-- Attivare Auditor — esquema base
--
-- Convencoes:
--   * toda tabela de dados carrega organization_id e e isolada por RLS;
--   * valores monetarios são armazenados em CENTAVOS (bigint), nunca em ponto
--     flutuante, para que uma comparacao de auditoria nunca sofra erro de
--     arredondamento binario;
--   * competência e armazenada no formato canonico 'AAAA-MM' (char(7)).
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type tax_regime as enum (
    'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'IMUNE_ISENTA', 'OUTRO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_status as enum (
    'RASCUNHO', 'AGUARDANDO_ARQUIVOS', 'PROCESSANDO', 'CONCLUIDA',
    'CONCLUIDA_COM_ERROS', 'ERRO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type conformity_band as enum ('EXCELENTE', 'BOM', 'ATENCAO', 'CRITICO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type file_processing_status as enum (
    'PENDENTE', 'PROCESSANDO', 'PROCESSADO', 'PROCESSADO_COM_ALERTAS', 'ERRO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type identity_check as enum ('COMPATIVEL', 'INCOMPATIVEL', 'NAO_IDENTIFICADO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type severity as enum ('INFO', 'BAIXA', 'MEDIA', 'ALTA', 'CRITICA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type finding_status as enum (
    'OK', 'ALERTA', 'DIVERGENCIA', 'NAO_APLICAVEL', 'NAO_VERIFICADO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_status as enum (
    'PENDENTE', 'EM_ANALISE', 'PROCEDENTE', 'IMPROCEDENTE', 'CORRIGIDO', 'IGNORADO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type finding_nature as enum ('FATO', 'INDICIO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type operation_direction as enum ('SAIDA', 'ENTRADA', 'INDEFINIDA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_status as enum (
    'AUTORIZADA', 'CANCELADA', 'DENEGADA', 'INUTILIZADA', 'INDEFINIDA'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type tax_metric as enum ('DEVIDO_PERIODO', 'A_RECOLHER');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Funcao utilitaria de updated_at
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Organização e perfis
-- -----------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'auditor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_organization_idx on public.profiles (organization_id);

create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  score_weights jsonb not null default
    '{"INFO":0,"BAIXA":1,"MEDIA":3,"ALTA":7,"CRITICA":15}'::jsonb,
  max_upload_bytes bigint not null default 67108864,
  revenue_cfop_exclusions text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Empresas
-- -----------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  legal_name text not null,
  trade_name text,
  cnpj char(14) not null,
  state_registration text,
  municipal_registration text,
  uf char(2) not null,
  municipality text,
  tax_regime tax_regime not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_cnpj_digits check (cnpj ~ '^[0-9]{14}$'),
  constraint companies_cnpj_unique_per_org unique (organization_id, cnpj)
);

create index if not exists companies_organization_idx on public.companies (organization_id);

create table if not exists public.company_regime_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  tax_regime tax_regime not null,
  valid_from char(7) not null,
  valid_to char(7),
  note text,
  created_at timestamptz not null default now(),
  constraint regime_valid_from_format check (valid_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint regime_valid_to_format check (valid_to is null or valid_to ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

create index if not exists regime_history_company_idx on public.company_regime_history (company_id, valid_from desc);

-- -----------------------------------------------------------------------------
-- Auditorias
-- -----------------------------------------------------------------------------
create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  competencia char(7) not null,
  status audit_status not null default 'AGUARDANDO_ARQUIVOS',
  score smallint check (score between 0 and 100),
  band conformity_band,
  document_count integer not null default 0,
  cross_checks_ok integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audits_competencia_format check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

create index if not exists audits_organization_idx on public.audits (organization_id, created_at desc);
create index if not exists audits_company_competencia_idx on public.audits (company_id, competencia desc);

-- -----------------------------------------------------------------------------
-- Arquivos importados
-- -----------------------------------------------------------------------------
create table if not exists public.audit_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  parent_file_id uuid references public.audit_files (id) on delete set null,
  original_name text not null,
  storage_path text,
  mime_type text,
  size_bytes bigint not null,
  sha256 char(64) not null,
  detected_source text,
  detected_tax_id text,
  detected_legal_name text,
  detected_competencia char(7),
  detected_start_date date,
  detected_end_date date,
  identity_check identity_check not null default 'NAO_IDENTIFICADO',
  status file_processing_status not null default 'PENDENTE',
  messages jsonb not null default '[]'::jsonb,
  stats jsonb,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists audit_files_audit_idx on public.audit_files (audit_id, uploaded_at);
-- Deteccao de reenvio do mesmo arquivo dentro da mesma auditoria (requisito 28).
create unique index if not exists audit_files_hash_unique on public.audit_files (audit_id, sha256);

-- -----------------------------------------------------------------------------
-- Modelo normalizado
-- -----------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  file_id uuid references public.audit_files (id) on delete set null,
  file_name text,
  source text not null,
  document_kind text not null,
  access_key char(44),
  model text,
  serie text,
  number text,
  issue_date date,
  direction operation_direction not null default 'INDEFINIDA',
  status document_status not null default 'INDEFINIDA',
  total_value bigint not null default 0,
  emitter_tax_id text,
  emitter_name text,
  emitter_uf char(2),
  recipient_tax_id text,
  recipient_name text,
  recipient_uf char(2),
  natureza_operacao text,
  cfop_principal char(4),
  cfops text[] not null default '{}',
  totals jsonb not null,
  created_at timestamptz not null default now()
);

-- Indice que sustenta o cruzamento por chave (ATT-FIS-001 a ATT-FIS-006).
create index if not exists invoices_audit_key_idx on public.invoices (audit_id, source, access_key);
create index if not exists invoices_audit_direction_idx on public.invoices (audit_id, direction, status);
create index if not exists invoices_audit_cfop_idx on public.invoices (audit_id, cfop_principal);

create table if not exists public.invoice_items (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  position integer not null,
  data jsonb not null
);

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

create table if not exists public.revenue_records (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  file_id uuid references public.audit_files (id) on delete set null,
  file_name text,
  source text not null,
  competencia char(7) not null,
  basis text not null,
  amount bigint not null,
  description text not null,
  document_count integer,
  created_at timestamptz not null default now()
);

create index if not exists revenue_records_audit_idx on public.revenue_records (audit_id, source);

create table if not exists public.tax_records (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  file_id uuid references public.audit_files (id) on delete set null,
  file_name text,
  source text not null,
  competencia char(7) not null,
  tax text not null,
  metric tax_metric not null default 'A_RECOLHER',
  base bigint,
  amount bigint not null,
  description text not null,
  created_at timestamptz not null default now()
);

create index if not exists tax_records_audit_idx on public.tax_records (audit_id, tax, metric);

create table if not exists public.declarations (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  file_id uuid references public.audit_files (id) on delete set null,
  file_name text,
  source text not null,
  competencia char(7),
  tax_id text,
  legal_name text,
  period jsonb not null,
  lines jsonb not null default '[]'::jsonb,
  confidence text not null,
  unresolved_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists declarations_audit_idx on public.declarations (audit_id, source);

create table if not exists public.participant_records (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  source text not null,
  code text not null,
  name text,
  tax_id text,
  uf char(2),
  state_registration text,
  country_code text
);

create index if not exists participant_records_audit_idx on public.participant_records (audit_id);

-- -----------------------------------------------------------------------------
-- Motor de regras e resultados
-- -----------------------------------------------------------------------------
create table if not exists public.audit_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  rule_code text not null,
  enabled boolean not null default true,
  severity severity,
  absolute_tolerance_cents bigint,
  percentage_tolerance numeric(6, 3),
  updated_at timestamptz not null default now(),
  constraint audit_rules_unique unique (organization_id, rule_code),
  constraint audit_rules_percentage_range
    check (percentage_tolerance is null or (percentage_tolerance >= 0 and percentage_tolerance <= 100))
);

create table if not exists public.audit_findings (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  audit_id uuid not null references public.audits (id) on delete cascade,
  rule_code text not null,
  rule_name text not null,
  module text not null,
  severity severity not null,
  status finding_status not null,
  nature finding_nature not null,
  title text not null,
  description text not null,
  document_ref text,
  origin_label text,
  origin_value bigint,
  target_label text,
  target_value bigint,
  difference bigint,
  human_review_note text,
  review_status review_status not null default 'PENDENTE',
  review_note text,
  reviewer text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_findings_audit_idx on public.audit_findings (audit_id, severity desc);
create index if not exists audit_findings_org_review_idx
  on public.audit_findings (organization_id, review_status, severity desc);
create index if not exists audit_findings_rule_idx on public.audit_findings (organization_id, rule_code);

create table if not exists public.audit_finding_evidence (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  finding_id uuid not null references public.audit_findings (id) on delete cascade,
  label text not null,
  origin text not null,
  value text,
  source text,
  file_name text,
  reference text
);

create index if not exists audit_finding_evidence_finding_idx
  on public.audit_finding_evidence (finding_id);

create table if not exists public.audit_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  finding_id uuid not null references public.audit_findings (id) on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_comments_finding_idx on public.audit_comments (finding_id, created_at);

-- -----------------------------------------------------------------------------
-- Triggers de updated_at
-- -----------------------------------------------------------------------------
do $$
declare
  target text;
begin
  foreach target in array array[
    'organizations', 'profiles', 'companies', 'audits', 'audit_findings'
  ] loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();',
      target
    );
  end loop;
end $$;
