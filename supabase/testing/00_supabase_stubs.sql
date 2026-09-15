-- =============================================================================
-- Substitutos mínimos dos esquemas que o Supabase provê
--
-- As migrações de produção referenciam `auth.users`, `auth.uid()`,
-- `storage.buckets` e `storage.objects`, criados pela plataforma e ausentes em
-- um PostgreSQL puro. Este arquivo cria o mínimo necessário para que as
-- migrações possam ser aplicadas e conferidas em um banco descartável.
--
-- NÃO É PARA PRODUÇÃO. Serve a um propósito só: provar que as migrações
-- aplicam, que são idempotentes e que a reversão funciona, sem depender de um
-- projeto Supabase real. As colunas reproduzidas são apenas aquelas de que as
-- migrações dependem; a plataforma tem muito mais.
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Em produção devolve o usuário da sessão a partir do JWT; aqui devolve nulo, o
-- que basta para que as políticas de RLS sejam criadas e validadas pelo parser.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- Papel que o PostgREST assume para requisições autenticadas. As políticas das
-- migrações concedem a ele, então precisa existir.
do $$ begin
  create role authenticated;
exception when duplicate_object then null; end $$;

do $$ begin
  create role anon;
exception when duplicate_object then null; end $$;

do $$ begin
  create role service_role;
exception when duplicate_object then null; end $$;
