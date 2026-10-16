// Área logada. Todo dado do banco é renderizado com textContent (anti-XSS).
// A autorização real é do RLS; esta tela só mostra o que o papel permite.
const App = (() => {
  const PAGE = 10;
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  let sb = null, me = null, page = 1, channels = [], timers = {};
  const debounce = (k, fn, ms = 400) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms); };

  function toast(text) {
    const t = el('p', text, 'toast');
    $('toasts').append(t);
    setTimeout(() => t.remove(), 7000);
  }

  // Paginação no backend: .range() vira LIMIT/OFFSET e count vem do banco.
  async function loadContacts() {
    const from = (page - 1) * PAGE;
    const { data, count, error } = await sb.from('contacts')
      .select('name,email,phone,city,category,profiles(full_name)', { count: 'exact' })
      .order('created_at', { ascending: false }).order('id')
      .range(from, from + PAGE - 1);
    if (error) { toast('Não foi possível carregar os contatos.'); return; }
    const total = count ?? 0;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    if (page > pages) { page = pages; return loadContacts(); }
    const body = $('contacts');
    body.replaceChildren();
    if (!data.length) {
      const tr = el('tr'), td = el('td', 'Nenhum contato cadastrado.');
      td.colSpan = 6; tr.append(td); body.append(tr);
    }
    for (const c of data) {
      const tr = el('tr');
      for (const v of [c.name, c.email, c.phone, c.city, c.category, c.profiles?.full_name]) tr.append(el('td', v ?? '-'));
      body.append(tr);
    }
    $('page-label').textContent = `Página ${page} de ${pages} (${total} contatos)`;
    $('prev').disabled = page <= 1;
    $('next').disabled = page >= pages;
  }

  async function loadPending() {
    const { data, error } = await sb.from('profiles').select('id,full_name,email')
      .eq('status', 'pending').order('created_at');
    if (error) return;
    const ul = $('pending');
    ul.replaceChildren();
    if (!data.length) { ul.append(el('li', 'Nenhuma solicitação pendente.')); return; }
    for (const p of data) {
      const li = el('li');
      li.append(el('span', `${p.full_name} (${p.email})`));
      for (const [label, status] of [['Aprovar', 'active'], ['Recusar', 'blocked']]) {
        const b = el('button', label, status === 'active' ? 'ok' : 'no');
        b.type = 'button';
        b.onclick = async () => {
          b.disabled = true;
          const { error: err } = await sb.from('profiles').update({ status }).eq('id', p.id);
          if (err) { toast('Não foi possível atualizar a solicitação.'); b.disabled = false; return; }
          loadPending(); loadDash();
        };
        li.append(b);
      }
      ul.append(li);
    }
  }

  async function loadDash() {
    const { data, error } = await sb.rpc('dashboard_metrics');
    if (error || !data) return;
    const box = $('dash');
    box.replaceChildren();
    const stats = el('div', null, 'stats');
    for (const [label, v] of [['Contatos', data.total], ['Hoje', data.today], ['Solicitações pendentes', data.pending]]) {
      const s = el('div'); s.append(el('strong', String(v)), el('span', label)); stats.append(s);
    }
    box.append(stats);
    const group = (title, rows) => {
      if (!rows.length) return;
      const sec = el('div', null, 'group');
      sec.append(el('h3', title));
      const max = Math.max(1, ...rows.map((r) => r.count));
      for (const r of rows) {
        const row = el('div', null, 'bar'), m = el('meter');
        m.max = max; m.value = r.count; m.setAttribute('aria-label', `${r.name}: ${r.count}`);
        row.append(el('span', r.name), m, el('b', String(r.count)));
        sec.append(row);
      }
      box.append(sec);
    };
    group('Por operador', data.by_operator);
    group('Por categoria', data.by_category);
    group('Últimos 7 dias', data.by_day.map((r) => ({ name: r.day.slice(8) + '/' + r.day.slice(5, 7), count: r.count })));
  }

  // Realtime do admin (o RLS garante que só o admin recebe estes eventos).
  function subscribe() {
    channels.push(sb.channel('admin-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contacts' }, (p) => {
        toast(`Novo contato: ${p.new.name}`);
        debounce('list', loadContacts); debounce('dash', loadDash);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, (p) => {
        toast(`Nova solicitação de acesso: ${p.new.full_name}`);
        debounce('pending', loadPending); debounce('dash', loadDash);
      })
      .subscribe());
  }

  function bindForms() {
    $('prev').onclick = () => { page--; loadContacts(); };
    $('next').onclick = () => { page++; loadContacts(); };

    $('form-contact').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const row = Object.fromEntries(['name', 'email', 'phone', 'city', 'category']
        .map((k) => [k, String(f.get(k) || '').trim() || null]));
      const { error } = await sb.from('contacts').insert(row);
      if (error) return toast('Não foi possível salvar o contato. Revise os campos.');
      e.target.reset(); page = 1; toast('Contato salvo.'); loadContacts();
    };

    $('form-user').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const { error } = await sb.functions.invoke('create-user', {
        body: { full_name: f.get('full_name').trim(), email: f.get('email').trim(),
                password: f.get('password'), role: f.get('role') },
      });
      if (error) {
        let msg = 'Não foi possível criar o usuário.';
        try { msg = (await error.context.json()).error || msg; } catch { /* mantém a genérica */ }
        return toast(msg);
      }
      e.target.reset(); toast('Usuário criado e ativo.');
    };
  }

  function start(client, profile, uid) {
    if (me && me.id === uid) return; // evita duplicar assinaturas
    stop();
    sb = client; me = { id: uid }; page = 1;
    const admin = profile.role === 'admin';
    $('admin-only').hidden = !admin;
    $('operator-only').hidden = admin;
    $('list-title').textContent = admin ? 'Todos os contatos' : 'Meus contatos';
    bindForms(); loadContacts();
    if (admin) { loadPending(); loadDash(); subscribe(); }
  }

  function stop() {
    if (sb) channels.forEach((c) => sb.removeChannel(c));
    channels = [];
    Object.values(timers).forEach(clearTimeout);
    timers = {}; me = null;
  }

  return { start, stop };
})();
