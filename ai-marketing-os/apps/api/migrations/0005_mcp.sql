-- =====================================================================
-- 0005 — MCP Hub: conexões por cliente, chamadas de ferramenta e
-- políticas.
--
--   * Agentes e pessoas nunca falam direto com serviços externos: toda
--     chamada vira uma linha em mcp_tool_calls e passa pela política;
--   * credenciais ficam cifradas (AES-256-GCM, chave fora do banco, AAD
--     amarrada a tenant + conexão) — o banco nunca vê o segredo em claro;
--   * risco HIGH sempre exige decisão humana (CHECK no banco).
-- =====================================================================

CREATE TABLE mcp_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  connector             text NOT NULL CHECK (connector ~ '^[a-z_]{2,40}$'),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  label                 text,
  -- Configuração NÃO secreta (URL, usuário). Segredos só em secret_ciphertext.
  config                jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext     text,
  consecutive_failures  integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  circuit_open_until    timestamptz,
  last_error            text,
  last_used_at          timestamptz,
  last_success_at       timestamptz,
  created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, connector)
);
CREATE TRIGGER mcp_connections_updated_at BEFORE UPDATE ON mcp_connections FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Sobrescritas por ferramenta (as ferramentas em si são declaradas no código).
CREATE TABLE mcp_tool_policies (
  tool                 text PRIMARY KEY CHECK (tool ~ '^[a-z_]+\.[a-z_]+$'),
  enabled              boolean NOT NULL DEFAULT true,
  -- Agência com uma só pessoa: quem pediu pode aprovar, num segundo passo explícito.
  allow_self_approval  boolean NOT NULL DEFAULT true,
  updated_by           uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mcp_tool_calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  connection_id       uuid,
  tool                text NOT NULL CHECK (tool ~ '^[a-z_]+\.[a-z_]+$'),
  connector           text NOT NULL,
  risk                text NOT NULL CHECK (risk IN ('LOW', 'MEDIUM', 'HIGH')),
  status              text NOT NULL
                      CHECK (status IN ('pending_approval', 'queued', 'running', 'succeeded', 'failed', 'rejected', 'cancelled')),
  requires_approval   boolean NOT NULL,
  params              jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason              text,
  requested_by_user   uuid REFERENCES users (id) ON DELETE SET NULL,
  requested_by_agent  text,
  run_id              uuid,
  deliverable_id      uuid,
  decided_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at          timestamptz,
  decision_note       text,
  result              jsonb,
  error               text,
  attempts            smallint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- Quem pediu: uma pessoa OU um agente.
  CHECK ((requested_by_user IS NULL) <> (requested_by_agent IS NULL)),
  -- Risco alto nunca dispensa aprovação.
  CHECK (risk <> 'HIGH' OR requires_approval),
  -- Nada que exigia aprovação sai da fila sem um humano ter decidido.
  CHECK (NOT requires_approval OR status IN ('pending_approval', 'cancelled') OR decided_by IS NOT NULL),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES mcp_connections (tenant_id, id) ON DELETE SET NULL (connection_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES agent_runs (tenant_id, id) ON DELETE SET NULL (run_id),
  FOREIGN KEY (tenant_id, deliverable_id) REFERENCES deliverables (tenant_id, id) ON DELETE SET NULL (deliverable_id)
);
CREATE INDEX mcp_tool_calls_tenant_idx ON mcp_tool_calls (tenant_id, created_at DESC);
CREATE INDEX mcp_tool_calls_status_idx ON mcp_tool_calls (status) WHERE status IN ('pending_approval', 'queued', 'running');
CREATE INDEX mcp_tool_calls_rate_idx ON mcp_tool_calls (tenant_id, tool, started_at);
CREATE TRIGGER mcp_tool_calls_updated_at BEFORE UPDATE ON mcp_tool_calls FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY['mcp_connections', 'mcp_tool_calls']::regclass[]) AS t;

ALTER TABLE mcp_tool_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tool_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY mcp_tool_policies_read ON mcp_tool_policies FOR SELECT USING (app.current_scope() <> 'none');
CREATE POLICY mcp_tool_policies_write ON mcp_tool_policies FOR ALL
  USING (app.current_scope() IN ('system', 'global')) WITH CHECK (app.current_scope() IN ('system', 'global'));

GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_connections TO aimos_app;
GRANT SELECT, INSERT, UPDATE ON mcp_tool_calls, mcp_tool_policies TO aimos_app;
