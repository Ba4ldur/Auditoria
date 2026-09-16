-- =============================================================================
-- Verificação de RLS de `document_validations` (migração 0006)
--
-- Confere, com um usuário real (não o superusuário `postgres`), que a política
-- de RLS isola a tabela por organização: um usuário da organização A não pode
-- ler, inserir, atualizar nem apagar uma conferência de documento que
-- pertence à organização B — mesmo tendo acesso de escrita à tabela.
--
-- Roda contra o banco que `check-migrations.sh` deixa migrado. Concede a
-- `authenticated` os privilégios de tabela que, num projeto Supabase real, a
-- plataforma concede automaticamente na criação do projeto (as migrações
-- deste repositório nunca os declaram, de propósito — não são responsabilidade
-- da aplicação).
--
-- Uso:  psql -d attivare_migrations_check -v ON_ERROR_STOP=1 -f check-document-validations-rls.sql
-- =============================================================================

\set ON_ERROR_STOP on

grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

do $$
declare
  org_a uuid := '00000000-0000-4000-8000-00000000a001';
  org_b uuid := '00000000-0000-4000-8000-00000000b001';
  user_a uuid := '00000000-0000-4000-8000-0000000a0001';
  user_b uuid := '00000000-0000-4000-8000-0000000b0001';
  audit_a uuid := '00000000-0000-4000-8000-000000ad0001';
  audit_b uuid := '00000000-0000-4000-8000-000000ad0002';
  company_a uuid;
  company_b uuid;
  row_a_id uuid;
  row_b_id uuid;
  seen_count int;
  raised boolean;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into public.organizations (id, name, slug)
    values (org_a, 'Organização A de Teste', 'org-a-teste-rls'),
           (org_b, 'Organização B de Teste', 'org-b-teste-rls')
    on conflict (id) do nothing;

  insert into auth.users (id, email) values (user_a, 'a@teste.local'), (user_b, 'b@teste.local')
    on conflict (id) do nothing;

  insert into public.profiles (id, organization_id, full_name)
    values (user_a, org_a, 'Usuário A'), (user_b, org_b, 'Usuário B')
    on conflict (id) do update set organization_id = excluded.organization_id;

  insert into public.companies (organization_id, legal_name, cnpj, uf, tax_regime)
    values (org_a, 'Empresa Auditada A', '33333333000155', 'SP', 'SIMPLES_NACIONAL')
    returning id into company_a;
  insert into public.companies (organization_id, legal_name, cnpj, uf, tax_regime)
    values (org_b, 'Empresa Auditada B', '44444444000136', 'SP', 'SIMPLES_NACIONAL')
    returning id into company_b;

  insert into public.audits (id, organization_id, company_id, competencia, status)
    values (audit_a, org_a, company_a, '2026-08', 'CONCLUIDA')
    on conflict (id) do nothing;
  insert into public.audits (id, organization_id, company_id, competencia, status)
    values (audit_b, org_b, company_b, '2026-08', 'CONCLUIDA')
    on conflict (id) do nothing;

  -- Semeadas como superusuário: RLS não se aplica a esta sessão.
  insert into public.document_validations
      (organization_id, audit_id, access_key, status, validated_by)
    values (org_a, audit_a, repeat('1', 44), 'CORRETO', 'Fixture A')
    returning id into row_a_id;
  insert into public.document_validations
      (organization_id, audit_id, access_key, status, validated_by)
    values (org_b, audit_b, repeat('2', 44), 'CORRETO', 'Fixture B')
    returning id into row_b_id;

  -- ------------------------------------------------- sessão do usuário A
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', user_a::text, true);

  select count(*) into seen_count from public.document_validations;
  if seen_count <> 1 then
    raise exception 'RLS FALHOU: usuário A deveria ver 1 linha (a própria) e viu %', seen_count;
  end if;

  select count(*) into seen_count from public.document_validations where id = row_b_id;
  if seen_count <> 0 then
    raise exception 'RLS FALHOU: usuário A conseguiu ler a linha da organização B';
  end if;

  -- Usuário A tenta inserir uma linha marcada como pertencendo à organização B.
  raised := false;
  begin
    insert into public.document_validations (organization_id, audit_id, access_key, status, validated_by)
      values (org_b, audit_b, repeat('3', 44), 'CORRETO', 'Invasão A→B');
  exception when others then
    raised := true;
  end;
  if not raised then
    raise exception 'RLS FALHOU: usuário A conseguiu inserir uma linha em nome da organização B';
  end if;

  -- Usuário A tenta atualizar a linha da organização B.
  update public.document_validations set status = 'REQUER_ANALISE' where id = row_b_id;
  get diagnostics seen_count = row_count;
  if seen_count <> 0 then
    raise exception 'RLS FALHOU: usuário A conseguiu atualizar a linha da organização B';
  end if;

  -- Usuário A tenta apagar a linha da organização B.
  delete from public.document_validations where id = row_b_id;
  get diagnostics seen_count = row_count;
  if seen_count <> 0 then
    raise exception 'RLS FALHOU: usuário A conseguiu apagar a linha da organização B';
  end if;

  -- Usuário A grava e lê de volta a própria conferência.
  update public.document_validations set status = 'REQUER_ANALISE', note = 'ok' where id = row_a_id;
  get diagnostics seen_count = row_count;
  if seen_count <> 1 then
    raise exception 'RLS FALHOU: usuário A não conseguiu atualizar a própria linha';
  end if;

  reset role;

  -- ------------------------------------------------- sessão do usuário B
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', user_b::text, true);

  select count(*) into seen_count from public.document_validations;
  if seen_count <> 1 then
    raise exception 'RLS FALHOU: usuário B deveria ver 1 linha (a própria) e viu %', seen_count;
  end if;

  select count(*) into seen_count from public.document_validations where id = row_a_id;
  if seen_count <> 0 then
    raise exception 'RLS FALHOU: usuário B conseguiu ler a linha da organização A';
  end if;

  -- A própria linha de B não foi afetada pelas tentativas (todas rejeitadas) do
  -- usuário A de inserir, atualizar ou apagar em nome da organização B.
  if not exists (
    select 1 from public.document_validations
    where id = row_b_id and status = 'CORRETO' and note is null
  ) then
    raise exception 'RLS FALHOU: a linha da organização B foi alterada por outra organização';
  end if;

  reset role;

  raise notice 'OK: RLS de document_validations isola por organização (select, insert, update e delete).';
end $$;
