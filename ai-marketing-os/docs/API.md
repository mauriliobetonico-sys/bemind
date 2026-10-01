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

## Dashboards e auditoria

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/dashboard/admin` | `dashboard:admin` | KPIs, receita por plano, atenção, timeline, módulos pendentes (agrega só tenants autorizados) |
| GET | `/portal/overview` | `dashboard:client` | Perfil, histórico e módulos futuros do próprio tenant |
| GET | `/audit?action=&result=&before=&limit=` | `audit:read` | Trilha de auditoria (paginação por `before`) |
