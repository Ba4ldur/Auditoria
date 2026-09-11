-- =============================================================================
-- Attivare Auditor — Row Level Security
--
-- Arquivos fiscais são confidenciais (requisito 27). Toda leitura e escrita
-- passa a exigir que a linha pertenca a organização do usuário autenticado.
--
-- A verificação usa a tabela `profiles`, que associa o usuário do Supabase Auth
-- a uma organização. A funcao e SECURITY DEFINER para que a própria consulta a
-- `profiles` não dependa de uma politica sobre `profiles`, o que geraria
-- recursao infinita.
-- =============================================================================

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_organization_id() from public;
grant execute on function public.current_organization_id() to authenticated;

-- -----------------------------------------------------------------------------
-- Politicas por tabela
-- -----------------------------------------------------------------------------
do $$
declare
  target text;
begin
  foreach target in array array[
    'organization_settings', 'companies', 'company_regime_history', 'audits',
    'audit_files', 'invoices', 'invoice_items', 'revenue_records', 'tax_records',
    'declarations', 'participant_records', 'audit_rules', 'audit_findings',
    'audit_finding_evidence', 'audit_comments'
  ] loop
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

-- Organização: o usuário enxerga apenas a própria, e não pode cria-la ou
-- exclui-la pela aplicacao.
alter table public.organizations enable row level security;
alter table public.organizations force row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.current_organization_id());

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (id = public.current_organization_id())
  with check (id = public.current_organization_id());

-- Perfis: cada usuário le os perfis da própria organização e altera apenas o seu.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and organization_id = public.current_organization_id());

-- -----------------------------------------------------------------------------
-- Storage: bucket privado de arquivos fiscais
--
-- O caminho de cada objeto e 'audits/<audit_id>/<file_id>-<nome>'. O acesso e
-- concedido quando a auditoria correspondente pertence a organização do usuário.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('fiscal-files', 'fiscal-files', false, 67108864)
on conflict (id) do update set public = false;

drop policy if exists fiscal_files_select on storage.objects;
create policy fiscal_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fiscal-files'
    and exists (
      select 1
      from public.audits a
      where a.organization_id = public.current_organization_id()
        and a.id::text = split_part(storage.objects.name, '/', 2)
    )
  );

drop policy if exists fiscal_files_insert on storage.objects;
create policy fiscal_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fiscal-files'
    and exists (
      select 1
      from public.audits a
      where a.organization_id = public.current_organization_id()
        and a.id::text = split_part(storage.objects.name, '/', 2)
    )
  );

drop policy if exists fiscal_files_delete on storage.objects;
create policy fiscal_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fiscal-files'
    and exists (
      select 1
      from public.audits a
      where a.organization_id = public.current_organization_id()
        and a.id::text = split_part(storage.objects.name, '/', 2)
    )
  );
