# AI Marketing OS

Plataforma SaaS multi-tenant para uma agência de marketing administrar dezenas ou centenas de clientes, cada um com seu ambiente isolado e sua própria equipe de agentes de IA.

> **Status:** Fases 1 (Core), 2 (Operação), 3 (Comercial), 4 (IA), 5 (MCP), 6 (Automação) e 7 (Adobe) concluídas — autenticação, tenants, RBAC, RLS, auditoria, Maurílio Desk, CRM, onboarding, portal do cliente, demandas, QA, aprovações, arquivos/Brand Vault, calendário, propostas com aceite online e PDF, contratos, cobrança, pagamentos, despesas, rentabilidade, aprovação humana para ações financeiras, equipe de agentes Claude (Orchestrator, especialistas, QA), memória por cliente com aprovação humana, Agent Room, Chat Global e orçamento/custo de IA por cliente ([docs/AGENTS.md](docs/AGENTS.md)), MCP Hub com integrações WordPress, webhook/n8n e e-mail, credenciais cifradas e aprovação humana obrigatória para ações de risco alto ([docs/MCP.md](docs/MCP.md)), notificações internas e por e-mail, relatório diário por cliente, lembretes, workflows e publicação agendada, e Adobe Firefly Services pela API oficial (gerar e expandir imagens no Estúdio criativo). Fase 8: ver [roadmap](docs/ARCHITECTURE.md#roadmap).

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
| Demandas (F2) | Cliente abre demanda → equipe é avisada → briefing versionado → tarefas → entregáveis → QA → aprovação do cliente → entrega |
| QA (F2) | Nenhum entregável vai ao cliente sem passar pela revisão interna; reprovação exige motivo e volta ao produtor |
| Aprovações (F2) | Cliente aprova ou pede alteração (motivo obrigatório); a demanda volta à etapa certa; e-mails para os dois lados |
| Arquivos (F2) | Upload múltiplo por arrastar-e-soltar, tipo detectado pelo conteúdo, classificação automática ("Identifiquei: 11 imagens, 1 logo…"), rascunhos internos invisíveis ao cliente, ClamAV opcional, download só autenticado |
| Brand Vault (F2) | Paleta, logos, fontes, manuais, produtos e referências por cliente |
| Propostas (F3) | Editor com serviços recorrentes/únicos e desconto; PDF; envio por e-mail com link assinado; o cliente vê, baixa e aceita online (nome + concordância + IP registrados) ou recusa |
| Contratos e cobrança (F3) | Aceite → contrato ativo → fatura de setup + faturas recorrentes geradas automaticamente (idempotente) → lembrete de vencimento; baixa manual de pagamentos (gateway: integração pendente) |
| Onboarding por pagamento (F3) | Prospect sem acesso: o primeiro pagamento confirmado cria o usuário e envia as boas-vindas |
| Financeiro (F3) | MRR, ticket médio, recebido, a receber, inadimplência, despesas (sempre da agência, com rateio opcional) e rentabilidade por cliente com alerta de margem |
| HITL (F3) | Cancelar fatura/contrato, alterar valor e excluir despesa viram pedidos que só executam após aprovação humana; políticas configuráveis |
| Calendário (F2) | Mensal, semanal e diário: eventos + prazos de demandas, aprovações e tarefas (internas só para a equipe) |

Indicadores que dependem de módulos futuros (contratos, pagamentos, tarefas, agentes, custos de IA) aparecem como **“Fase N”** — nunca com números simulados. Sem SMTP configurado, `/api/ready` informa `smtp: integration_pending` e os convites aguardam no outbox; sem `ANTHROPIC_API_KEY`, informa `ai: integration_pending` e os agentes não são acionados.

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
- `commercial.test.ts` — cálculo da proposta, link público (sem dados internos), PDF, aceite → contrato → faturas, rotina de cobrança idempotente, pagamentos, onboarding no primeiro pagamento, HITL (pedido, aprovação, rejeição, autoaprovação), despesas, rentabilidade e isolamento comercial.
- `operations.test.ts` — fluxo completo demanda→QA→aprovação→entrega, isolamento de demandas/arquivos/aprovações/tarefas/Brand Vault/calendário, upload com extensão falsa, executável, limite de tamanho, SVG em sandbox, antivírus (protocolo clamd), RLS e FKs compostas das novas tabelas.

## Documentação

[ARCHITECTURE](docs/ARCHITECTURE.md) · [SECURITY](docs/SECURITY.md) · [DATABASE](docs/DATABASE.md) · [API](docs/API.md) · [AGENTS](docs/AGENTS.md) · [MCP](docs/MCP.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [ENVIRONMENT](docs/ENVIRONMENT.md)
