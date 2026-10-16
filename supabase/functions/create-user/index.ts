// Edge Function: o admin cria usuários já ativos.
// É o único lugar que usa a service_role key (nunca vai ao navegador).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  // Em produção, configure ALLOWED_ORIGIN como segredo no Supabase.
  // O fallback mantém a função restrita ao frontend publicado.
  'Access-Control-Allow-Origin':
    Deno.env.get('ALLOWED_ORIGIN') ?? 'https://cadastro-de-contatos-teste.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;

  // 1) Quem está chamando? Cliente com o JWT do chamador (RLS aplicado).
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'Não autenticado.' }, 401);
  const { data: callerRole } = await caller.rpc('active_role');
  if (callerRole !== 'admin') return json({ error: 'Apenas administradores.' }, 403);

  // 2) Validação de entrada.
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Corpo inválido.' }, 400); }
  const email = String(b.email ?? '').trim().toLowerCase();
  const fullName = String(b.full_name ?? '').trim();
  const password = String(b.password ?? '');
  const role = b.role === 'admin' ? 'admin' : 'operator';
  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email) || email.length > 254) return json({ error: 'E-mail inválido.' }, 400);
  if (fullName.length < 2 || fullName.length > 120) return json({ error: 'Nome deve ter de 2 a 120 caracteres.' }, 400);
  if (password.length < 12 || password.length > 72) return json({ error: 'Senha deve ter de 12 a 72 caracteres.' }, 400);

  // 3) Criação com service_role (o trigger cria o perfil pendente; aqui ativamos).
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error || !data.user) return json({ error: 'Não foi possível criar o usuário.' }, 400);

  const { error: upErr } = await admin.from('profiles')
    .update({ status: 'active', role }).eq('id', data.user.id);
  if (upErr) {
    await admin.auth.admin.deleteUser(data.user.id); // não deixa usuário pela metade
    return json({ error: 'Falha ao ativar o usuário.' }, 500);
  }
  await admin.from('audit_log').insert({
    actor_id: user.id, action: 'user.created_by_admin', entity: 'profile', entity_id: data.user.id,
  });
  return json({ ok: true, id: data.user.id }, 201);
});
