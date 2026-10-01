-- =====================================================================
-- 0004 — IA: execuções de agentes, consumo (AI Gateway), orçamento,
-- memória por cliente, Agent Room e Chat Global.
--
--   * tudo que é dado de cliente tem tenant_id + RLS forçado;
--   * o Chat Global é da agência: fica no tenant da agência, por usuário;
--   * ai_usage é só INSERT (trilha de custo, como audit_logs);
--   * agentes nunca aprovam nada: memória nasce 'proposed' e só um humano
--     (decided_by) a torna 'approved'.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Cotação usada para converter o custo de IA (USD) em reais na rentabilidade.
ALTER TABLE agency_settings
  ADD COLUMN usd_brl_rate numeric(8, 4) NOT NULL DEFAULT 5.50 CHECK (usd_brl_rate > 0);

-- ---------------------------------------------------------------------
-- Configuração de IA por cliente (orçamento mensal e automação)
-- ---------------------------------------------------------------------
CREATE TABLE ai_settings (
  tenant_id                 uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  enabled                   boolean NOT NULL DEFAULT true,
  -- Limite mensal em micro-dólares (1 USD = 1.000.000). NULL = sem limite.
  monthly_budget_usd_micros bigint CHECK (monthly_budget_usd_micros IS NULL OR monthly_budget_usd_micros >= 0),
  -- Ao abrir uma demanda, o Orchestrator monta o plano automaticamente.
  auto_plan_demands         boolean NOT NULL DEFAULT false,
  updated_by                uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ai_settings_updated_at BEFORE UPDATE ON ai_settings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Agent Room
-- ---------------------------------------------------------------------
CREATE TABLE agent_meetings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  title         text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  agenda        text,
  agent_keys    text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'summarizing', 'closed')),
  -- {summary, decisions[], tasks[], strategyChanges[]} produzido ao encerrar.
  outcome       jsonb,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX agent_meetings_tenant_idx ON agent_meetings (tenant_id, created_at DESC);
CREATE TRIGGER agent_meetings_updated_at BEFORE UPDATE ON agent_meetings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Chat Global (agência) — threads por usuário, no tenant da agência
-- ---------------------------------------------------------------------
CREATE TABLE ai_chat_threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'Nova conversa',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX ai_chat_threads_user_idx ON ai_chat_threads (user_id, updated_at DESC);
CREATE TRIGGER ai_chat_threads_updated_at BEFORE UPDATE ON ai_chat_threads FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Garante que threads do chat só existam no tenant da agência.
CREATE OR REPLACE FUNCTION app.assert_agency_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = NEW.tenant_id AND kind = 'agency') THEN
    RAISE EXCEPTION 'registro permitido apenas no tenant da agência';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_chat_threads_agency BEFORE INSERT OR UPDATE OF tenant_id ON ai_chat_threads
  FOR EACH ROW EXECUTE FUNCTION app.assert_agency_tenant();

-- ---------------------------------------------------------------------
-- Execuções de agentes
-- ---------------------------------------------------------------------
CREATE TABLE agent_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  agent_key       text NOT NULL CHECK (agent_key ~ '^[a-z_]{2,40}$'),
  -- plan: orchestrator montando o plano; produce: especialista produzindo;
  -- qa: revisão; reply: resposta no Agent Room; summarize: ata da reunião; chat: Chat Global.
  kind            text NOT NULL CHECK (kind IN ('plan', 'produce', 'qa', 'reply', 'summarize', 'chat')),
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled')),
  demand_id       uuid,
  meeting_id      uuid,
  thread_id       uuid,
  parent_run_id   uuid,
  deliverable_id  uuid,
  step_index      smallint,
  revision        smallint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 5),
  instruction     text,
  output          jsonb,
  error           text,
  model           text,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cost_usd_micros bigint NOT NULL DEFAULT 0,
  attempts        smallint NOT NULL DEFAULT 0,
  requested_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, demand_id) REFERENCES demands (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES agent_meetings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, thread_id) REFERENCES ai_chat_threads (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, parent_run_id) REFERENCES agent_runs (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, deliverable_id) REFERENCES deliverables (tenant_id, id) ON DELETE SET NULL (deliverable_id)
);
CREATE INDEX agent_runs_tenant_idx ON agent_runs (tenant_id, created_at DESC);
CREATE INDEX agent_runs_demand_idx ON agent_runs (tenant_id, demand_id);
CREATE INDEX agent_runs_parent_idx ON agent_runs (tenant_id, parent_run_id, step_index);
CREATE INDEX agent_runs_status_idx ON agent_runs (status) WHERE status IN ('queued', 'running');
CREATE TRIGGER agent_runs_updated_at BEFORE UPDATE ON agent_runs FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Entregável produzido por um agente: rastreia a execução de origem.
ALTER TABLE deliverables ADD COLUMN agent_run_id uuid;
ALTER TABLE deliverables
  ADD CONSTRAINT deliverables_agent_run_fk FOREIGN KEY (tenant_id, agent_run_id)
  REFERENCES agent_runs (tenant_id, id) ON DELETE SET NULL (agent_run_id);
ALTER TABLE deliverables ADD COLUMN ai_review jsonb;

-- ---------------------------------------------------------------------
-- Mensagens (Agent Room e Chat Global)
-- ---------------------------------------------------------------------
CREATE TABLE agent_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  meeting_id    uuid,
  thread_id     uuid,
  author_type   text NOT NULL CHECK (author_type IN ('human', 'agent', 'system')),
  author_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  agent_key     text,
  run_id        uuid,
  content       text NOT NULL CHECK (length(content) BETWEEN 1 AND 40000),
  data          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((meeting_id IS NULL) <> (thread_id IS NULL)),
  CHECK (author_type <> 'agent' OR agent_key IS NOT NULL),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES agent_meetings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, thread_id) REFERENCES ai_chat_threads (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, run_id) REFERENCES agent_runs (tenant_id, id) ON DELETE SET NULL (run_id)
);
CREATE INDEX agent_messages_meeting_idx ON agent_messages (tenant_id, meeting_id, created_at);
CREATE INDEX agent_messages_thread_idx ON agent_messages (tenant_id, thread_id, created_at);

-- ---------------------------------------------------------------------
-- Memória por cliente
-- ---------------------------------------------------------------------
CREATE TABLE agent_memories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind IN ('operational', 'knowledge', 'strategic', 'brand_rules', 'experience')),
  content         text NOT NULL CHECK (length(content) BETWEEN 3 AND 4000),
  status          text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'archived')),
  -- Origem do aprendizado: execução de agente, mensagem, arquivo ou cadastro manual.
  source_type     text NOT NULL CHECK (source_type IN ('run', 'message', 'file', 'manual')),
  source_run_id   uuid,
  source_message_id uuid,
  source_file_id  uuid,
  proposed_by_agent text,
  proposed_by_user uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  embedding       vector(1536),
  embedding_model text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- Aprovação/rejeição sempre tem um humano responsável.
  CHECK (status NOT IN ('approved', 'rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, source_run_id) REFERENCES agent_runs (tenant_id, id) ON DELETE SET NULL (source_run_id),
  FOREIGN KEY (tenant_id, source_file_id) REFERENCES files (tenant_id, id) ON DELETE SET NULL (source_file_id)
);
CREATE INDEX agent_memories_tenant_idx ON agent_memories (tenant_id, status, kind);
CREATE TRIGGER agent_memories_updated_at BEFORE UPDATE ON agent_memories FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Consumo de IA (AI Gateway) — uma linha por chamada ao provedor
-- ---------------------------------------------------------------------
CREATE TABLE ai_usage (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  run_id              uuid,
  agent_key           text NOT NULL,
  provider            text NOT NULL,
  model               text NOT NULL,
  purpose             text NOT NULL,
  demand_id           uuid,
  project_id          uuid,
  input_tokens        integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens       integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens   integer NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens  integer NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_usd_micros     bigint NOT NULL DEFAULT 0 CHECK (cost_usd_micros >= 0),
  stop_reason         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, run_id) REFERENCES agent_runs (tenant_id, id) ON DELETE SET NULL (run_id)
);
CREATE INDEX ai_usage_tenant_month_idx ON ai_usage (tenant_id, created_at);

-- ---------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY[
  'ai_settings', 'agent_meetings', 'ai_chat_threads', 'agent_runs', 'agent_messages', 'agent_memories', 'ai_usage'
]::regclass[]) AS t;

GRANT SELECT, INSERT, UPDATE ON ai_settings, agent_meetings, ai_chat_threads, agent_runs, agent_memories TO aimos_app;
GRANT SELECT, INSERT ON agent_messages, ai_usage TO aimos_app;
GRANT DELETE ON ai_chat_threads TO aimos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO aimos_app;
