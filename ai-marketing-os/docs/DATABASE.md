# Banco de dados

PostgreSQL 16 (imagem `pgvector/pgvector:pg16`; a extensão `vector` é usada pela memória dos agentes). Migrations em `apps/api/migrations/NNNN_nome.sql`, aplicadas em ordem por `pnpm migrate` com a conexão **administrativa**; a aplicação usa o role `aimos_app`.

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

## Tabelas da Fase 4 (IA)

| Tabela | Tenant | Descrição |
| --- | --- | --- |
| `ai_settings` | cliente | IA ligada/desligada, orçamento mensal (µUSD) e auto-plano por cliente |
| `agent_runs` | cliente / agência (chat) | Uma execução de agente: tipo (`plan`, `produce`, `qa`, `reply`, `summarize`, `chat`), status, passo, revisão, saída, erro, tokens e custo. FKs compostas para demanda, reunião, conversa, execução-pai e entregável |
| `agent_messages` | cliente / agência | Mensagens do Agent Room (`meeting_id`) ou do Chat Global (`thread_id`) — exatamente um dos dois |
| `agent_meetings` | cliente | Reuniões: agentes convidados, status, ata (`outcome`) |
| `ai_chat_threads` | **agência** | Conversas do Chat Global, por usuário; trigger garante o tenant da agência |
| `agent_memories` | cliente | Memória por tipo (operacional, conhecimento, estratégica, regras da marca, experiência), status `proposed → approved/rejected/archived`, origem (execução, mensagem, arquivo, manual), quem decidiu, embedding `vector(1536)`. CHECK: aprovada/rejeitada exige `decided_by` |
| `ai_usage` | cliente / agência | Só INSERT: uma linha por chamada ao modelo (agente, modelo, finalidade, demanda, projeto, tokens, custo em µUSD, `stop_reason`) |

`deliverables` ganhou `agent_run_id` (rascunho produzido por agente) e `ai_review` (parecer do QA da IA). `agency_settings.usd_brl_rate` converte o custo de IA para a rentabilidade.

## Tabelas da Fase 5 (MCP)

| Tabela | Tenant | Descrição |
| --- | --- | --- |
| `mcp_connections` | cliente | Uma por conector e cliente: status, `config` (não secreta), `secret_ciphertext` (AES-256-GCM), falhas seguidas, circuito, último erro/sucesso |
| `mcp_tool_calls` | cliente | Cada pedido de ferramenta: risco, status (`pending_approval → queued → running → succeeded/failed`, `rejected`, `cancelled`), parâmetros, motivo, quem pediu (pessoa **ou** agente + execução), entregável, decisão, resultado. CHECKs: HIGH ⇒ exige aprovação; exige aprovação ⇒ só sai da espera com `decided_by` |
| `mcp_tool_policies` | global | Sobrescritas por ferramenta: ligada/desligada e se quem pediu pode aprovar (escrita só em escopo global) |

## Tabelas da Fase 6 (automação)

| Tabela | Tenant | Descrição |
| --- | --- | --- |
| `notifications` | cliente/agência + **usuário** | Notificação interna (categoria, título, texto, link interno, lida em). RLS por tenant + política RESTRITIVA `user_id = app.current_user_id()` |
| `notification_preferences` | usuário | E-mail ligado/desligado por categoria (padrão: ligado) |
| `daily_reports` | cliente | Um por cliente e dia: seções (fatos), abertura, gerador (`template`/`ai`), envio por e-mail |
| `workflow_rules` / `workflow_runs` | cliente | Regras "quando X → ferramenta Y" e cada disparo (único por regra + evento), com a chamada de ferramenta gerada |
| `job_runs` | sistema | Controle das rotinas diárias (uma execução por dia) |

`clients` ganhou `daily_report_enabled` e `daily_report_weekdays_only`; `mcp_tool_calls` ganhou `requested_by_workflow` (exatamente um solicitante: pessoa, agente ou workflow) e `scheduled_for` (publicação agendada).

## Entidades das próximas fases

Já modeladas na arquitetura (todas com `tenant_id` + RLS): `subscriptions`, `campaigns`, `analytics`, `plans`.

## Backup

Ver [DEPLOYMENT.md](DEPLOYMENT.md#backup-e-restauração).
