-- =====================================================================
-- 0002 — Operação: projetos, demandas, briefings, tarefas, entregáveis,
-- aprovações, arquivos, Brand Vault e calendário.
--
-- Regras (ver docs/DATABASE.md):
--   * toda tabela tem tenant_id NOT NULL + RLS forçado (app.enable_tenant_rls);
--   * referências entre tabelas de tenant usam FK composta (tenant_id, id),
--     de modo que o banco recusa ligar dados de clientes diferentes.
-- =====================================================================

-- Aplica o padrão de isolamento a uma tabela com coluna tenant_id.
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (app.can_access_tenant(tenant_id)) WITH CHECK (app.can_access_tenant(tenant_id))',
    tbl);
END $$;

-- ---------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------
CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  description     text,
  status          text NOT NULL DEFAULT 'planning'
                  CHECK (status IN ('planning', 'active', 'on_hold', 'done', 'cancelled')),
  start_date      date,
  due_date        date,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX projects_tenant_idx ON projects (tenant_id, status);
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Demandas (pedidos do cliente ou da agência)
-- ---------------------------------------------------------------------
CREATE TABLE demands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  project_id      uuid,
  type            text NOT NULL CHECK (type IN ('post', 'story', 'reel', 'video', 'banner', 'campaign', 'ad',
                                               'site', 'landing_page', 'graphic', 'other')),
  title           text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  description     text NOT NULL,
  priority        text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date        date,
  refs            text,
  notes           text,
  status          text NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'planning', 'in_production', 'in_review', 'awaiting_approval',
                                    'changes_requested', 'approved', 'delivered', 'cancelled')),
  requested_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) ON DELETE SET NULL (project_id)
);
CREATE INDEX demands_tenant_idx ON demands (tenant_id, status, due_date);
CREATE TRIGGER demands_updated_at BEFORE UPDATE ON demands FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Briefing versionado da demanda (o mais recente vale).
CREATE TABLE briefings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  demand_id       uuid NOT NULL,
  version         integer NOT NULL CHECK (version > 0),
  objective       text NOT NULL,
  audience        text,
  key_messages    text,
  deliverables    text,
  tone            text,
  constraints     text,
  author_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (demand_id, version),
  FOREIGN KEY (tenant_id, demand_id) REFERENCES demands (tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- Tarefas internas
-- ---------------------------------------------------------------------
CREATE TABLE tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  project_id      uuid,
  demand_id       uuid,
  title           text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  description     text,
  status          text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'review', 'done', 'blocked')),
  priority        text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assignee_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  due_date        date,
  completed_at    timestamptz,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) ON DELETE SET NULL (project_id),
  FOREIGN KEY (tenant_id, demand_id) REFERENCES demands (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX tasks_tenant_idx ON tasks (tenant_id, status, due_date);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id) WHERE status <> 'done';
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Arquivos e pastas (conteúdo fica no storage em tenants/{tenant}/{file})
-- ---------------------------------------------------------------------
CREATE TABLE folders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  parent_id       uuid,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES folders (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  folder_id       uuid,
  demand_id       uuid,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  mime            text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes >= 0),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  category        text NOT NULL CHECK (category IN ('image', 'video', 'logo', 'brand_manual', 'catalog', 'document',
                                                    'spreadsheet', 'presentation', 'archive', 'design', 'font', 'other')),
  scan_status     text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'infected', 'skipped', 'error')),
  -- 'internal': rascunhos da equipe, invisíveis ao cliente até o envio para aprovação.
  visibility      text NOT NULL DEFAULT 'client' CHECK (visibility IN ('client', 'internal')),
  uploaded_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, folder_id) REFERENCES folders (tenant_id, id) ON DELETE SET NULL (folder_id),
  FOREIGN KEY (tenant_id, demand_id) REFERENCES demands (tenant_id, id) ON DELETE SET NULL (demand_id)
);
CREATE INDEX files_tenant_idx ON files (tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- Brand Vault: itens de marca aprovados (arquivo ou valor, ex.: cor HEX).
CREATE TABLE brand_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind IN ('logo', 'font', 'color', 'manual', 'image', 'video', 'product',
                                                'service', 'price', 'campaign', 'reference', 'document')),
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  value           text,
  file_id         uuid,
  notes           text,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (value IS NOT NULL OR file_id IS NOT NULL),
  FOREIGN KEY (tenant_id, file_id) REFERENCES files (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX brand_assets_tenant_idx ON brand_assets (tenant_id, kind);

-- ---------------------------------------------------------------------
-- Entregáveis e aprovações
-- ---------------------------------------------------------------------
CREATE TABLE deliverables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  demand_id       uuid NOT NULL,
  title           text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  description     text,
  file_id         uuid,
  version         integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'internal_review', 'awaiting_client', 'changes_requested', 'approved')),
  qa_notes        text,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, demand_id) REFERENCES demands (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, file_id) REFERENCES files (tenant_id, id) ON DELETE SET NULL (file_id)
);
CREATE INDEX deliverables_demand_idx ON deliverables (tenant_id, demand_id);
CREATE TRIGGER deliverables_updated_at BEFORE UPDATE ON deliverables FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  deliverable_id  uuid NOT NULL,
  version         integer NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'changes_requested', 'cancelled')),
  message         text,
  reason          text,
  requested_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  FOREIGN KEY (tenant_id, deliverable_id) REFERENCES deliverables (tenant_id, id) ON DELETE CASCADE,
  -- Pedir alteração exige motivo.
  CHECK (status <> 'changes_requested' OR (reason IS NOT NULL AND length(trim(reason)) > 0))
);
-- No máximo uma aprovação pendente por entregável.
CREATE UNIQUE INDEX approvals_one_pending ON approvals (deliverable_id) WHERE status = 'pending';
CREATE INDEX approvals_tenant_idx ON approvals (tenant_id, status);

-- ---------------------------------------------------------------------
-- Calendário
-- ---------------------------------------------------------------------
CREATE TABLE calendar_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind IN ('content', 'campaign', 'meeting', 'task', 'delivery', 'approval')),
  title           text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  description     text,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz,
  all_day         boolean NOT NULL DEFAULT false,
  visibility      text NOT NULL DEFAULT 'client' CHECK (visibility IN ('client', 'internal')),
  demand_id       uuid,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  FOREIGN KEY (tenant_id, demand_id) REFERENCES demands (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX calendar_events_tenant_idx ON calendar_events (tenant_id, starts_at);

-- ---------------------------------------------------------------------
-- RLS e privilégios
-- ---------------------------------------------------------------------
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY[
  'projects', 'demands', 'briefings', 'tasks', 'folders', 'files', 'brand_assets',
  'deliverables', 'approvals', 'calendar_events'
]::regclass[]) AS t;

GRANT SELECT, INSERT, UPDATE ON projects, demands, tasks, files, deliverables, approvals TO aimos_app;
GRANT SELECT, INSERT ON briefings TO aimos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON folders, brand_assets, calendar_events TO aimos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO aimos_app;
