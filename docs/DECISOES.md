# Registro de decisões (ADR)

Formato: contexto, decisão, prós, contras. Status "A confirmar" indica premissa a validar com o avaliador.

## ADR-001: Supabase (BaaS) em vez de backend próprio
- **Contexto:** prazo de poucos dias; segurança do login é critério principal; low-code é aceito.
- **Decisão:** Supabase (Auth, Postgres, Realtime, Edge Functions) + frontend estático.
- **Prós:** autenticação e tokens maduros, sem criptografia caseira; autorização declarativa (RLS); paginação e agregações em SQL; realtime nativo; entrega rápida.
- **Contras:** dependência de fornecedor (lock-in; mitigado por ser Postgres padrão e por migrations versionadas); menos controle sobre o fluxo de login; limites do plano gratuito.
- **Alternativas:** Node/Express + Postgres (mais controle e mais código para manter e proteger no prazo); Firebase (agregações e paginação mais limitadas).

## ADR-002: Autorização no banco (RLS) e papel fora de user_metadata
- **Decisão:** papel e status em `profiles`, definidos por trigger; políticas RLS e grants por coluna.
- **Prós:** a regra vale para qualquer cliente; bloquear um usuário tem efeito imediato.
- **Contras:** regras em SQL exigem disciplina e testes (roadmap: pgTAP).
- **Nota:** `user_metadata` é editável pelo próprio usuário e por isso nunca é usado para autorização.

## ADR-003: Realtime por Postgres Changes
- **Decisão:** WebSocket do Supabase, com eventos filtrados pelo RLS.
- **Prós:** sem servidor próprio; o admin só recebe o que pode ler; o usuário pendente só vê o próprio perfil, o que resolve a espera de aprovação sem canal extra.
- **Contras:** limite de conexões simultâneas por plano; acoplamento ao Supabase. Em escala, migrar para canais de broadcast ou fila.

## ADR-004: Confirmação de e-mail desligada
- **Contexto:** para esperar a aprovação em tempo real, o usuário precisa de sessão logo após o cadastro.
- **Decisão:** desligar a confirmação nesta versão; a aprovação do admin é o controle de acesso.
- **Contras:** e-mails não verificados e possível enumeração de e-mails no cadastro. Mitigação em produção: CAPTCHA, e-mail verificado e outro mecanismo de espera.

## ADR-005: Operador vê somente os contatos que cadastrou (A confirmar)
- **Contexto:** o enunciado pede lista para admin e operador, sem definir escopo.
- **Decisão:** menor privilégio: operador vê os próprios; admin vê todos.
- **Contras:** se a intenção for uma agenda compartilhada, basta ajustar a política `contacts_select` (uma linha).

## ADR-006: Paginação por LIMIT/OFFSET
- **Prós:** simples, permite saltar para qualquer página, com índice em `created_at` e desempate por `id`.
- **Contras:** custo cresce com o deslocamento. Em volumes grandes, trocar por paginação por cursor (keyset).

## ADR-007: Frontend estático sem framework; deploy no Vercel
- **Prós:** mesma origem de deploy, zero build, superfície de ataque pequena, CSP estrita.
- **Contras:** menos estrutura para crescer; roadmap: Vite e módulos. O Vercel serve só arquivos estáticos; o realtime vai direto ao Supabase, então não há limitação de conexões longas.

## ADR-008: Contatos imutáveis nesta versão
- **Decisão:** sem UPDATE/DELETE. Preserva a trilha de auditoria e reduz o escopo; edição e exclusão lógica entram no roadmap.

## ADR-009: Configuração por variáveis de ambiente e sem credenciais no repositório
- **Decisão:** `web/config.js` fora do Git; no Vercel é gerado no build a partir de variáveis de ambiente, com trava contra chaves secretas. O script de demonstração exige senhas definidas por quem o executa.
- **Prós:** mesmo código para ambientes diferentes; nada sensível versionado; erro de colar a chave errada é barrado no build.
- **Contras:** um passo a mais no deploy. A anon key continua visível no navegador, o que é esperado: o RLS é a proteção.
