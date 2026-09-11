-- =============================================================================
-- Organização inicial.
--
-- O identificador fixo abaixo e o valor padrão de ATTIVARE_ORGANIZATION_ID.
-- Ajuste ambos se a instalacao usar outro identificador.
-- =============================================================================

insert into public.organizations (id, name, slug)
values ('00000000-0000-4000-8000-000000000001', 'Attivare Auditor', 'attivare')
on conflict (id) do nothing;

insert into public.organization_settings (organization_id)
values ('00000000-0000-4000-8000-000000000001')
on conflict (organization_id) do nothing;

-- Vincula automaticamente cada novo usuário do Supabase Auth a organização,
-- criando o perfil correspondente.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, organization_id, full_name, email)
  values (
    new.id,
    coalesce(
      (new.raw_user_meta_data ->> 'organization_id')::uuid,
      '00000000-0000-4000-8000-000000000001'
    ),
    new.raw_user_meta_data ->> 'full_name',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
