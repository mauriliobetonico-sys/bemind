-- =====================================================================
-- 0001 — Núcleo: identidade, tenants, RBAC, CRM, auditoria, outbox.
--
-- Modelo de isolamento (ver docs/SECURITY.md):
--   * A aplicação conecta com o role aimos_app: sem BYPASSRLS, não é dono
--     das tabelas, e só recebe os GRANTs listados no fim deste arquivo.
--   * Toda tabela com dados de tenant tem RLS habilitado E forçado.
--   * O contexto de acesso é definido por transação (SET LOCAL) pela API:
--       app.scope       'system' | 'global' | 'tenant'  (ausente = nada)
--       app.tenant_ids  lista de UUIDs validada pela API
--       app.user_id     usuário autenticado
--   * Sem contexto, as políticas não retornam nenhuma linha.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------
-- Funções de contexto (SECURITY INVOKER, STABLE)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_scope() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.scope', true), ''), 'none')
$$;

CREATE OR REPLACE FUNCTION app.current_tenant_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    string_to_array(nullif(current_setting('app.tenant_ids', true), ''), ',')::uuid[],
    '{}'::uuid[]
  )
$$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- 'system': operações internas (autenticação, provisionamento, worker).
-- 'global': SUPER_ADMIN / ADMIN, verificados pela API.
-- 'tenant': somente os tenants listados em app.tenant_ids.
CREATE OR REPLACE FUNCTION app.can_access_tenant(t uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE app.current_scope()
    WHEN 'system' THEN true
    WHEN 'global' THEN true
    WHEN 'tenant' THEN t = ANY (app.current_tenant_ids())
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- RBAC (dados globais, somente leitura para a aplicação)
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  key         text PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  name        text NOT NULL,
  scope       text NOT NULL CHECK (scope IN ('global', 'tenant')),
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z_]+:[a-z_]+$'),
  description  text NOT NULL
);

CREATE TABLE role_permissions (
  role_key        text NOT NULL REFERENCES roles (key) ON DELETE CASCADE,
  permission_key  text NOT NULL REFERENCES permissions (key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

-- ---------------------------------------------------------------------
-- Tenants e usuários
-- ---------------------------------------------------------------------
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('agency', 'client')),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status      text NOT NULL DEFAULT 'onboarding'
              CHECK (status IN ('onboarding', 'active', 'suspended', 'archived')),
  plan        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  name             text NOT NULL,
  password_hash    text,
  global_role      text REFERENCES roles (key),
  status           text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  failed_logins    integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE tenant_users (
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_key    text NOT NULL REFERENCES roles (key),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX tenant_users_user_idx ON tenant_users (user_id);

-- Garante que só papéis de escopo 'tenant' sejam usados em associações
-- e só papéis 'global' em users.global_role.
CREATE OR REPLACE FUNCTION app.check_role_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected text := TG_ARGV[0];
  role_value text;
  actual text;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    role_value := NEW.global_role;
  ELSE
    role_value := NEW.role_key;
  END IF;
  IF role_value IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT scope INTO actual FROM roles WHERE key = role_value;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'role % não tem escopo %', role_value, expected USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_role_scope BEFORE INSERT OR UPDATE OF global_role ON users
  FOR EACH ROW EXECUTE FUNCTION app.check_role_scope('global');
CREATE TRIGGER tenant_users_role_scope BEFORE INSERT OR UPDATE OF role_key ON tenant_users
  FOR EACH ROW EXECUTE FUNCTION app.check_role_scope('tenant');

-- ---------------------------------------------------------------------
-- Sessões e tokens (somente escopo 'system')
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       bytea NOT NULL UNIQUE,
  csrf_hash        bytea NOT NULL,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ip               inet,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE password_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  purpose     text NOT NULL CHECK (purpose IN ('invite', 'reset')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_tokens_user_idx ON password_tokens (user_id);

-- ---------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------
CREATE TABLE clients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL UNIQUE REFERENCES tenants (id) ON DELETE RESTRICT,
  legal_name          text NOT NULL,
  trade_name          text NOT NULL,
  cnpj                text CHECK (cnpj ~ '^\d{14}$'),
  responsible_name    text NOT NULL,
  phone               text,
  email               text NOT NULL,
  address             jsonb NOT NULL DEFAULT '{}'::jsonb,
  segment             text,
  niche               text,
  plan                text NOT NULL CHECK (plan IN ('START', 'PRO', 'BUSINESS', 'ENTERPRISE')),
  status              text NOT NULL CHECK (status IN ('prospect', 'onboarding', 'active', 'paused', 'churned')),
  monthly_fee_cents   bigint NOT NULL DEFAULT 0 CHECK (monthly_fee_cents >= 0),
  currency            text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  start_date          date,
  due_day             smallint CHECK (due_day BETWEEN 1 AND 28),
  notes               text,
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX clients_cnpj_key ON clients (cnpj) WHERE cnpj IS NOT NULL;
CREATE INDEX clients_status_idx ON clients (status);
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Histórico do cliente. FK composta impede apontar para cliente de outro tenant.
CREATE TABLE client_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  client_id       uuid NOT NULL,
  actor_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  type            text NOT NULL,
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX client_events_tenant_idx ON client_events (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Auditoria (append-only para a aplicação) e outbox de eventos
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid REFERENCES tenants (id) ON DELETE SET NULL,
  actor_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  action          text NOT NULL,
  resource_type   text,
  resource_id     text,
  result          text NOT NULL CHECK (result IN ('success', 'denied', 'failure')),
  ip              inet,
  user_agent      text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants (id) ON DELETE CASCADE,
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dead')),
  attempts        integer NOT NULL DEFAULT 0,
  available_at    timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
  USING (app.can_access_tenant(id))
  WITH CHECK (app.current_scope() IN ('system', 'global'));

ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users FORCE ROW LEVEL SECURITY;
-- Leitura: tenants acessíveis ou as próprias associações (necessário para
-- montar o contexto do usuário). Escrita: somente system/global.
CREATE POLICY tenant_users_read ON tenant_users FOR SELECT
  USING (app.can_access_tenant(tenant_id) OR user_id = app.current_user_id());
CREATE POLICY tenant_users_write ON tenant_users FOR ALL
  USING (app.current_scope() IN ('system', 'global'))
  WITH CHECK (app.current_scope() IN ('system', 'global'));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_read ON users FOR SELECT
  USING (
    app.current_scope() IN ('system', 'global')
    OR id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM tenant_users tu
      WHERE tu.user_id = users.id AND app.can_access_tenant(tu.tenant_id)
        AND app.current_scope() = 'tenant'
    )
  );
CREATE POLICY users_write ON users FOR ALL
  USING (app.current_scope() IN ('system', 'global'))
  WITH CHECK (app.current_scope() IN ('system', 'global'));

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_system ON sessions
  USING (app.current_scope() = 'system') WITH CHECK (app.current_scope() = 'system');

ALTER TABLE password_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY password_tokens_system ON password_tokens
  USING (app.current_scope() IN ('system', 'global'))
  WITH CHECK (app.current_scope() IN ('system', 'global'));

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
CREATE POLICY clients_isolation ON clients
  USING (app.can_access_tenant(tenant_id))
  WITH CHECK (app.can_access_tenant(tenant_id));

ALTER TABLE client_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_events FORCE ROW LEVEL SECURITY;
CREATE POLICY client_events_isolation ON client_events
  USING (app.can_access_tenant(tenant_id))
  WITH CHECK (app.can_access_tenant(tenant_id));

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
-- Qualquer contexto autenticado pode registrar eventos do próprio escopo;
-- leitura de auditoria sem tenant (eventos de plataforma) só em global/system.
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (
    app.current_scope() IN ('system', 'global')
    OR (tenant_id IS NOT NULL AND app.can_access_tenant(tenant_id))
  );
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT
  USING (
    app.current_scope() IN ('system', 'global')
    OR (tenant_id IS NOT NULL AND app.can_access_tenant(tenant_id))
  );

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_insert ON outbox_events FOR INSERT
  WITH CHECK (
    app.current_scope() IN ('system', 'global')
    OR (tenant_id IS NOT NULL AND app.can_access_tenant(tenant_id))
  );
CREATE POLICY outbox_process ON outbox_events FOR ALL
  USING (app.current_scope() = 'system') WITH CHECK (app.current_scope() = 'system');

-- ---------------------------------------------------------------------
-- Privilégios do role da aplicação
-- (o role é criado pelo script de migração; ver src/db/migrate.ts)
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, app TO aimos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO aimos_app;
GRANT SELECT ON roles, permissions, role_permissions TO aimos_app;
GRANT SELECT, INSERT, UPDATE ON tenants, users, clients TO aimos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_users, sessions, password_tokens TO aimos_app;
GRANT SELECT, INSERT ON client_events TO aimos_app;
GRANT SELECT, INSERT ON audit_logs TO aimos_app;
GRANT SELECT, INSERT, UPDATE ON outbox_events TO aimos_app;
