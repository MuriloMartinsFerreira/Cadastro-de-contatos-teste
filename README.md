# Contatos: cadastro de contatos com aprovação de operadores

Aplicação web com dois perfis, **administrador** e **operador**. Operadores pedem acesso pela tela de login, aguardam aprovação em tempo real e cadastram contatos; o administrador aprova acessos, cria usuários, é notificado a cada contato novo e acompanha um dashboard.

Documentação complementar: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) (requisitos, UML, modelo de dados, ameaças, escalabilidade) e [`docs/DECISOES.md`](docs/DECISOES.md) (decisões com prós e contras).

## Requisitos atendidos

| Requisito do enunciado | Como foi atendido |
|---|---|
| Tela de login | Supabase Auth (e-mail e senha) |
| Operador solicita cadastro e espera aprovação em tempo real, sem recarregar | `signUp` cria perfil `pending`; a tela assina por WebSocket o próprio perfil e muda quando o admin aprova |
| Admin cadastra usuários e recebe solicitações | Edge Function `create-user` e painel de solicitações com Aprovar/Recusar |
| Operador cadastra contatos; admin é notificado em tempo real | Insert em `contacts`; o admin recebe o evento via Realtime e vê aviso na tela |
| Listas de contatos com consulta paginada no backend, 2 páginas ou mais | `.range()` (LIMIT/OFFSET) com contagem no banco; seed de 25 contatos (3 páginas de 10) |
| Segurança do login | Ver "Segurança" abaixo |
| Extra: dashboard | Função SQL `dashboard_metrics` com atualização em tempo real |
| Extra: deploy | Vercel (frontend) e Supabase (backend); `vercel.json` com cabeçalhos de segurança |

## Stack

Frontend estático (HTML, CSS, JavaScript) · Supabase (Auth, PostgreSQL com RLS, Realtime, Edge Functions) · Vercel. Justificativas e alternativas descartadas em [`docs/DECISOES.md`](docs/DECISOES.md).

## Segurança

- Senhas com bcrypt e tokens JWT de vida curta, gerenciados pelo Supabase Auth (sem criptografia caseira). Senha mínima de 12 caracteres.
- Todo cadastro público nasce `operator` + `pending`, definido por **trigger** no banco; papel e status nunca vêm do cliente nem de `user_metadata`.
- **Autorização no banco (RLS)** em todas as tabelas, mais grants por coluna. Usuário pendente ou bloqueado perde acesso a tudo imediatamente, pois o status é consultado a cada requisição.
- A `service_role` existe **somente** na Edge Function, que antes verifica se o chamador é admin ativo e valida a entrada.
- Mensagens de erro de login genéricas; frontend sem `innerHTML`; CSP restritiva e demais cabeçalhos em `vercel.json`.
- Auditoria de cadastros, contatos e mudanças de status na tabela `audit_log`.

## Como executar

**Pré-requisitos:** conta gratuita no [Supabase](https://supabase.com), Node.js 18+ (só para servir arquivos estáticos) e, opcionalmente, o [Supabase CLI](https://supabase.com/docs/guides/cli) para publicar a função.

1. **Criar o projeto** no Supabase e abrir o *SQL Editor*.
2. **Rodar `supabase/migrations/001_schema.sql`** inteiro.
3. **Configurar a autenticação** (Authentication > Sign In / Providers > Email): desligar *Confirm email* (necessário para a espera em tempo real; ver DECISOES) e definir senha mínima de 12.
4. **Configurar o frontend:** copie `web/config.example.js` para `web/config.js` (ignorado pelo Git) e preencha a *Project URL* e a *anon key* (Project Settings > API). A anon key é pública por desenho: quem protege os dados é o RLS. Nunca use a `service_role` aqui.
5. **Subir localmente:** `npx serve web` (ou `python3 -m http.server -d web 3000`) e abrir o endereço indicado.
6. **Criar o primeiro admin:** na aba "Solicitar acesso", cadastre sua conta; no SQL Editor, rode `update public.profiles set role = 'admin', status = 'active' where email = 'SEU_EMAIL';`
7. **Rodar `supabase/migrations/002_dashboard_seed.sql`** (cria o dashboard e 25 contatos de exemplo; exige ao menos um usuário ativo).
8. **Publicar a Edge Function:** `supabase login`, `supabase link --project-ref SEU_REF`, `supabase functions deploy create-user`.
9. **Deploy do frontend:** importar o repositório no Vercel (usa `vercel.json`, saída em `web/`). Em *Environment Variables*, defina `SUPABASE_URL` e `SUPABASE_ANON_KEY`: o build gera `web/config.js` a partir delas (`scripts/generate-config.mjs`, que recusa chaves secretas). Depois, adicionar a URL do site em Authentication > URL Configuration.

## Dados de demonstração (opcional)

`supabase/scripts/reset_demo.sql` **apaga todos os usuários, contatos e a auditoria** e recria um administrador (`marina.duarte@exemplo.com`), um operador (`rafael.nogueira@exemplo.com`) e os 25 contatos de exemplo. As senhas não ficam no repositório: edite-as na sua cópia local antes de rodar (o script se recusa a executar com a senha-modelo). Somente para ambientes de teste.

## Roteiro de verificação

Use duas janelas (uma anônima), uma com admin e outra com operador.

1. Cadastro de operador: a janela do admin mostra aviso e a solicitação na lista, sem recarregar.
2. Admin aprova: a tela de espera do operador muda sozinha para a área de contatos.
3. Operador salva um contato: o admin recebe aviso, e lista e dashboard atualizam sozinhos.
4. Listas: botões Anterior/Próxima mostram 3 páginas com o seed; o operador vê só os próprios contatos e o admin vê todos.
5. Admin cria usuário pelo formulário e esse usuário consegue entrar.
6. Admin recusa uma solicitação: esse usuário não acessa dados (RLS).

## Estrutura do repositório

```
web/                  frontend estático (index.html, app.js, main.js, style.css, config.example.js)
supabase/migrations/  esquema, RLS, dashboard e seed, versionados
supabase/functions/   Edge Function create-user
supabase/scripts/     reset_demo.sql: zera o banco e recria dados de demonstração
scripts/              generate-config.mjs: gera web/config.js no build
docs/                 requisitos, UML, decisões
vercel.json           deploy e cabeçalhos de segurança
```

## Limitações conhecidas e roadmap

Priorizadas por valor para o produto:

1. Painel de auditoria na tela do admin (os dados já são gravados) e gestão de usuários (listar, bloquear, reativar; o RLS já suporta).
2. CAPTCHA no cadastro e 2FA (TOTP) para administradores; reativar a confirmação de e-mail com outro mecanismo de espera.
3. Empacotar o frontend com Vite (remove o CDN), dividir `main.js` em módulos e adicionar CI com lint, testes SQL (pgTAP) e testes E2E (Playwright).
4. Escala: paginação por cursor, cache/visão materializada no dashboard (ver `docs/ARQUITETURA.md`).
5. Limitação de segurança assumida: o token da sessão fica acessível ao JavaScript da página (padrão do supabase-js); a CSP e a ausência de `innerHTML` mitigam o risco de XSS.
