-- 002: métricas do dashboard (somente admin) + seed de 25 contatos (3 páginas de 10).

create or replace function public.dashboard_metrics()
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if (select public.active_role()) is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total',   (select count(*) from public.contacts),
    'today',   (select count(*) from public.contacts where created_at >= date_trunc('day', now())),
    'pending', (select count(*) from public.profiles where status = 'pending'),
    'by_operator', coalesce((select jsonb_agg(x order by x.count desc) from (
        select p.full_name as name, count(*) from public.contacts c
        join public.profiles p on p.id = c.created_by group by p.id, p.full_name) x), '[]'),
    'by_category', coalesce((select jsonb_agg(x order by x.count desc) from (
        select coalesce(category, 'Sem categoria') as name, count(*) from public.contacts group by 1) x), '[]'),
    'by_day', coalesce((select jsonb_agg(x order by x.day) from (
        select created_at::date as day, count(*) from public.contacts
        where created_at >= now() - interval '7 days' group by 1) x), '[]')
  );
end $$;

revoke execute on function public.dashboard_metrics() from public, anon;
grant  execute on function public.dashboard_metrics() to authenticated;

-- Seed: atribui ao primeiro operador ativo (ou ao admin, se não houver operador).
do $$
declare owner_id uuid;
begin
  select id into owner_id from public.profiles
  where status = 'active' order by (role = 'operator') desc, created_at limit 1;
  if owner_id is null then raise exception 'Crie e aprove ao menos um usuário antes do seed.'; end if;

  insert into public.contacts (name, email, phone, city, category, created_by, created_at)
  select 'Contato ' || lpad(i::text, 2, '0'),
         'contato' || i || '@exemplo.com',
         '(62) 9' || lpad((1000 + i * 37)::text, 4, '0') || '-' || lpad((2000 + i * 91)::text, 4, '0'),
         (array['Goiânia','Anápolis','Aparecida de Goiânia','Rio Verde','Brasília'])[1 + i % 5],
         (array['Cliente','Fornecedor','Parceiro'])[1 + i % 3],
         owner_id, now() - (i || ' hours')::interval
  from generate_series(1, 25) i;
end $$;
