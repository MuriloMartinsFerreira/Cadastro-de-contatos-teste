// Fluxo: login / cadastro -> (pendente: espera em tempo real) -> app.
// Segurança: só textContent (sem innerHTML), erros genéricos, e a autorização
// real está nas políticas RLS do banco; esta tela apenas reflete o estado.
const sb = supabase.createClient(window.APP_CONFIG.url, window.APP_CONFIG.anonKey);
const $ = (id) => document.getElementById(id);
const views = ['auth', 'waiting', 'app'];
let channel = null;

function show(name) {
  views.forEach((v) => { $('view-' + v).hidden = v !== name; });
}
function say(text) { $('msg').textContent = text || ''; }

function setTab(login) {
  $('form-login').hidden = !login;
  $('form-register').hidden = login;
  $('tab-login').setAttribute('aria-selected', String(login));
  $('tab-register').setAttribute('aria-selected', String(!login));
  say('');
}
$('tab-login').onclick = () => setTab(true);
$('tab-register').onclick = () => setTab(false);

async function fetchProfile(uid) {
  const { data, error } = await sb.from('profiles')
    .select('full_name, role, status').eq('id', uid).single();
  return error ? null : data;
}

// Decide a tela pelo status do perfil.
async function route(session) {
  if (!session) { stopWatching(); show('auth'); return; }
  const profile = await fetchProfile(session.user.id);
  if (!profile) { await sb.auth.signOut(); return; }

  if (profile.status === 'active') {
    stopWatching();
    $('app-title').textContent = 'Olá, ' + profile.full_name;
    $('app-role').textContent = profile.role === 'admin' ? 'Administrador' : 'Operador';
    show('app');
  } else if (profile.status === 'pending') {
    show('waiting');
    watchApproval(session);
  } else {
    await sb.auth.signOut();
    show('auth');
    say('Acesso indisponível. Fale com um administrador.');
  }
}

// Realtime: o RLS só deixa o usuário pendente ver a PRÓPRIA linha.
function watchApproval(session) {
  if (channel) return;
  const uid = session.user.id;
  channel = sb.channel('approval-' + uid)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter: 'id=eq.' + uid },
      () => route(session))
    .subscribe((status) => {
      // Reconsulta ao conectar: cobre aprovação ocorrida antes da assinatura.
      if (status === 'SUBSCRIBED') route(session);
    });
}
function stopWatching() {
  if (channel) { sb.removeChannel(channel); channel = null; }
}

$('form-login').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { error } = await sb.auth.signInWithPassword({
    email: f.get('email').trim(), password: f.get('password'),
  });
  if (error) say('E-mail ou senha inválidos.'); // mensagem genérica (anti-enumeração)
};

$('form-register').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (f.get('password').length < 12) { say('A senha precisa ter ao menos 12 caracteres.'); return; }
  const { data, error } = await sb.auth.signUp({
    email: f.get('email').trim(),
    password: f.get('password'),
    options: { data: { full_name: f.get('full_name').trim() } },
  });
  if (error) { say('Não foi possível concluir o cadastro. Revise os dados e tente de novo.'); return; }
  if (!data.session) say('Cadastro recebido. Confirme seu e-mail e depois entre.');
  // com sessão: onAuthStateChange leva à tela de espera
};

document.addEventListener('click', async (e) => {
  if (e.target.dataset.action === 'logout') { await sb.auth.signOut(); }
});

sb.auth.onAuthStateChange((_event, session) => {
  // setTimeout evita chamadas ao supabase dentro do callback (deadlock conhecido)
  setTimeout(() => route(session), 0);
});
