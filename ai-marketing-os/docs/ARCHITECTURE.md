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
| Propostas (link público assinado, PDF), contratos, cobrança | 3 | `modules/commercial` |
| Faturas, pagamentos, despesas, resumo, rentabilidade, configurações | 3 | `modules/finance` |
| Ações críticas com aprovação humana (HITL) | 3 | `modules/hitl` |
| Rotina de cobrança (worker) | 3 | `jobs/billing-tick.ts` |
| AI Gateway, Orchestrator, agentes, memória, Agent Room, QA, Chat Global | 4 | ver [AGENTS.md](AGENTS.md) |
| MCP Hub e integrações | 5 | ver [MCP.md](MCP.md) |
| Notificações, daily report, workflows, publicação | 6 | `notifications/`, `automation/`, `modules/automation/` |
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

**ADR-009 — Filas: outbox transacional (revisado na fase 4).** E-mails, antivírus e também as execuções de agentes rodam pelo outbox, que já tem retry com backoff, lease com `SKIP LOCKED` e dead-letter. Na fase 4 avaliamos BullMQ e mantivemos o outbox: a execução nasce na MESMA transação do dado que a originou (nunca há plano sem demanda nem job órfão), e a execução é reivindicada só se estiver `queued` (dois workers nunca rodam o mesmo agente). Execuções presas (worker caiu) viram `failed` visível após 30 min. BullMQ/filas dedicadas voltam à mesa na fase 8, com vários servidores.

**ADR-010 — Links públicos de proposta assinados com HMAC.** O token é `HMAC(APP_SECRET, id:nonce)`; o banco guarda só o SHA-256 dele. O e-mail é montado no worker recalculando o token — nada sensível em claro no outbox. Trocar o nonce revoga o link.

**ADR-011 — Aceite eletrônico simples agora; assinatura com certificado depois.** O aceite registra nome, concordância explícita, data/hora, IP e user-agent. Assinatura com validade de certificado (ICP-Brasil ou provedor de e-sign) entra como integração (`signature_status = esign_*`), sem mudar o modelo.

**ADR-012 — Despesas sempre no tenant da agência.** O rateio para um cliente é uma coluna, não o tenant da linha: nenhuma política de RLS de cliente alcança custos da agência.

**ADR-013 — HITL como infraestrutura.** Ações críticas viram `pending_actions` e só executam após decisão humana, com política por ação (`requires_approval`, `allow_self_approval`). Na fase 4 os agentes não têm nenhuma ferramenta capaz de disparar ação crítica (só leem e rascunham); quando ganharem ferramentas de escrita (fase 5, MCP), elas passarão por este mesmo mecanismo — sem autoaprovação.

**ADR-014 — AI Gateway único, provedor injetável.** Toda chamada a modelo passa por `ai/gateway.ts`: checa chave, IA ligada e orçamento do cliente ANTES de chamar; mede tokens e custo de cada tentativa em `ai_usage` (inclusive saídas inválidas e recusas); trata `stop_reason` (recusa, truncamento) como erro explícito. O provedor (`AnthropicProvider`, SDK oficial `@anthropic-ai/sdk`) é uma interface — os testes usam um provedor falso determinístico e nunca chamam a API real. Modelo padrão `claude-opus-5-5`, esforço por agente, saída estruturada validada por Zod, cache automático de prompt, streaming (evita timeout) e fallback do servidor da Anthropic (`fallbacks: "default"`, beta) quando o modelo recusa por política — desligável em `AI_SERVER_FALLBACK`.

**ADR-015 — Agentes produzem rascunhos; humanos decidem.** Agentes não têm ferramentas de escrita externa nesta fase: leem o contexto que o servidor monta (cliente, Brand Vault, demanda, memória aprovada) e devolvem rascunhos (`deliverables` em `draft`, com `agent_run_id`), pareceres de QA (`ai_review`, que nunca muda status) e propostas de memória. Enviar ao cliente, aprovar memória e criar tarefas da ata são cliques humanos. O QA da IA reprova automaticamente qualquer problema `blocker`/`major` (regra do sistema, não do modelo) e devolve ao agente até 2 vezes.

**ADR-016 — Conteúdo de cliente entra no prompt como dado.** Tudo que vem de clientes, arquivos ou mensagens é delimitado em tags (`<demanda>`, `<memoria>`…), com as tags neutralizadas dentro do conteúdo, e o system prompt declara que instruções dentro desses blocos não valem. Cada execução monta o contexto numa transação com RLS restrito ao tenant do job — mesmo um bug no montador não alcança outro cliente.

**ADR-017 — Embeddings opcionais pela OpenAI.** A Anthropic não tem API de embeddings. Com `OPENAI_API_KEY`, memórias aprovadas ganham embedding (`vector(1536)`, pgvector) e o contexto é ordenado por similaridade; sem a chave, a memória funciona por tipo/recência e a tela mostra `integration_pending`. A OpenAI é usada SOMENTE para embeddings.

**ADR-018 — MCP Hub com aprovação própria, executada pela fila.** O HITL da fase 3 executa a ação dentro da transação da decisão — adequado para mudanças no banco, não para chamadas externas lentas e falháveis. Ferramentas têm sua própria fila de decisão em `mcp_tool_calls`: aprovar só enfileira; o worker revalida política, conexão, circuito e limite antes de executar. Risco HIGH sempre exige decisão humana (código + CHECK no banco). Agentes só *propõem* ações; nunca aprovam.

**ADR-019 — Credenciais cifradas na aplicação.** AES-256-GCM com chave em `CREDENTIALS_KEY` (fora do banco, fora do backup do banco) e AAD amarrada a tenant + conexão. Um dump do banco não expõe senhas de integração. Perder a chave significa reconectar as integrações — nada mais.

**ADR-020 — Só integrações com API oficial e credenciais reais.** WordPress (REST API + senha de aplicativo), webhooks assinados (n8n/Make/Zapier) e e-mail (SMTP da plataforma) funcionam hoje. Meta, Google, Ads e WhatsApp exigem apps aprovados pelos provedores: aparecem como `integration_pending` com o que falta, e entram como novos arquivos de conector quando houver credenciais.

**ADR-021 — Notificações são do usuário; e-mail em fila própria.** Toda notificação passa por `deliver()`: grava a notificação interna (tabela com RLS por tenant **e** política restritiva `user_id = usuário da sessão` — nem um admin global lê a de outra pessoa) e enfileira um evento `mail.send` por e-mail, respeitando a preferência por categoria. O e-mail tem retry próprio: falha de SMTP nunca reprocessa o evento de domínio nem duplica a notificação interna. Destinatários vêm sempre de consultas do servidor.

**ADR-022 — Relatório diário só com fatos visíveis ao cliente.** As seções vêm de consultas ao banco com RLS do tenant (demandas, entregáveis enviados/aprovados, aprovações pendentes, agenda visível). Tarefas internas, QA, agentes e custos nunca entram. O agente Customer Success pode escrever a abertura e observações a partir desses fatos; sem IA, o texto é padrão. Rotinas diárias rodam uma vez por dia (tabela `job_runs` + advisory lock) no fuso `APP_TIMEZONE`.

**ADR-024 — Adobe só por interfaces oficiais, resultados no storage do cliente.** O conector usa exatamente o contrato publicado pela Adobe (IMS client_credentials, Firefly API v3); Photoshop/InDesign API ficam indisponíveis até o storage em nuvem (exigem URLs pré-assinadas de S3/Azure/Dropbox). Saídas viram arquivos internos do tenant; falha local após a geração não é repetida para não cobrar créditos em dobro.

**ADR-023 — Workflows são pedidos ao MCP Hub.** "Quando X → ferramenta Y" com parâmetros por marcadores; cada disparo é um pedido com solicitante `workflow` (mesma regra dos agentes: risco médio/alto exige aprovação humana), idempotente por (regra, evento) e executado com RLS restrito ao tenant do evento.

**ADR-007 — Integrações nunca simuladas.** Indicadores e integrações sem implementação retornam a fase prevista ou `integration_pending`.

## Roadmap

| Fase | Entrega | Critério de saída |
| --- | --- | --- |
| **1 · concluída** | Auth, usuários, tenants, RBAC, RLS, auditoria, dashboard, clientes, onboarding | Testes de isolamento A→B passando contra Postgres real |
| **2 · concluída** | Projetos, demandas, briefings, tarefas, entregáveis, QA, aprovações, arquivos/Brand Vault, calendário, notificações por e-mail | Download cruzado bloqueado; upload validado pelo conteúdo; DLQ no outbox |
| **3 · concluída** | Propostas (PDF + aceite online), contratos, cobrança automática, pagamentos, despesas, rentabilidade, HITL | Alterações financeiras auditadas e com HITL; cliente nunca alcança custos da agência |
| **4 · concluída** | AI Gateway, Orchestrator, 12 agentes, memória com aprovação humana, Agent Room, QA da IA, Chat Global, orçamento e custo por cliente | Memória e execuções isoladas por tenant (API + RLS + FK composta); custo por run e por cliente na rentabilidade |
| **5 · concluída** | MCP Hub, ferramentas declarativas, conectores (interno, e-mail, webhook/n8n, WordPress), credenciais cifradas, políticas, aprovação humana, circuit breaker, SSRF | Ferramenta HIGH nunca executa sem aprovação (código + CHECK no banco + teste de mutação) |
| **6 · concluída** | Notificações internas e por e-mail com preferências, relatório diário por cliente, lembretes (prazos, tarefas, aprovações), workflows, publicação agendada | Cada cliente recebe só o próprio relatório (RLS + destinatários do servidor + teste de mutação) |
| **7 · concluída** | Adobe Connector: Firefly Services (gerar e expandir imagens) pela API oficial, resultados como arquivos internos, Estúdio criativo; capacidades sem API oficial marcadas como indisponíveis | Contrato oficial (IMS + Firefly v3) verificado por testes contra servidor local; nenhuma geração repetida/cobrada em dobro; isolamento por cliente |
| 8 | Planos e limites, billing, observabilidade, otimização | Limites aplicados no backend |
