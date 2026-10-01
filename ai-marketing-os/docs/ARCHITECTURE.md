# Arquitetura

## Visão geral

```
 Navegador ──HTTPS──► Caddy (TLS, HSTS, limite de corpo)
                        ├── /api/*  ──► api     (Fastify)  ──┐
                        └── /*      ──► web     (Next.js)    │
                                                             ▼
                         worker (outbox) ◄──── PostgreSQL 16 (RLS, pgvector)
                              │                Redis 7 (rate limit; filas na fase 2)
                              └──► SMTP        Object storage S3 (fase 2)
```

- **Monólito modular.** Uma API com módulos de fronteira explícita (`apps/api/src/modules/*`). Extração para serviços só quando a carga pedir.
- **Mesma origem.** O navegador fala apenas com `/api` no mesmo domínio. Cookies `SameSite=Strict`, nenhum segredo no frontend.
- **Eventos via outbox.** Eventos de domínio (`client.created`, `user.invite`…) são gravados na mesma transação do dado e processados pelo worker com retry/backoff/dead-letter. Na fase 2 o worker passa a publicar em filas BullMQ especializadas (agentes, arquivos, relatórios, embeddings, MCP).

## Mapa de módulos

| Módulo | Fase | Local |
| --- | --- | --- |
| Identity & Access (auth, sessões, senhas) | 1 | `modules/auth`, `security/` |
| Tenants | 1 | `modules/tenants` |
| CRM / Clientes + onboarding | 1 | `modules/clients` |
| Usuários, papéis e associações | 1 | `modules/users` |
| Dashboard admin / Maurílio Desk / portal | 1 | `modules/dashboard`, `apps/web` |
| Auditoria | 1 | `modules/audit` |
| Projetos, demandas, briefings, tarefas, entregáveis, QA, aprovações | 2 | `modules/projects`, `modules/demands`, `modules/tasks` |
| Arquivos, Brand Vault (storage por tenant, detecção de tipo, ClamAV) | 2 | `modules/files`, `storage/` |
| Calendário | 2 | `modules/calendar` |
| Propostas, contratos, financeiro, pagamentos, rentabilidade | 3 | — |
| AI Gateway, Orchestrator, agentes, memória, Agent Room, QA, Chat Global | 4 | ver [AGENTS.md](AGENTS.md) |
| MCP Hub e integrações | 5 | ver [MCP.md](MCP.md) |
| Notificações, daily report, workflows, publicação | 6 | — |
| Adobe Connector | 7 | ver [MCP.md](MCP.md#adobe-connector) |
| Planos, billing, observabilidade, custos | 8 | — |

## Cadeia de autorização

Toda requisição percorre `USER → TENANT → ROLE → PERMISSION → RESOURCE`:

1. **USER** — `security/plugin.ts` resolve a sessão (hash do token) e o usuário ativo.
2. **TENANT** — as associações vêm do banco (`tenant_users`); o header `X-Tenant-Id` apenas *estreita* o escopo e é recusado (403) se estiver fora delas.
3. **ROLE** — papel global (SUPER_ADMIN/ADMIN) ou papel da associação.
4. **PERMISSION** — cada rota declara `config.permission`; uma rota sem política impede a API de subir.
5. **RESOURCE** — `Access.context(permission)` gera o contexto de RLS com *somente* os tenants onde a permissão vale; a consulta roda em `withContext()` e o PostgreSQL filtra. Recurso de outro tenant = 404 idêntico ao de recurso inexistente.

## Decisões arquiteturais (ADRs)

**ADR-001 — Banco compartilhado com RLS em vez de schema/banco por tenant.** Escala para centenas de clientes sem multiplicar migrations e conexões; o isolamento é garantido pelo PostgreSQL. Mitigações: RLS forçado, role sem BYPASSRLS, contexto por transação (`SET LOCAL`), FKs compostas, testes de isolamento obrigatórios. Clientes enterprise podem migrar para banco dedicado no futuro sem mudar o modelo.

**ADR-002 — Sessões opacas em vez de JWT.** Revogação imediata (logout, troca de senha, desativação, mudança de papel), nada sensível legível no cliente. Custo: uma consulta por requisição, aceitável.

**ADR-003 — SQL versionado + node-postgres em vez de ORM.** Políticas RLS, grants e funções são cidadãos de primeira classe nas migrations; consultas sempre parametrizadas; colunas de UPDATE vêm de listas fechadas.

**ADR-004 — Fastify.** Hooks `onRoute`/`onRequest` permitem exigir política em todas as rotas e montar a cadeia de autorização num único ponto.

**ADR-005 — Outbox transacional.** Garante que efeitos colaterais (e-mail, agentes) só acontecem se o dado foi gravado, e que nada se perde se o SMTP cair. O token de convite é gerado no momento do envio — nunca fica em claro no banco.

**ADR-006 — Tenant = empresa cliente; a agência é um tenant `agency`.** Dados internos da agência (despesas, equipe — fase 3) ficam isolados da mesma forma.

**ADR-008 — Arquivos em volume local, entregues pela API.** Cada arquivo fica em `tenants/{tenant}/{id}` (nome original nunca no caminho) e só sai por `GET /api/files/:id/download` após autorização, com auditoria. Sem URLs públicas. Backup diário do volume. Object storage S3 entra quando houver mais de um servidor (fase 8), atrás da mesma interface `LocalStorage`.

**ADR-009 — Filas: outbox agora, BullMQ na fase 4.** As tarefas assíncronas da fase 2 (e-mails, varredura antivírus) são curtas e cabem no outbox transacional, que já tem retry, backoff e dead-letter. BullMQ entra com os agentes (fase 4), onde há jobs longos e concorrência por fila.

**ADR-007 — Integrações nunca simuladas.** Indicadores e integrações sem implementação retornam a fase prevista ou `integration_pending`.

## Roadmap

| Fase | Entrega | Critério de saída |
| --- | --- | --- |
| **1 · concluída** | Auth, usuários, tenants, RBAC, RLS, auditoria, dashboard, clientes, onboarding | Testes de isolamento A→B passando contra Postgres real |
| **2 · concluída** | Projetos, demandas, briefings, tarefas, entregáveis, QA, aprovações, arquivos/Brand Vault, calendário, notificações por e-mail | Download cruzado bloqueado; upload validado pelo conteúdo; DLQ no outbox |
| 3 | Propostas (PDF), contratos, financeiro, pagamentos, rentabilidade | Alterações financeiras auditadas e com HITL |
| 4 | AI Gateway, Orchestrator, agentes, memória, Agent Room, QA, Chat Global | Memória isolada por tenant; custo por run |
| 5 | MCP Hub, ferramentas, conectores, permissões | Ferramenta HIGH nunca executa sem aprovação |
| 6 | Daily report, e-mails, notificações, workflows, publicação | Cada cliente recebe só o próprio relatório |
| 7 | Adobe Connector (APIs oficiais) | Workflow real testado |
| 8 | Planos e limites, billing, observabilidade, otimização | Limites aplicados no backend |
