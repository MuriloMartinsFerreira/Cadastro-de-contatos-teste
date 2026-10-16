-- =====================================================================
-- reset_demo.sql  |  SOMENTE AMBIENTE DE TESTE
-- APAGA todos os usuários, perfis, contatos e a auditoria; depois recria
-- 1 administrador, 1 operador (ambos ativos) e 20 contatos de exemplo.
--
-- Antes de rodar: troque as duas senhas abaixo (mín. 12 caracteres) na sua
-- cópia local. O script recusa as senhas-modelo. Não faça commit de senhas.
-- Pré-requisito: migrations 001 e 002 já aplicadas.
-- Roda numa única transação: se algo falhar, nada é alterado.
-- =====================================================================
do $$
declare
  v_admin_email text := 'marina.duarte@exemplo.com';
  v_admin_name  text := 'Marina Duarte';
  v_admin_pass  text := 'TROQUE-ESTA-SENHA';
  v_op_email    text := 'rafael.nogueira@exemplo.com';
  v_op_name     text := 'Rafael Nogueira';
  v_op_pass     text := 'TROQUE-ESTA-SENHA';

  v_admin_id uuid := gen_random_uuid();
  v_op_id    uuid := gen_random_uuid();
  r record;
begin
  if v_admin_pass like 'TROQUE%' or v_op_pass like 'TROQUE%' then
    raise exception 'Defina as senhas no topo do script antes de executar.';
  end if;
  if length(v_admin_pass) < 12 or length(v_op_pass) < 12 then
    raise exception 'As senhas precisam ter ao menos 12 caracteres.';
  end if;

  -- 1) Zerar (contatos antes de usuários por causa da chave estrangeira;
  --    apagar auth.users remove perfis, identidades e sessões em cascata).
  truncate table public.audit_log restart identity;
  delete from public.contacts;
  delete from auth.users;

  -- 2) Criar usuários de login por e-mail e senha (o trigger cria o perfil pendente).
  for r in
    select * from (values
      (v_admin_id, v_admin_email, v_admin_name, v_admin_pass),
      (v_op_id,    v_op_email,    v_op_name,    v_op_pass)
    ) as t(id, email, full_name, pass)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated',
      r.email, extensions.crypt(r.pass, extensions.gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', r.full_name), now(), now(), '', '', '', ''
    );
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), r.id, r.id::text,
      jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;

  -- 3) Ativar e definir papéis.
  update public.profiles set role = 'admin', status = 'active' where id = v_admin_id;
  update public.profiles set status = 'active' where id = v_op_id;

  -- 4) Contatos de exemplo (20 = 2 páginas de 10), do operador.
  insert into public.contacts (name, email, phone, city, category, created_by, created_at)
  select 'Contato ' || lpad(i::text, 2, '0'),
         'contato' || i || '@exemplo.com',
         '(62) 9' || lpad((1000 + i * 37)::text, 4, '0') || '-' || lpad((2000 + i * 91)::text, 4, '0'),
         (array['Goiânia','Anápolis','Aparecida de Goiânia','Rio Verde','Brasília'])[1 + i % 5],
         (array['Cliente','Fornecedor','Parceiro'])[1 + i % 3],
         v_op_id, now() - (i || ' hours')::interval
  from generate_series(1, 20) i;

  raise notice 'Pronto: admin % e operador % com 20 contatos.', v_admin_email, v_op_email;
end $$;
