-- =====================================================================
-- 0003 — Comercial: propostas, contratos, cobranças, pagamentos,
-- despesas, configurações da agência e aprovação humana (HITL).
--
--   * propostas, contratos, faturas e pagamentos pertencem ao tenant do
--     cliente (o cliente vê os seus);
--   * despesas pertencem SEMPRE ao tenant da agência — o rateio para um
--     cliente é só uma coluna (client_tenant_id), então o cliente nunca
--     alcança custos da agência, nem por RLS.
-- =====================================================================

CREATE SEQUENCE proposal_number_seq;
CREATE SEQUENCE contract_number_seq;
CREATE SEQUENCE invoice_number_seq;

-- ---------------------------------------------------------------------
-- Configurações da agência (linha única) e políticas de HITL
-- ---------------------------------------------------------------------
CREATE TABLE agency_settings (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  agency_name            text NOT NULL DEFAULT 'Agência',
  agency_document        text,
  agency_address         text,
  agency_email           text,
  agency_phone           text,
  payment_instructions   text,
  proposal_footer        text,
  margin_alert_percent   numeric(5, 2) NOT NULL DEFAULT 30 CHECK (margin_alert_percent BETWEEN -100 AND 100),
  invoice_lead_days      smallint NOT NULL DEFAULT 10 CHECK (invoice_lead_days BETWEEN 0 AND 60),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO agency_settings (id) VALUES (1);
CREATE TRIGGER agency_settings_updated_at BEFORE UPDATE ON agency_settings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE action_policies (
  action               text PRIMARY KEY,
  description          text NOT NULL,
  requires_approval    boolean NOT NULL DEFAULT true,
  -- Agência com uma só pessoa: quem pediu pode aprovar, em um segundo passo explícito.
  allow_self_approval  boolean NOT NULL DEFAULT true,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO action_policies (action, description) VALUES
  ('contract.change_value', 'Alterar o valor recorrente de um contrato'),
  ('contract.cancel', 'Cancelar um contrato'),
  ('invoice.cancel', 'Cancelar uma fatura'),
  ('expense.delete', 'Excluir uma despesa');

-- ---------------------------------------------------------------------
-- Propostas
-- ---------------------------------------------------------------------
CREATE TABLE proposals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  number                text NOT NULL UNIQUE,
  title                 text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired')),
  valid_until           date NOT NULL,
  discount_type         text NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'percent', 'amount')),
  discount_value        numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  periodicity           text NOT NULL DEFAULT 'monthly' CHECK (periodicity IN ('monthly', 'quarterly', 'yearly')),
  notes                 text,
  internal_notes        text,
  recurring_total_cents bigint NOT NULL DEFAULT 0 CHECK (recurring_total_cents >= 0),
  one_time_total_cents  bigint NOT NULL DEFAULT 0 CHECK (one_time_total_cents >= 0),
  -- Link público: token = HMAC(APP_SECRET, id:nonce). Só o hash fica no banco; trocar o nonce revoga o link.
  public_token_hash     bytea UNIQUE,
  public_token_nonce    text,
  sent_at               timestamptz,
  viewed_at             timestamptz,
  accepted_at           timestamptz,
  accepted_by_name      text,
  accepted_via          text CHECK (accepted_via IN ('online', 'manual')),
  accepted_ip           inet,
  accepted_user_agent   text,
  rejected_at           timestamptz,
  rejection_reason      text,
  created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX proposals_tenant_idx ON proposals (tenant_id, status);
CREATE TRIGGER proposals_updated_at BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE proposal_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  proposal_id      uuid NOT NULL,
  position         smallint NOT NULL,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description      text,
  quantity         numeric(10, 2) NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  recurrence       text NOT NULL CHECK (recurrence IN ('recurring', 'one_time')),
  total_cents      bigint NOT NULL CHECK (total_cents >= 0),
  FOREIGN KEY (tenant_id, proposal_id) REFERENCES proposals (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX proposal_items_proposal_idx ON proposal_items (proposal_id, position);

-- ---------------------------------------------------------------------
-- Contratos
-- ---------------------------------------------------------------------
CREATE TABLE contracts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  number                  text NOT NULL UNIQUE,
  proposal_id             uuid,
  title                   text NOT NULL,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'ended', 'cancelled')),
  periodicity             text NOT NULL DEFAULT 'monthly' CHECK (periodicity IN ('monthly', 'quarterly', 'yearly')),
  recurring_amount_cents  bigint NOT NULL CHECK (recurring_amount_cents >= 0),
  setup_amount_cents      bigint NOT NULL DEFAULT 0 CHECK (setup_amount_cents >= 0),
  start_date              date NOT NULL,
  end_date                date,
  billing_day             smallint NOT NULL DEFAULT 10 CHECK (billing_day BETWEEN 1 AND 28),
  services                jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Assinatura eletrônica com validade jurídica: integração pendente (ver docs/ARCHITECTURE.md).
  signature_status        text NOT NULL DEFAULT 'accepted_online'
                          CHECK (signature_status IN ('accepted_online', 'manual', 'esign_pending', 'esign_signed')),
  cancelled_at            timestamptz,
  cancel_reason           text,
  created_by              uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (end_date IS NULL OR end_date >= start_date),
  FOREIGN KEY (tenant_id, proposal_id) REFERENCES proposals (tenant_id, id) ON DELETE SET NULL (proposal_id)
);
CREATE INDEX contracts_tenant_idx ON contracts (tenant_id, status);
CREATE UNIQUE INDEX contracts_one_per_proposal ON contracts (proposal_id) WHERE proposal_id IS NOT NULL;
CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Faturas (contas a receber) e pagamentos
-- ---------------------------------------------------------------------
CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  contract_id       uuid,
  number            text NOT NULL UNIQUE,
  kind              text NOT NULL CHECK (kind IN ('setup', 'recurring', 'one_off')),
  period_start      date,
  period_end        date,
  description       text NOT NULL,
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  due_date          date NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  paid_at           date,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  reminded_at       timestamptz,
  cancelled_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts (tenant_id, id) ON DELETE RESTRICT
);
-- Idempotência da geração automática: uma fatura por contrato/tipo/período.
CREATE UNIQUE INDEX invoices_contract_period ON invoices (contract_id, kind, period_start) WHERE contract_id IS NOT NULL AND kind <> 'one_off';
CREATE INDEX invoices_tenant_idx ON invoices (tenant_id, status, due_date);

CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  invoice_id    uuid NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  paid_at       date NOT NULL,
  method        text NOT NULL CHECK (method IN ('pix', 'boleto', 'transfer', 'card', 'cash', 'other')),
  reference     text,
  -- 'manual' hoje; gateways (PIX/boleto) entram como integração MCP.
  provider      text NOT NULL DEFAULT 'manual',
  recorded_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX payments_tenant_idx ON payments (tenant_id, paid_at);

-- ---------------------------------------------------------------------
-- Despesas (sempre no tenant da agência)
-- ---------------------------------------------------------------------
CREATE TABLE expenses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  client_tenant_id  uuid REFERENCES tenants (id) ON DELETE SET NULL,
  category          text NOT NULL CHECK (category IN ('infrastructure', 'ai', 'software', 'staff', 'freelancer',
                                                      'media', 'tax', 'marketing', 'other')),
  description       text NOT NULL CHECK (length(description) BETWEEN 2 AND 300),
  supplier          text,
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  incurred_on       date NOT NULL,
  recorded_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX expenses_period_idx ON expenses (incurred_on) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION app.check_expense_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM tenants WHERE id = NEW.tenant_id) IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'despesas pertencem ao tenant da agência' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.client_tenant_id IS NOT NULL AND (SELECT kind FROM tenants WHERE id = NEW.client_tenant_id) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'rateio deve apontar para um cliente' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expenses_tenant_check BEFORE INSERT OR UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION app.check_expense_tenant();

-- ---------------------------------------------------------------------
-- Ações críticas com aprovação humana (HITL)
-- ---------------------------------------------------------------------
CREATE TABLE pending_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  action          text NOT NULL REFERENCES action_policies (action),
  resource_id     uuid NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason          text NOT NULL CHECK (length(trim(reason)) > 0),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rejected', 'executed', 'failed')),
  requested_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pending_actions_one_open ON pending_actions (action, resource_id) WHERE status = 'pending';
CREATE INDEX pending_actions_status_idx ON pending_actions (status, created_at);

-- ---------------------------------------------------------------------
-- RLS e privilégios
-- ---------------------------------------------------------------------
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY[
  'proposals', 'proposal_items', 'contracts', 'invoices', 'payments', 'expenses', 'pending_actions'
]::regclass[]) AS t;

ALTER TABLE agency_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_settings_admin ON agency_settings
  USING (app.current_scope() IN ('system', 'global')) WITH CHECK (app.current_scope() IN ('system', 'global'));

ALTER TABLE action_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY action_policies_read ON action_policies FOR SELECT USING (app.current_scope() <> 'none');
CREATE POLICY action_policies_write ON action_policies FOR UPDATE
  USING (app.current_scope() IN ('system', 'global')) WITH CHECK (app.current_scope() IN ('system', 'global'));

GRANT SELECT, UPDATE ON agency_settings, action_policies TO aimos_app;
GRANT SELECT, INSERT, UPDATE ON proposals, contracts, invoices, expenses, pending_actions TO aimos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON proposal_items TO aimos_app;
GRANT SELECT, INSERT ON payments TO aimos_app;
GRANT USAGE ON SEQUENCE proposal_number_seq, contract_number_seq, invoice_number_seq TO aimos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO aimos_app;

-- Novo papel global: financeiro.
-- (as permissões vêm do catálogo em packages/shared, sincronizado pelo migrate)
