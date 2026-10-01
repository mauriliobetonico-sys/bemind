# AI Marketing OS

Plataforma SaaS multi-tenant para uma agência de marketing administrar dezenas ou centenas de clientes, cada um com seu ambiente isolado e — nas próximas fases — sua própria equipe de agentes de IA.

> **Status:** Fase 1 (Core) concluída — autenticação, usuários, tenants, RBAC, RLS, auditoria, painel administrativo (Maurílio Desk), CRM de clientes, provisionamento automático do tenant e portal do cliente. Fases 2–8: ver [roadmap](docs/ARCHITECTURE.md#roadmap).

## O que já funciona

| Área | Fase 1 |
| --- | --- |
| Autenticação | Sessão opaca em cookie `__Host-` httpOnly, argon2id, CSRF vinculado à sessão, bloqueio por tentativas, rate limit, expiração ociosa e absoluta |
| Primeiro acesso | Convite e recuperação por link de uso único com expiração — nenhuma senha trafega por e-mail |
| Multi-tenant | Cada cliente é um tenant; isolamento na API **e** no PostgreSQL (RLS forçado, role sem BYPASSRLS, FKs compostas) |
| RBAC | SUPER_ADMIN, ADMIN, GESTOR, OPERADOR, CLIENTE — papéis e permissões são dados no banco |
| CRM | Cadastro completo do cliente, busca, filtros, histórico de alterações |
| Onboarding | Criar cliente = tenant + cliente + usuário CLIENTE + associação + e-mail de boas-vindas + eventos, numa transação |
| Maurílio Desk | MRR, clientes ativos/onboarding, ticket médio, atenção, receita por plano, timeline operacional |
| Portal do cliente | Dashboard exclusivo do tenant |
| Auditoria | Login, logout, negações, CSRF, alterações de cliente, usuários, papéis, tenants — append-only |
| Outbox + worker | E-mails e eventos de domínio com retry, backoff exponencial e dead-letter |

Indicadores que dependem de módulos futuros (contratos, pagamentos, tarefas, agentes, custos de IA) aparecem como **“Fase N”** — nunca com números simulados. Sem SMTP configurado, `/api/ready` informa `smtp: integration_pending` e os convites aguardam no outbox.

## Estrutura

```
apps/api        API Fastify + worker do outbox + migrations SQL (RLS)
apps/web        Next.js (Maurílio Desk, CRM, equipe, auditoria, portal)
packages/shared Catálogo de permissões e schemas Zod compartilhados
infra/          Caddy (TLS/proxy) e backup
docs/           Arquitetura, segurança, banco, API, agentes, MCP, deploy, ambiente
```

## Rodando localmente

Requisitos: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install

# banco: crie um database vazio e aplique as migrations com um usuário administrador
export DATABASE_ADMIN_URL=postgres://postgres@localhost:5432/aimos_dev
export APP_DB_PASSWORD=$(openssl rand -hex 16)
pnpm migrate

# primeiro SUPER_ADMIN: imprime um link de uso único para definir a senha
SEED_ADMIN_EMAIL=voce@agencia.com SEED_ADMIN_NAME="Seu Nome" APP_URL=http://localhost:3000 \
  pnpm --filter @aimos/api seed:admin

# API (porta 4000), worker e web (porta 3000)
export DATABASE_URL=postgres://aimos_app:$APP_DB_PASSWORD@localhost:5432/aimos_dev
APP_URL=http://localhost:3000 COOKIE_SECURE=false pnpm dev:api
APP_URL=http://localhost:3000 COOKIE_SECURE=false pnpm --filter @aimos/api dev:worker
pnpm dev:web
```

Com Docker: `docker compose --profile dev up -d` (inclui Mailpit em `localhost:8025` para ver os e-mails). Produção: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Testes

```bash
TEST_DATABASE_ADMIN_URL=postgres://postgres@localhost:5432/postgres pnpm test
```

Os testes criam um banco descartável, aplicam as migrations e rodam contra o PostgreSQL real, com a aplicação conectada pelo role `aimos_app` (sujeito a RLS), como em produção. Suites:

- `tenant-isolation.test.ts` — Cliente A tentando ler, listar, buscar, editar, forçar header de tenant e manipular IDs do Cliente B; equipe restrita a um cliente; suspensão de tenant.
- `rls.test.ts` — isolamento no próprio banco: sem contexto não há linhas; contexto de A não lê nem grava em B; FK composta; auditoria append-only.
- `auth.test.ts` — cookies, hash de sessão, enumeração, bloqueio, CSRF, origem, logout, ociosidade, recuperação de senha, rate limit.
- `rbac-and-onboarding.test.ts` — papéis, escalonamento de privilégio, provisionamento transacional, e-mail de boas-vindas, retry de SMTP, histórico, MRR.

## Documentação

[ARCHITECTURE](docs/ARCHITECTURE.md) · [SECURITY](docs/SECURITY.md) · [DATABASE](docs/DATABASE.md) · [API](docs/API.md) · [AGENTS](docs/AGENTS.md) · [MCP](docs/MCP.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [ENVIRONMENT](docs/ENVIRONMENT.md)
