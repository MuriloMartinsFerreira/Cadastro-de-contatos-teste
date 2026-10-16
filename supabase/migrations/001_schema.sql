-- =====================================================================
-- 001_schema.sql  |  Rodar inteiro no SQL Editor do Supabase
-- Modelo: perfis (admin/operador, com aprovação), contatos, auditoria.
-- Segurança: RLS em tudo + grants mínimos (defesa em profundidade).
-- =====================================================================

create type public.user_role   as enum ('admin', 'operator');
create type public.user_status as enum ('pending', 'active', 'blocked');

-- ---------- Tabelas --------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text not null check (char_length(full_name) between 2 and 120),
  role       public.user_role   not null default 'operator',
  status     public.user_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 120),
  email      text check (email is null or char_length(email) <= 254),
  phone      text check (phone is null or char_length(phone) <= 30),
  city       text check (city is null or char_length(city) <= 80),
  category   text check (category is null or char_length(category) <= 40),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index contacts_created_at_idx on public.contacts (created_at desc);
create index contacts_created_by_idx on public.contacts (created_by);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,
  entity     text,
  entity_id  text,
  details    jsonb,
  created_at timestamptz not null default now()
);

-- ---------- Função auxiliar de autorização ---------------------------
-- Devolve o papel do usuário logado SOMENTE se ele estiver ativo.
-- security definer evita recursão de RLS ao consultar profiles.
create or replace function public.active_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid()) and status = 'active'
$$;

-- ---------- Trigger: todo cadastro nasce operador + pendente ---------
-- role/status NUNCA vêm do cliente (nem de user_metadata).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                  split_part(new.email, '@', 1)), 120)
  );
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (new.id, 'user.registered', 'profile', new.id::text);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Triggers de auditoria ------------------------------------
create or replace function public.audit_contact()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (new.created_by, 'contact.created', 'contact', new.id::text);
  return new;
end $$;

create trigger on_contact_created
  after insert on public.contacts
  for each row execute function public.audit_contact();

create or replace function public.audit_profile_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status or new.role is distinct from old.role then
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values ((select auth.uid()), 'user.updated', 'profile', new.id::text,
            jsonb_build_object('old_status', old.status, 'new_status', new.status,
                               'old_role', old.role, 'new_role', new.role));
  end if;
  return new;
end $$;

create trigger on_profile_changed
  after update on public.profiles
  for each row execute function public.audit_profile_change();

-- ---------- Grants mínimos -------------------------------------------
revoke all on public.profiles, public.contacts, public.audit_log from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (status, role) on public.profiles to authenticated;   -- só colunas de aprovação
grant select on public.contacts to authenticated;
grant insert (name, email, phone, city, category) on public.contacts to authenticated; -- created_by = default auth.uid()
grant select on public.audit_log to authenticated;

revoke execute on function public.active_role() from public, anon;
grant  execute on function public.active_role() to authenticated;
revoke execute on function public.handle_new_user(), public.audit_contact(),
                           public.audit_profile_change() from public, anon, authenticated;

-- ---------- RLS ------------------------------------------------------
alter table public.profiles  enable row level security;
alter table public.contacts  enable row level security;
alter table public.audit_log enable row level security;

-- profiles: cada um lê o próprio; admin ativo lê todos.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.active_role()) = 'admin');

-- profiles: só admin ativo altera (aprovar/bloquear), nunca o próprio perfil.
create policy profiles_update_admin on public.profiles for update to authenticated
  using      ((select public.active_role()) = 'admin' and id <> (select auth.uid()))
  with check ((select public.active_role()) = 'admin' and id <> (select auth.uid()));
-- (sem policy de INSERT/DELETE: só o trigger cria perfis)

-- contacts: operador ativo vê/cria os seus; admin ativo vê todos.
create policy contacts_select on public.contacts for select to authenticated
  using ((select public.active_role()) = 'admin'
      or ((select public.active_role()) = 'operator' and created_by = (select auth.uid())));

create policy contacts_insert on public.contacts for insert to authenticated
  with check ((select public.active_role()) = 'operator' and created_by = (select auth.uid()));
-- (sem UPDATE/DELETE: contatos são imutáveis nesta versão)

-- audit_log: somente admin ativo lê; ninguém escreve direto (só triggers).
create policy audit_select_admin on public.audit_log for select to authenticated
  using ((select public.active_role()) = 'admin');

-- ---------- Realtime (respeita RLS) ----------------------------------
alter publication supabase_realtime add table public.profiles, public.contacts, public.audit_log;

-- =====================================================================
-- DEPOIS de criar sua conta pela tela de cadastro, promova-a a admin:
--   update public.profiles set role = 'admin', status = 'active'
--   where email = 'SEU_EMAIL_AQUI';
-- =====================================================================
