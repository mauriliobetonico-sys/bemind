# API

Base: `/api`. JSON. Autenticação por cookie de sessão; requisições `POST/PUT/PATCH/DELETE` exigem o header `X-CSRF-Token` (valor recebido no login e no cookie `__Host-aimos_csrf`). Opcional: `X-Tenant-Id` para restringir a operação a um tenant (recusado com 403 se fora das associações).

Erros: `{ "error": "<código>", "message": "...", "details"?: [{ "path", "message" }] }` — `400 bad_request`, `401 unauthorized`, `403 forbidden|csrf`, `404 not_found` (inclui recurso de outro tenant), `409 conflict`, `429 rate_limited`, `500 internal`.

## Saúde

| Método | Rota | Política | Descrição |
| --- | --- | --- | --- |
| GET | `/health` | pública | Liveness |
| GET | `/ready` | pública | Banco e status do SMTP (`configured`/`integration_pending`) |

## Autenticação

| Método | Rota | Política | Corpo / resposta |
| --- | --- | --- | --- |
| POST | `/auth/login` | pública, rate limit | `{ email, password }` → `{ csrfToken, user }` + cookies |
| POST | `/auth/logout` | sessão | 204 |
| GET | `/auth/me` | sessão | usuário, associações, permissões (global e por tenant), `isStaff` |
| POST | `/auth/password/set` | pública, rate limit | `{ token, password }` → 204 (convite ou redefinição; encerra sessões) |
| POST | `/auth/password/forgot` | pública, rate limit | `{ email }` → 202 sempre |

## Clientes

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/clients?q=&status=&limit=&offset=` | `clients:read` | Lista paginada dos tenants autorizados |
| GET | `/clients/:id` | `clients:read` | Detalhe (404 fora do escopo) |
| GET | `/clients/:id/events` | `clients:read` | Histórico |
| POST | `/clients` | `tenants:manage` | Cria cliente e provisiona tenant, usuário CLIENTE, convite, eventos e auditoria |
| PATCH | `/clients/:id` | `clients:write` | Atualização parcial; registra diff no histórico |

Corpo de criação (`createClientInput`): `legalName, tradeName, cnpj?, responsibleName, phone?, email, address?{street,number,complement,district,city,state,zip}, segment?, niche?, plan(START|PRO|BUSINESS|ENTERPRISE), status?(prospect|onboarding|active|paused|churned), monthlyFeeCents, startDate?(YYYY-MM-DD), dueDay?(1–28), notes?, inviteUser?(true)`.

## Usuários e acessos

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/users` | `users:read` | Global: todos; GESTOR: membros dos tenants atribuídos |
| POST | `/users` | `users:manage` | Convida pessoa da equipe `{ name, email, globalRole? }` (só SUPER_ADMIN cria SUPER_ADMIN) |
| PATCH | `/users/:id` | `users:manage` | `{ name?, status?, globalRole? }` — revoga sessões em mudança de acesso |
| PUT | `/users/:id/memberships` | `users:manage` | `{ tenantId, roleKey: GESTOR|OPERADOR|CLIENTE }` |
| DELETE | `/users/:id/memberships/:tenantId` | `users:manage` | Remove associação |
| POST | `/users/:id/resend-invite` | `users:manage` | Reenvia convite (novo link, invalida o anterior) |

## Tenants

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/tenants` | `tenants:read` | Lista com contagem de usuários |
| PATCH | `/tenants/:id` | `tenants:manage` | `{ status }` — suspender/arquivar corta o acesso imediatamente |

## Operação (Fase 2)

Criação de recursos exige **um** cliente: usuários com um único tenant não informam nada; a equipe envia `X-Tenant-Id` (validado contra as associações). Listagens agregam só os tenants autorizados.

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET/POST | `/projects` | `work:read` / `work:manage` | Lista e cria projetos |
| GET/PATCH | `/projects/:id` | `work:read` / `work:manage` | Detalhe e atualização |
| GET | `/demands?status=&open=&projectId=` | `work:read` | Demandas (cliente vê só as suas) |
| POST | `/demands` | `demands:create` | Abre demanda → evento `demand.created` (e-mail à equipe) |
| GET | `/demands/:id` | `work:read` | Demanda + briefing + entregáveis + linha do tempo (cliente não vê rascunhos nem notas de QA) |
| PATCH | `/demands/:id` | `work:manage` | Campos e transições manuais válidas de status |
| PUT | `/demands/:id/briefing` | `work:manage` | Nova versão do briefing |
| POST | `/demands/:id/deliverables` | `work:manage` | Cria entregável |
| PATCH | `/deliverables/:id` | `work:manage` | Edita rascunho; `action`: `submit_for_qa`, `qa_reject` (exige `qaNotes`), `new_version` |
| POST | `/deliverables/:id/request-approval` | `approvals:request` | Só a partir de `internal_review` (QA); libera o arquivo ao cliente; e-mail ao cliente |
| GET | `/approvals?status=` | `work:read` | Aprovações |
| POST | `/approvals/:id/decide` | `approvals:decide` | `{ decision: approved \| changes_requested, reason }` — somente o cliente |
| GET/POST | `/tasks` | `tasks:read` / `tasks:write` | Tarefas internas (`?mine=&overdue=&status=&demandId=`); responsável precisa ser da equipe do cliente |
| PATCH | `/tasks/:id` | `tasks:write` | Atualiza tarefa |
| GET | `/files?category=&demandId=&q=` | `files:read` | Arquivos (internos só para a equipe) |
| POST | `/files?demandId=&visibility=` | `files:write` | Upload multipart (até 20, `MAX_UPLOAD_MB` cada) → `{ files, rejected, summary }` |
| GET | `/files/:id/download?inline=1` | `files:read` | Download autenticado e auditado; bloqueado durante a varredura ou se houver ameaça |
| DELETE | `/files/:id` | `files:delete` | Exclusão (lógica no banco, física no storage) |
| GET/POST | `/brand-assets` | `files:read` / `files:write` | Brand Vault |
| DELETE | `/brand-assets/:id` | `files:write` | Remove item |
| GET | `/calendar?from=&to=` | `work:read` | Eventos + prazos derivados (máx. 62 dias) |
| POST/DELETE | `/calendar/events[/:id]` | `work:manage` | Eventos |

## Comercial e financeiro (Fase 3)

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET/POST | `/proposals` | `proposals:read` / `proposals:write` | Lista e cria (totais calculados no servidor) |
| GET/PATCH | `/proposals/:id` | `proposals:read` / `proposals:write` | Detalhe; edição só em rascunho |
| GET | `/proposals/:id/pdf` | `proposals:read` | PDF |
| POST | `/proposals/:id/send` | `proposals:write` | Envia/reenvia (e-mail) e devolve o link público |
| POST | `/proposals/:id/accept-manual` | `proposals:write` | Aceite registrado pela agência → contrato |
| GET | `/public/proposals/:token` | pública (rate limit) | Proposta sem dados internos; marca visualizada |
| GET | `/public/proposals/:token/pdf` | pública | PDF |
| POST | `/public/proposals/:token/accept` | pública | `{ name, agree: true }` → contrato + faturas |
| POST | `/public/proposals/:token/reject` | pública | `{ reason? }` |
| GET/POST | `/contracts` | `contracts:read` / `contracts:write` | Lista e cria contrato direto |
| GET/PATCH | `/contracts/:id` | `contracts:read` / `contracts:write` | Detalhe com faturas; título, fim, dia, suspender/reativar |
| POST | `/contracts/:id/change-value` | `contracts:write` | HITL → 202 pendente (ou 200 se a política não exigir) |
| POST | `/contracts/:id/cancel` | `contracts:write` | HITL |
| GET/POST | `/invoices` | `finance:read` / `finance:write` | Faturas (`?status=open\|overdue\|paid\|cancelled`); avulsa |
| POST | `/invoices/:id/payments` | `finance:write` | Baixa (parcial ou total) |
| POST | `/invoices/:id/cancel` | `finance:write` | HITL |
| GET/POST | `/expenses?month=` | `finance:read` / `finance:write` | Despesas da agência (rateio opcional) |
| DELETE | `/expenses/:id` | `finance:write` | HITL (`{ reason }`) |
| GET | `/finance/summary?month=` | `finance:read` | MRR, ticket, recebido, a receber, inadimplência, despesas, série de 6 meses |
| GET | `/finance/profitability?month=` | `finance:read` | Rentabilidade por cliente com método e alertas |
| GET/PUT | `/settings/agency` | `finance:read` / `finance:approve` | Dados da agência e parâmetros de cobrança |
| GET | `/actions?status=` | `finance:read` | Pedidos HITL |
| POST | `/actions/:id/decide` | `finance:approve` | `{ decision: approve \| reject, note? }` — aprovar executa |
| GET | `/action-policies` | `finance:approve` | Políticas |
| PUT | `/action-policies/:action` | `platform:settings` | Só SUPER_ADMIN |
| GET | `/portal/billing` | `billing:read` | Cliente: contrato, faturas, propostas (com link) e instruções de pagamento |

## Inteligência artificial (Fase 4)

Toda execução é assíncrona: a rota grava a execução e o evento na mesma transação e responde `202`; o worker executa. Sem `ANTHROPIC_API_KEY`, as rotas que acionam agentes respondem `409 integration_pending`.

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/ai/status` | `ai:read` | `llm` e `embeddings`: `configured` ou `integration_pending`; modelo; fallback |
| GET | `/ai/agents` | `ai:read` | Definições da equipe (identidade, objetivo, qualidade, ferramentas proibidas) |
| POST | `/demands/:id/ai/plan` | `ai:run` | Aciona o Orchestrator (`instruction` opcional). 409 se já houver plano rodando, IA desligada ou orçamento atingido |
| GET | `/ai/runs` · `/ai/runs/:id` | `ai:read` | Execuções (filtros `demandId`, `status`); detalhe com filhos |
| POST | `/ai/runs/:id/retry` · `/cancel` | `ai:run` | Repete falha/bloqueio; cancela a execução e tudo que está na fila abaixo dela |
| GET/POST | `/ai/memory` | `ai:read` / `ai:run` | Lista (filtros `status`, `kind`); registra manualmente (aprovada se quem registra pode aprovar) |
| POST | `/ai/memory/:id/decide` | `ai:memory_approve` | `approve` (com correção opcional), `reject`, `archive` — auditado |
| GET/POST | `/ai/meetings` | `ai:read` / `ai:run` | Reuniões do Agent Room (`X-Tenant-Id` para criar) |
| GET | `/ai/meetings/:id` | `ai:read` | Mensagens, execuções pendentes e ata |
| POST | `/ai/meetings/:id/messages` | `ai:run` | Mensagem humana; `ask` escolhe quais agentes respondem |
| POST | `/ai/meetings/:id/close` | `ai:run` | Encerra e gera a ata |
| POST | `/ai/meetings/:id/tasks` | `tasks:write` | Cria tarefa real a partir de um item da ata (`index`) |
| GET/POST | `/ai/chat/threads` | `ai:chat` (papel global) | Conversas do próprio usuário; criar já envia a primeira pergunta |
| GET/DELETE | `/ai/chat/threads/:id` | `ai:chat` | Só o dono vê/exclui (404 para os demais) |
| POST | `/ai/chat/threads/:id/messages` | `ai:chat` | Nova pergunta (409 enquanto a anterior não foi respondida) |
| GET | `/ai/settings` · PUT `/ai/settings/:tenantId` | `ai:settings` | Orçamento, IA ligada e auto-plano por cliente; gasto do mês |
| PUT | `/ai/usd-rate` | `ai:settings` (global) | Cotação usada na rentabilidade |
| GET | `/ai/usage?month=AAAA-MM` | `ai:settings` | Consumo por cliente, agente, modelo e finalidade |

## MCP Hub (Fase 5)

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/mcp/catalog` | `mcp:read` | Conectores (campos, disponibilidade, requisitos) e ferramentas (risco, regra de aprovação, agentes, política) |
| GET | `/mcp/connections` | `mcp:read` | Conexões (sem segredos; `hasSecret`) — `X-Tenant-Id` filtra |
| PUT | `/mcp/connections/:tenantId/:connector` | `mcp:manage` | Conecta/atualiza; `secrets` omitidos mantêm os atuais; 409 `credentials_key_missing` sem `CREDENTIALS_KEY`; 409 `integration_pending` para conectores sem app oficial |
| PATCH | `/mcp/connections/:id/status` | `mcp:manage` | `active` / `disabled` |
| POST | `/mcp/connections/:id/test` | `mcp:manage` | Teste sem efeito colateral → `{ ok, message }` |
| DELETE | `/mcp/connections/:id` | `mcp:manage` | Remove e cancela chamadas pendentes |
| GET | `/mcp/tool-calls` | `mcp:read` | Filtros `status`, `deliverableId` |
| POST | `/mcp/tool-calls` | `mcp:use` (+ permissão da ferramenta) | `{ tool, params, reason }` → 202 `queued` ou `pending_approval`. Erros: 400 `invalid_params`/`invalid_request`, 403 `forbidden`, 409 `not_connected`/`tool_disabled`/`integration_pending` |
| POST | `/mcp/tool-calls/:id/decide` | `mcp:approve` | `approve` (enfileira) / `reject`; 403 se a política exigir outra pessoa |
| POST | `/mcp/tool-calls/:id/cancel` | `mcp:use` | Quem pediu ou um aprovador; só antes de executar |
| PUT | `/mcp/policies/:tool` | `mcp:manage` (global) | `{ enabled, allowSelfApproval }` — risco alto continua exigindo aprovação |

## Automação (Fase 6)

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/notifications` · `/notifications/unread-count` | sessão | Só as do próprio usuário (`unread=true` filtra) |
| POST | `/notifications/read` | sessão | `{ ids }` ou `{ all: true }` |
| GET/PUT | `/notifications/preferences` | sessão | `{ email: { categoria: boolean } }` |
| GET | `/reports` · `/reports/:id` | `reports:read` | Relatórios diários (o cliente vê só os seus) |
| POST | `/reports/generate` | `reports:manage` | `{ date?, send }` — gera/regenera na fila (202) |
| POST | `/reports/:id/send` | `reports:manage` | Reenvia aos usuários do cliente |
| GET/PUT | `/reports/settings` · `/reports/settings/:tenantId` | `reports:manage` | Envio diário ligado e "só dias úteis" por cliente |
| GET/POST | `/workflows` | `workflows:manage` | Regras por cliente; marcadores validados por gatilho |
| PUT/DELETE | `/workflows/:id` | `workflows:manage` | Alterar/pausar/excluir |
| GET | `/workflows/:id/runs` | `workflows:manage` | Histórico de disparos |

`POST /mcp/tool-calls` aceita `scheduledFor` (ISO, entre 1 min e 1 ano) nas ferramentas agendáveis (publicar no WordPress, e-mail ao cliente, webhook): a execução acontece a partir do horário, depois da aprovação.

## Dashboards e auditoria

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/dashboard/admin` | `dashboard:admin` | KPIs, receita por plano, atenção, timeline, módulos pendentes (agrega só tenants autorizados) |
| GET | `/portal/overview` | `dashboard:client` | Perfil, histórico e módulos futuros do próprio tenant |
| GET | `/audit?action=&result=&before=&limit=` | `audit:read` | Trilha de auditoria (paginação por `before`) |
