import type { FastifyInstance } from 'fastify';
import {
  agencySettingsInput,
  cancelInput,
  createExpenseInput,
  createInvoiceInput,
  listInvoicesQuery,
  periodQuery,
  registerPaymentInput,
  uuidParam,
} from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, SYSTEM } from '../../db/pool';
import { badRequest, notFound, parse } from '../../lib/errors';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { enqueue } from '../../outbox/outbox';
import { singleTenantContext } from '../work/common';
import { applyPayment, nextNumber } from '../commercial/billing';
import { CONTRACT_SELECT } from '../commercial/contracts';
import { proposalToken } from '../commercial/proposals';
import { requestCriticalAction } from '../hitl/actions';
import { getAgencySettings } from './settings';
import { monthRange, profitabilityReport } from './profitability';

const INVOICE_SELECT = `
  SELECT i.id, i.tenant_id AS "tenantId", c.trade_name AS "clientName", i.contract_id AS "contractId", k.number AS "contractNumber",
         i.number, i.kind, i.description, i.amount_cents::float8 AS "amountCents", to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
         CASE WHEN i.status = 'open' AND i.due_date < current_date THEN 'overdue' ELSE i.status END AS status,
         to_char(i.paid_at, 'YYYY-MM-DD') AS "paidAt", i.cancelled_reason AS "cancelledReason", i.issued_at AS "issuedAt",
         (SELECT coalesce(sum(p.amount_cents), 0)::float8 FROM payments p WHERE p.invoice_id = i.id) AS "paidCents"
    FROM invoices i
    JOIN clients c ON c.tenant_id = i.tenant_id
    LEFT JOIN contracts k ON k.tenant_id = i.tenant_id AND k.id = i.contract_id`;

export async function financeRoutes(app: FastifyInstance, ctx: AppContext) {
  // ------------------------------------------------------------------ faturas
  app.get('/invoices', { config: { permission: 'finance:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(listInvoicesQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status === 'overdue') where.push(`i.status = 'open' AND i.due_date < current_date`);
    else if (q.status === 'open') where.push(`i.status = 'open' AND i.due_date >= current_date`);
    else if (q.status) where.push(`i.status = $${params.push(q.status)}`);
    if (q.contractId) where.push(`i.contract_id = $${params.push(q.contractId)}`);
    params.push(q.limit);
    return withContext(ctx.pool, access.context('finance:read', requestedTenant(req)), async (tx) => ({
      items: (await tx.query(`${INVOICE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.due_date DESC LIMIT $${params.length}`, params)).rows,
    }));
  });

  /** Fatura avulsa (serviço extra). */
  app.post('/invoices', { config: { permission: 'finance:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createInvoiceInput, req.body);
    const dbCtx = singleTenantContext(access, 'finance:write', req);
    const invoice = await withContext(ctx.pool, dbCtx, async (tx) => {
      const number = await nextNumber(tx, 'invoice_number_seq', 'FAT');
      const { id } = (
        await tx
          .query<{ id: string }>(
            `INSERT INTO invoices (tenant_id, contract_id, number, kind, description, amount_cents, due_date) VALUES ($1, $2, $3, 'one_off', $4, $5, $6) RETURNING id`,
            [dbCtx.tenantId, input.contractId ?? null, number, input.description, input.amountCents, input.dueDate],
          )
          .catch((err) => {
            if ((err as { code?: string }).code === '23503') throw badRequest('Contrato não encontrado neste cliente');
            throw err;
          })
      ).rows[0]!;
      await enqueue(tx, { type: 'invoice.issued', tenantId: dbCtx.tenantId, payload: { invoiceId: id } });
      await ctx.audit.recordIn(tx, { action: 'invoice.create', result: 'success', tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, resourceType: 'invoice', resourceId: id, ...requestMeta(req), metadata: { amountCents: input.amountCents } });
      return (await tx.query(`${INVOICE_SELECT} WHERE i.id = $1`, [id])).rows[0];
    });
    return reply.code(201).send(invoice);
  });

  /** Baixa manual (PIX/boleto/transferência). Gateways de pagamento: integração pendente. */
  app.post('/invoices/:id/payments', { config: { permission: 'finance:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(registerPaymentInput, req.body);
    const result = await withContext(ctx.pool, access.context('finance:write', requestedTenant(req)), async (tx) => {
      const invoice = (
        await tx.query<{ id: string; tenant_id: string; amount_cents: string; status: string; paid: string }>(
          `SELECT i.id, i.tenant_id, i.amount_cents, i.status, (SELECT coalesce(sum(amount_cents), 0) FROM payments WHERE invoice_id = i.id) AS paid
             FROM invoices i WHERE i.id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!invoice) throw notFound();
      if (invoice.status !== 'open') throw badRequest('Só faturas em aberto recebem pagamento');
      if (input.amountCents > Number(invoice.amount_cents) - Number(invoice.paid)) throw badRequest('Valor maior que o saldo da fatura');
      const r = await applyPayment(tx, invoice, { ...input, actorUserId: access.principal.userId });
      await ctx.audit.recordIn(tx, { action: 'payment.register', result: 'success', tenantId: invoice.tenant_id, actorUserId: access.principal.userId, resourceType: 'invoice', resourceId: id, ...requestMeta(req), metadata: { amountCents: input.amountCents, method: input.method, paid: r.paid } });
      return { ...r, invoice: (await tx.query(`${INVOICE_SELECT} WHERE i.id = $1`, [id])).rows[0] };
    });
    return reply.code(201).send(result);
  });

  app.post('/invoices/:id/cancel', { config: { permission: 'finance:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(cancelInput, req.body);
    const result = await withContext(ctx.pool, access.context('finance:write', requestedTenant(req)), async (tx) => {
      const inv = (await tx.query<{ tenant_id: string; status: string; number: string }>(`SELECT tenant_id, status, number FROM invoices WHERE id = $1`, [id])).rows[0];
      if (!inv) throw notFound();
      if (inv.status !== 'open') throw badRequest('Só faturas em aberto podem ser canceladas');
      return requestCriticalAction(tx, ctx, access, requestMeta(req), { tenantId: inv.tenant_id, action: 'invoice.cancel', resourceId: id, payload: { invoiceNumber: inv.number }, reason: input.reason });
    });
    return reply.code(result.status === 'pending' ? 202 : 200).send(result);
  });

  // ------------------------------------------------------------------ despesas
  app.get('/expenses', { config: { permission: 'finance:read' } }, async (req) => {
    const access = requireAccess(req);
    const { month } = parse(periodQuery, req.query);
    const { from, to } = monthRange(month);
    return withContext(ctx.pool, access.context('finance:read'), async (tx) => ({
      items: (
        await tx.query(
          `SELECT e.id, e.category, e.description, e.supplier, e.amount_cents::float8 AS "amountCents", to_char(e.incurred_on, 'YYYY-MM-DD') AS "incurredOn",
                  e.client_tenant_id AS "clientTenantId", t.name AS "clientName", u.name AS "recordedByName",
                  EXISTS (SELECT 1 FROM pending_actions a WHERE a.resource_id = e.id AND a.status = 'pending') AS "deletionPending"
             FROM expenses e LEFT JOIN tenants t ON t.id = e.client_tenant_id LEFT JOIN users u ON u.id = e.recorded_by
            WHERE e.deleted_at IS NULL AND e.incurred_on BETWEEN $1 AND $2
            ORDER BY e.incurred_on DESC, e.created_at DESC`,
          [from, to],
        )
      ).rows,
    }));
  });

  app.post('/expenses', { config: { permission: 'finance:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createExpenseInput, req.body);
    const expense = await withContext(ctx.pool, access.context('finance:write'), async (tx) => {
      const agency = (await tx.query<{ id: string }>(`SELECT id FROM tenants WHERE kind = 'agency' LIMIT 1`)).rows[0];
      if (!agency) throw badRequest('Despesas exigem acesso global de financeiro');
      const row = (
        await tx
          .query(
            `INSERT INTO expenses (tenant_id, client_tenant_id, category, description, supplier, amount_cents, incurred_on, recorded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [agency.id, input.clientTenantId ?? null, input.category, input.description, input.supplier, input.amountCents, input.incurredOn, access.principal.userId],
          )
          .catch((err) => {
            if ((err as { code?: string }).code === '23514' || (err as { code?: string }).code === '23503') throw badRequest('Cliente de rateio inválido');
            throw err;
          })
      ).rows[0];
      await ctx.audit.recordIn(tx, { action: 'expense.create', result: 'success', tenantId: agency.id, actorUserId: access.principal.userId, resourceType: 'expense', resourceId: row.id, ...requestMeta(req), metadata: { amountCents: input.amountCents, category: input.category } });
      return row;
    });
    return reply.code(201).send(expense);
  });

  app.delete('/expenses/:id', { config: { permission: 'finance:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const reason = parse(cancelInput, req.body ?? {}).reason;
    const result = await withContext(ctx.pool, access.context('finance:write'), async (tx) => {
      const e = (await tx.query<{ tenant_id: string; description: string }>(`SELECT tenant_id, description FROM expenses WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0];
      if (!e) throw notFound();
      return requestCriticalAction(tx, ctx, access, requestMeta(req), { tenantId: e.tenant_id, action: 'expense.delete', resourceId: id, payload: { description: e.description }, reason });
    });
    return reply.code(result.status === 'pending' ? 202 : 200).send(result);
  });

  // ------------------------------------------------------------------ visão financeira
  app.get('/finance/summary', { config: { permission: 'finance:read' } }, async (req) => {
    const access = requireAccess(req);
    const { month } = parse(periodQuery, req.query);
    const { month: m, from, to } = monthRange(month);
    return withContext(ctx.pool, access.context('finance:read', requestedTenant(req)), async (tx) => {
      const r = (
        await tx.query(
          `SELECT
             (SELECT coalesce(sum(round(recurring_amount_cents / CASE periodicity WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 ELSE 1 END)), 0)
                FROM contracts WHERE status = 'active')::float8 AS "mrrCents",
             (SELECT count(*)::int FROM contracts WHERE status = 'active') AS "activeContracts",
             (SELECT coalesce(sum(amount_cents), 0) FROM payments WHERE paid_at BETWEEN $1 AND $2)::float8 AS "receivedCents",
             (SELECT coalesce(sum(amount_cents), 0) FROM invoices WHERE status <> 'cancelled' AND due_date BETWEEN $1 AND $2)::float8 AS "billedCents",
             (SELECT coalesce(sum(i.amount_cents - coalesce((SELECT sum(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0)), 0)
                FROM invoices i WHERE i.status = 'open' AND i.due_date >= current_date)::float8 AS "receivableCents",
             (SELECT coalesce(sum(i.amount_cents - coalesce((SELECT sum(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0)), 0)
                FROM invoices i WHERE i.status = 'open' AND i.due_date < current_date)::float8 AS "overdueCents",
             (SELECT count(*)::int FROM invoices WHERE status = 'open' AND due_date < current_date) AS "overdueCount",
             (SELECT count(DISTINCT tenant_id)::int FROM invoices WHERE status = 'open' AND due_date < current_date) AS "overdueClients",
             (SELECT coalesce(sum(amount_cents), 0) FROM invoices
               WHERE status <> 'cancelled' AND due_date < current_date AND due_date >= current_date - 365)::float8 AS "dueLast12mCents",
             (SELECT coalesce(sum(amount_cents), 0) FROM expenses WHERE deleted_at IS NULL AND incurred_on BETWEEN $1 AND $2)::float8 AS "expensesCents",
             (SELECT count(*)::int FROM pending_actions WHERE status = 'pending') AS "pendingActions"`,
          [from, to],
        )
      ).rows[0];
      const series = (
        await tx.query(
          `SELECT to_char(m, 'YYYY-MM') AS month,
                  (SELECT coalesce(sum(amount_cents), 0) FROM payments WHERE date_trunc('month', paid_at) = m)::float8 AS "receivedCents",
                  (SELECT coalesce(sum(amount_cents), 0) FROM expenses WHERE deleted_at IS NULL AND date_trunc('month', incurred_on) = m)::float8 AS "expensesCents"
             FROM generate_series(date_trunc('month', $1::date) - interval '5 months', date_trunc('month', $1::date), interval '1 month') AS m`,
          [from],
        )
      ).rows;
      return {
        month: m,
        ...r,
        averageTicketCents: r.activeContracts > 0 ? Math.round(r.mrrCents / r.activeContracts) : 0,
        delinquencyRate: r.dueLast12mCents > 0 ? Math.round((r.overdueCents / r.dueLast12mCents) * 1000) / 10 : 0,
        resultCents: r.receivedCents - r.expensesCents,
        series,
        paymentGateway: 'integration_pending',
      };
    });
  });

  app.get('/finance/profitability', { config: { permission: 'finance:read' } }, async (req) => {
    const access = requireAccess(req);
    const { month } = parse(periodQuery, req.query);
    const threshold = await withContext(ctx.pool, SYSTEM, async (tx) => (await getAgencySettings(tx)).marginAlertPercent);
    return withContext(ctx.pool, access.context('finance:read'), (tx) => profitabilityReport(tx, month, threshold));
  });

  // ------------------------------------------------------------------ configurações da agência
  app.get('/settings/agency', { config: { permission: 'finance:read' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('finance:read'), (tx) => getAgencySettings(tx));
  });

  app.put('/settings/agency', { config: { permission: 'finance:approve' } }, async (req) => {
    const access = requireAccess(req);
    const input = parse(agencySettingsInput, req.body);
    const map: Record<string, string> = {
      agencyName: 'agency_name',
      agencyDocument: 'agency_document',
      agencyAddress: 'agency_address',
      agencyEmail: 'agency_email',
      agencyPhone: 'agency_phone',
      paymentInstructions: 'payment_instructions',
      proposalFooter: 'proposal_footer',
      marginAlertPercent: 'margin_alert_percent',
      invoiceLeadDays: 'invoice_lead_days',
    };
    return withContext(ctx.pool, access.context('finance:approve'), async (tx) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [k, col] of Object.entries(map)) {
        const v = (input as Record<string, unknown>)[k];
        if (v !== undefined) sets.push(`${col} = $${params.push(v)}`);
      }
      if (sets.length) await tx.query(`UPDATE agency_settings SET ${sets.join(', ')} WHERE id = 1`, params);
      await ctx.audit.recordIn(tx, { action: 'settings.agency_update', result: 'success', actorUserId: access.principal.userId, resourceType: 'agency_settings', resourceId: '1', ...requestMeta(req), metadata: { fields: Object.keys(input) } });
      return getAgencySettings(tx);
    });
  });

  // ------------------------------------------------------------------ portal do cliente
  /** Contrato, faturas e propostas do PRÓPRIO tenant (sem notas internas). */
  app.get('/portal/billing', { config: { permission: 'billing:read' } }, async (req) => {
    const access = requireAccess(req);
    const paymentInstructions = await withContext(ctx.pool, SYSTEM, async (tx) => (await getAgencySettings(tx)).paymentInstructions);
    return withContext(ctx.pool, access.context('billing:read', requestedTenant(req)), async (tx) => {
      const contracts = (await tx.query(`${CONTRACT_SELECT} WHERE k.status <> 'cancelled' ORDER BY k.start_date DESC`)).rows;
      const invoices = (await tx.query(`${INVOICE_SELECT} WHERE i.status <> 'cancelled' ORDER BY i.due_date DESC LIMIT 100`)).rows;
      const proposals = (
        await tx.query<{ id: string; number: string; title: string; status: string; validUntil: string; recurringTotalCents: number; oneTimeTotalCents: number; nonce: string | null }>(
          `SELECT id, number, title, status, to_char(valid_until, 'YYYY-MM-DD') AS "validUntil", recurring_total_cents::float8 AS "recurringTotalCents",
                  one_time_total_cents::float8 AS "oneTimeTotalCents", public_token_nonce AS nonce
             FROM proposals WHERE status <> 'draft' ORDER BY created_at DESC`,
        )
      ).rows.map(({ nonce, ...p }) => ({ ...p, link: nonce ? `/p/${proposalToken(ctx.env.APP_SECRET, p.id, nonce)}` : null }));
      return { contracts, invoices, proposals, paymentInstructions, paymentGateway: 'integration_pending' };
    });
  });

}
