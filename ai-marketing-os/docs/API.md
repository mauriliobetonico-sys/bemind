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

## Dashboards e auditoria

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/dashboard/admin` | `dashboard:admin` | KPIs, receita por plano, atenção, timeline, módulos pendentes (agrega só tenants autorizados) |
| GET | `/portal/overview` | `dashboard:client` | Perfil, histórico e módulos futuros do próprio tenant |
| GET | `/audit?action=&result=&before=&limit=` | `audit:read` | Trilha de auditoria (paginação por `before`) |
