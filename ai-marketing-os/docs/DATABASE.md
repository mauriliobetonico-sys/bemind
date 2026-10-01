# Banco de dados

PostgreSQL 16 (imagem `pgvector/pgvector:pg16`, pronta para embeddings na fase 4). Migrations em `apps/api/migrations/NNNN_nome.sql`, aplicadas em ordem por `pnpm migrate` com a conexão **administrativa**; a aplicação usa o role `aimos_app`.

## Convenções

- PK `uuid` (`gen_random_uuid()`), exceto `audit_logs` (identity, ordenação barata).
- `created_at` / `updated_at` (trigger `app.touch_updated_at`).
- Valores monetários em centavos (`bigint`) + `currency`.
- Toda tabela de negócio tem `tenant_id NOT NULL`, RLS habilitado e forçado e índice começando por `tenant_id`.
- Tabelas filhas referenciam o pai por FK composta `(tenant_id, parent_id) → parent(tenant_id, id)`.
- Novas tabelas de tenant **devem** repetir o bloco de RLS e os GRANTs mínimos.

## Tabelas da Fase 1

| Tabela | Tenant | Descrição |
| --- | --- | --- |
| `roles` | global | Papéis (`scope` global/tenant). Sincronizado do catálogo em `packages/shared` |
| `permissions` | global | Catálogo de permissões |
| `role_permissions` | global | Papel → permissões. Somente leitura para a aplicação |
| `tenants` | `id` | Unidade de isolamento: `kind` agency/client, `status` onboarding/active/suspended/archived |
| `users` | global | Identidade. `global_role` só aceita papéis globais (trigger) |
| `tenant_users` | `tenant_id` | Associação usuário ↔ tenant com papel de escopo tenant (trigger) |
| `sessions` | system | Hash do token e do CSRF, expiração, revogação |
| `password_tokens` | system | Convites e redefinições (hash, uso único, expiração) |
| `clients` | `tenant_id` (único) | Perfil de CRM do tenant: razão social, fantasia, CNPJ (14 dígitos, único), responsável, contato, endereço (jsonb), segmento, nicho, plano, status, mensalidade, entrada, vencimento, observações |
| `client_events` | `tenant_id` | Histórico do cliente (FK composta) |
| `audit_logs` | `tenant_id?` | Trilha de auditoria append-only |
| `outbox_events` | `tenant_id?` | Eventos de domínio pendentes/concluídos/dead |

## Políticas de RLS

Funções (`schema app`, `SECURITY INVOKER`): `current_scope()`, `current_tenant_ids()`, `current_user_id()`, `can_access_tenant(uuid)`.

| Tabela | Leitura | Escrita |
| --- | --- | --- |
| `tenants` | tenant acessível | system/global |
| `tenant_users` | tenant acessível ou a própria associação | system/global |
| `users` | system/global, o próprio, ou membros de tenants acessíveis | system/global |
| `sessions`, `password_tokens` | system (tokens: também global) | idem |
| `clients`, `client_events` | tenant acessível | tenant acessível |
| `audit_logs` | system/global ou tenant acessível | INSERT no próprio escopo; sem UPDATE/DELETE |
| `outbox_events` | system | INSERT no próprio escopo; processamento só system |

## Tabelas da Fase 2

Todas com `tenant_id` + RLS (`app.enable_tenant_rls`) e FKs compostas entre si.

| Tabela | Descrição |
| --- | --- |
| `projects` | Projetos do cliente (status, início, entrega) |
| `demands` | Pedidos: tipo, título, descrição, prioridade, prazo, referências, status do fluxo |
| `briefings` | Briefing versionado da demanda (objetivo, público, mensagens, entregáveis, tom, restrições) |
| `tasks` | Tarefas internas da equipe (status, prioridade, responsável, prazo, conclusão) |
| `folders`, `files` | Metadados dos arquivos: nome saneado, MIME detectado, tamanho, SHA-256, categoria, `scan_status`, `visibility` (client/internal), exclusão lógica |
| `brand_assets` | Brand Vault: cor (#RRGGBB), logo, fonte, manual, produto, serviço, preço, referência… (valor e/ou arquivo) |
| `deliverables` | Entregáveis da demanda com versão, status (draft → internal_review → awaiting_client → changes_requested/approved) e notas de QA |
| `approvals` | Pedido de aprovação por versão; no máximo um pendente por entregável; pedir alteração exige motivo (CHECK) |
| `calendar_events` | Eventos (conteúdo, campanha, reunião, tarefa, entrega, aprovação) com visibilidade client/internal |

## Tabelas da Fase 3

| Tabela | Tenant | Descrição |
| --- | --- | --- |
| `proposals` / `proposal_items` | cliente | Proposta numerada, validade, recorrência, desconto, totais calculados no servidor, link público (hash + nonce), aceite (nome, via, IP, user-agent) |
| `contracts` | cliente | Contrato numerado, periodicidade, valor, setup, vigência, dia de cobrança, serviços, status de assinatura |
| `invoices` | cliente | Faturas numeradas (setup, recorrente, avulsa); índice único por contrato/tipo/período garante geração idempotente |
| `payments` | cliente | Baixas (parciais permitidas), forma, referência, `provider = manual` |
| `expenses` | **agência** | Despesas por categoria; `client_tenant_id` só para rateio (trigger garante agência/cliente) |
| `pending_actions` | cliente/agência | Pedidos HITL: ação, payload, motivo, status, quem pediu/decidiu |
| `agency_settings` | global | Dados da agência, instruções de pagamento, limite de margem, antecedência de faturamento (somente global/system) |
| `action_policies` | global | Política por ação crítica |

## Entidades das próximas fases

Já modeladas na arquitetura (todas com `tenant_id` + RLS): `subscriptions`, `campaigns`, `agents`, `agent_runs`, `agent_memory`, `agent_knowledge`, `agent_policies`, `agent_meetings`, `agent_messages`, `ai_usage`, `integrations`, `mcp_connections`, `mcp_tool_calls`, `notifications`, `daily_reports`, `analytics`, `plans`.

## Backup

Ver [DEPLOYMENT.md](DEPLOYMENT.md#backup-e-restauração).
