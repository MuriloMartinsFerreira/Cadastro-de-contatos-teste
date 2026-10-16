# Arquitetura e análise de requisitos

Os diagramas estão em Mermaid (renderizam no GitHub e em editores Markdown).

## 1. Atores

- **Visitante:** ainda sem conta; pode solicitar acesso e entrar.
- **Operador:** usuário aprovado que cadastra contatos.
- **Administrador:** aprova acessos, cria usuários, recebe notificações e vê o dashboard.

## 2. Requisitos

### Funcionais

| ID | Requisito | Estado |
|---|---|---|
| RF01 | Login com e-mail e senha | Implementado |
| RF02 | Visitante solicita cadastro; fica pendente até aprovação | Implementado |
| RF03 | Operador pendente vê a aprovação em tempo real, sem recarregar | Implementado |
| RF04 | Admin aprova ou recusa solicitações | Implementado |
| RF05 | Admin cria usuários (operador ou admin) já ativos | Implementado |
| RF06 | Operador cadastra contatos | Implementado |
| RF07 | Cada contato novo notifica o admin em tempo real | Implementado |
| RF08 | Listas de contatos paginadas no backend (operador: próprios; admin: todos) | Implementado |
| RF09 | Dashboard do admin com métricas em tempo real | Implementado |
| RF10 | Admin analisa a atividade (auditoria) | Parcial: gravada no banco; falta a tela |
| RF11 | Admin lista, bloqueia e reativa usuários | Parcial: regra no banco; falta a tela |

### Não funcionais

| ID | Requisito | Como é atendido |
|---|---|---|
| RNF01 | Segurança de autenticação e autorização | Supabase Auth, RLS, grants por coluna, CSP |
| RNF02 | Tempo real | Realtime (WebSocket) filtrado por RLS |
| RNF03 | Escalabilidade de consultas | Índices e paginação no banco |
| RNF04 | Manutenibilidade | Migrations versionadas, ADRs, regras de acesso em código SQL |
| RNF05 | Auditabilidade | `audit_log` alimentada por triggers |
| RNF06 | Implantação simples | Vercel + Supabase, sem servidor próprio |

## 3. Casos de uso

```mermaid
flowchart LR
  V(["Visitante"])
  O(["Operador"])
  A(["Administrador"])
  V --> U1["Solicitar acesso"]
  V --> U2["Entrar"]
  O --> U3["Aguardar aprovação em tempo real"]
  O --> U4["Cadastrar contato"]
  O --> U5["Consultar meus contatos paginados"]
  A --> U6["Aprovar ou recusar solicitações"]
  A --> U7["Criar usuário"]
  A --> U8["Receber notificações em tempo real"]
  A --> U9["Consultar todos os contatos paginados"]
  A --> U10["Visualizar dashboard"]
```

## 4. Visão de containers

```mermaid
flowchart TB
  subgraph Navegador
    SPA["Frontend estático HTML e JS"]
  end
  subgraph Vercel
    HOST["Hospedagem estática com CSP"]
  end
  subgraph Supabase
    AUTH["Auth: bcrypt e JWT"]
    API["PostgREST: API sobre o banco"]
    RT["Realtime: WebSocket"]
    FN["Edge Function create-user"]
    DB[("PostgreSQL com RLS")]
  end
  HOST --> SPA
  SPA -->|"login e cadastro"| AUTH
  SPA -->|"consultas com JWT"| API
  SPA <-->|"eventos"| RT
  SPA -->|"criar usuário"| FN
  AUTH --> DB
  API --> DB
  RT --> DB
  FN -->|"service_role"| DB
```

## 5. Sequências

### 5.1 Cadastro e aprovação em tempo real

```mermaid
sequenceDiagram
  actor Op as Operador
  participant W as Frontend
  participant A as Supabase Auth
  participant DB as Postgres com RLS
  participant RT as Realtime
  actor Ad as Administrador
  Op->>W: Preenche o cadastro
  W->>A: signUp com e-mail, senha e nome
  A->>DB: INSERT em auth.users
  DB->>DB: trigger cria profile operator e pending
  A-->>W: sessão
  W->>RT: assina UPDATE do próprio profile
  RT-->>Ad: INSERT em profiles, vira notificação
  Ad->>DB: UPDATE status para active, permitido só ao admin
  DB-->>RT: mudança no profile
  RT-->>W: evento de UPDATE
  W->>Op: libera a área de contatos sem recarregar
```

### 5.2 Cadastro de contato e notificação

```mermaid
sequenceDiagram
  actor Op as Operador
  participant W as Frontend
  participant API as PostgREST
  participant DB as Postgres com RLS
  participant RT as Realtime
  actor Ad as Administrador
  Op->>W: Salva o contato
  W->>API: POST contacts com JWT
  API->>DB: INSERT, política exige operador ativo e created_by igual a auth.uid
  DB->>DB: trigger grava audit_log
  DB-->>RT: INSERT em contacts
  RT-->>Ad: evento, entregue só ao admin pelo RLS
  Ad->>API: recarrega lista paginada e dashboard_metrics
```

### 5.3 Criação de usuário pelo admin

```mermaid
sequenceDiagram
  actor Ad as Administrador
  participant W as Frontend
  participant FN as Edge Function
  participant DB as Postgres
  Ad->>W: Preenche novo usuário
  W->>FN: invoke create-user com JWT
  FN->>DB: active_role do chamador com o JWT dele
  FN->>FN: valida entrada
  FN->>DB: createUser e ativa o perfil com service_role
  FN->>DB: grava audit_log
  FN-->>W: 201, ou 403 se não for admin
```

## 6. Estados do usuário

```mermaid
stateDiagram-v2
  [*] --> pending: cadastro público
  [*] --> active: criado pelo admin
  pending --> active: admin aprova
  pending --> blocked: admin recusa
  active --> blocked: admin bloqueia
  blocked --> active: admin reativa
```

Somente o estado `active` dá acesso a dados. Bloqueio e reativação já são permitidos pelo RLS; a tela correspondente está no roadmap.

## 7. Modelo de dados

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "um para um"
  PROFILES ||--o{ CONTACTS : "cadastra"
  PROFILES ||--o{ AUDIT_LOG : "gera, referência lógica"
  PROFILES {
    uuid id PK
    text email
    text full_name
    enum role "admin ou operator"
    enum status "pending, active ou blocked"
    timestamptz created_at
  }
  CONTACTS {
    uuid id PK
    text name
    text email
    text phone
    text city
    text category
    uuid created_by FK
    timestamptz created_at
  }
  AUDIT_LOG {
    bigint id PK
    uuid actor_id
    text action
    text entity
    text entity_id
    jsonb details
    timestamptz created_at
  }
```

## 8. Ameaças e mitigações

| Ameaça | Mitigação | Risco residual |
|---|---|---|
| Elevação de privilégio no cadastro | Papel e status por trigger; sem `user_metadata` na autorização; grants por coluna | Baixo |
| Acesso indevido a dados de outros (IDOR) | RLS em todas as tabelas, avaliado a cada requisição | Baixo |
| Uso de conta pendente ou bloqueada | `active_role()` exige status ativo | Baixo |
| Vazamento da `service_role` | Só existe na Edge Function, como segredo do ambiente | Baixo |
| Força bruta e credential stuffing | Senha longa, erro genérico e limites de taxa do Supabase Auth | Médio: faltam CAPTCHA e 2FA |
| XSS | Sem `innerHTML`, CSP restritiva | Médio: token acessível ao JS da página |
| CSRF | Autenticação por cabeçalho `Authorization`, não por cookie | Baixo |
| Enumeração de e-mails no cadastro | Mensagens genéricas no login | Médio: o cadastro pode revelar e-mails existentes |
| Cadastros em massa | Aprovação manual do admin | Médio: faltam CAPTCHA e limite por IP |
| Dependência de CDN | Versão fixa do supabase-js | Médio: roadmap Vite com bundle local |

## 9. Escalabilidade e manutenibilidade

**Gargalos prováveis, em ordem, e o caminho de cada um**

1. **Paginação por OFFSET:** índice em `created_at` hoje; paginação por cursor em volumes altos.
2. **Dashboard:** agregações recalculadas a cada evento; evoluir para visão materializada ou cache com atualização por job.
3. **Realtime:** limite de conexões por plano; evoluir para canais de broadcast ou fila de eventos, mantendo o RLS.
4. **Banco:** réplicas de leitura e pool de conexões gerenciado quando a leitura dominar.
5. O frontend estático escala por CDN, sem servidor de aplicação a dimensionar.

**Manutenibilidade e processos**

- Esquema e regras de acesso versionados em `supabase/migrations` (revisáveis em pull request).
- Decisões registradas em `docs/DECISOES.md`.
- Próximos passos de processo: CI com lint, testes SQL (pgTAP) para as políticas RLS, testes E2E (Playwright), ambientes separados (dev e produção) e geração de tipos a partir do esquema.
