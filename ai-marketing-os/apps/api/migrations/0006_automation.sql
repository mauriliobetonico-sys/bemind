-- =====================================================================
-- 0006 — Automação: notificações, relatório diário, workflows,
-- publicação agendada e controle das rotinas diárias.
--
--   * notificações são do USUÁRIO: além do RLS por tenant, uma política
--     RESTRITIVA exige user_id = usuário da sessão (nem um admin global
--     lê as notificações de outra pessoa);
--   * o relatório diário pertence ao tenant do cliente: cada cliente vê e
--     recebe só o próprio (RLS + destinatários definidos pelo servidor);
--   * workflows só PEDEM ações ao MCP Hub — a política e a aprovação
--     humana continuam valendo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Notificações internas e preferências de e-mail
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN ('demand', 'approval', 'deadline', 'meeting', 'finance', 'report', 'ai', 'tools')),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body        text,
  link        text CHECK (link IS NULL OR link ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN ('demand', 'approval', 'deadline', 'meeting', 'finance', 'report', 'ai', 'tools')),
  email       boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

-- ---------------------------------------------------------------------
-- Relatório diário
-- ---------------------------------------------------------------------
ALTER TABLE clients
  ADD COLUMN daily_report_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN daily_report_weekdays_only boolean NOT NULL DEFAULT true;

CREATE TABLE daily_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  report_date   date NOT NULL,
  -- {doneToday[], inProgress[], completed[], needsApproval[], nextSteps[], notes[]}
  sections      jsonb NOT NULL,
  intro         text NOT NULL,
  generator     text NOT NULL CHECK (generator IN ('template', 'ai')),
  has_activity  boolean NOT NULL,
  emailed_to    integer NOT NULL DEFAULT 0,
  emailed_at    timestamptz,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, report_date)
);
CREATE INDEX daily_reports_tenant_idx ON daily_reports (tenant_id, report_date DESC);

-- ---------------------------------------------------------------------
-- Workflows: "quando X acontecer, pedir a ferramenta Y"
-- ---------------------------------------------------------------------
CREATE TABLE workflow_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  trigger     text NOT NULL CHECK (trigger IN ('demand.created', 'demand.delivered', 'approval.approved', 'approval.changes_requested')),
  -- Filtros opcionais: {"demandTypes": ["post", "reel"]}
  conditions  jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool        text NOT NULL CHECK (tool ~ '^[a-z_]+\.[a-z_]+$'),
  -- Parâmetros com marcadores {{demandId}}, {{deliverableId}}… resolvidos no disparo.
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled     boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX workflow_rules_trigger_idx ON workflow_rules (tenant_id, trigger) WHERE enabled;
CREATE TRIGGER workflow_rules_updated_at BEFORE UPDATE ON workflow_rules FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE workflow_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  rule_id       uuid NOT NULL,
  trigger       text NOT NULL,
  -- Mesmo evento nunca dispara a mesma regra duas vezes (retry do worker).
  event_key     text NOT NULL,
  status        text NOT NULL CHECK (status IN ('requested', 'rejected')),
  tool_call_id  uuid,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, event_key),
  FOREIGN KEY (tenant_id, rule_id) REFERENCES workflow_rules (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, tool_call_id) REFERENCES mcp_tool_calls (tenant_id, id) ON DELETE SET NULL (tool_call_id)
);
CREATE INDEX workflow_runs_tenant_idx ON workflow_runs (tenant_id, created_at DESC);

-- Chamadas de ferramenta: quem pede pode ser pessoa, agente OU workflow; e podem ser agendadas.
ALTER TABLE mcp_tool_calls ADD COLUMN requested_by_workflow uuid;
ALTER TABLE mcp_tool_calls ADD COLUMN scheduled_for timestamptz;
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'mcp_tool_calls'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%requested_by_agent IS NULL%';
  EXECUTE format('ALTER TABLE mcp_tool_calls DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE mcp_tool_calls ADD CONSTRAINT mcp_tool_calls_one_requester CHECK (
  (requested_by_user IS NOT NULL)::int + (requested_by_agent IS NOT NULL)::int + (requested_by_workflow IS NOT NULL)::int = 1
);

-- ---------------------------------------------------------------------
-- Rotinas diárias: cada uma roda uma vez por dia (data local)
-- ---------------------------------------------------------------------
CREATE TABLE job_runs (
  job       text NOT NULL,
  run_key   text NOT NULL,
  detail    jsonb,
  ran_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job, run_key)
);

-- ---------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY['notifications', 'daily_reports', 'workflow_rules', 'workflow_runs']::regclass[]) AS t;

-- Notificação só para o próprio dono (RESTRICTIVE: soma-se ao isolamento por tenant).
CREATE POLICY notifications_owner ON notifications AS RESTRICTIVE
  USING (app.current_scope() = 'system' OR user_id = app.current_user_id())
  WITH CHECK (app.current_scope() = 'system' OR user_id = app.current_user_id());

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_owner ON notification_preferences
  USING (app.current_scope() = 'system' OR user_id = app.current_user_id())
  WITH CHECK (app.current_scope() = 'system' OR user_id = app.current_user_id());

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY job_runs_system ON job_runs USING (app.current_scope() = 'system') WITH CHECK (app.current_scope() = 'system');

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications, notification_preferences TO aimos_app;
GRANT SELECT, INSERT, UPDATE ON daily_reports, workflow_rules, workflow_runs TO aimos_app;
GRANT DELETE ON workflow_rules TO aimos_app;
GRANT SELECT, INSERT ON job_runs TO aimos_app;
