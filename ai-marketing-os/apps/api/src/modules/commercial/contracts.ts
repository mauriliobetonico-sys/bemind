import type { FastifyInstance } from 'fastify';
import { cancelInput, changeValueInput, createContractInput, updateContractInput, uuidParam } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, SYSTEM, type Tx } from '../../db/pool';
import { badRequest, notFound, parse } from '../../lib/errors';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { recordActivity, singleTenantContext } from '../work/common';
import { requestCriticalAction } from '../hitl/actions';
import { getAgencySettings } from '../finance/settings';
import { isoDate, issueInitialInvoices, nextNumber } from './billing';

export const CONTRACT_SELECT = `
  SELECT k.id, k.tenant_id AS "tenantId", c.trade_name AS "clientName", k.number, k.proposal_id AS "proposalId", k.title, k.status,
         k.periodicity, k.recurring_amount_cents::float8 AS "recurringAmountCents", k.setup_amount_cents::float8 AS "setupAmountCents",
         round(k.recurring_amount_cents / CASE k.periodicity WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 ELSE 1 END)::float8 AS "monthlyValueCents",
         to_char(k.start_date, 'YYYY-MM-DD') AS "startDate", to_char(k.end_date, 'YYYY-MM-DD') AS "endDate", k.billing_day AS "billingDay",
         k.services, k.signature_status AS "signatureStatus", k.cancelled_at AS "cancelledAt", k.cancel_reason AS "cancelReason",
         k.created_at AS "createdAt",
         (SELECT p.number FROM proposals p WHERE p.id = k.proposal_id) AS "proposalNumber"
    FROM contracts k JOIN clients c ON c.tenant_id = k.tenant_id`;

async function findContract(tx: Tx, id: string) {
  return (await tx.query(`${CONTRACT_SELECT} WHERE k.id = $1`, [id])).rows[0];
}

export async function contractRoutes(app: FastifyInstance, ctx: AppContext) {
  const leadDays = () => withContext(ctx.pool, SYSTEM, async (tx) => (await getAgencySettings(tx)).invoiceLeadDays);

  app.get('/contracts', { config: { permission: 'contracts:read' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('contracts:read', requestedTenant(req)), async (tx) => ({
      items: (await tx.query(`${CONTRACT_SELECT} ORDER BY (k.status <> 'active'), c.trade_name LIMIT 500`)).rows,
    }));
  });

  app.get('/contracts/:id', { config: { permission: 'contracts:read' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('contracts:read', requestedTenant(req)), async (tx) => {
      const contract = await findContract(tx, id);
      if (!contract) throw notFound();
      const invoices = (
        await tx.query(
          `SELECT i.id, i.number, i.kind, i.description, i.amount_cents::float8 AS "amountCents", to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
                  CASE WHEN i.status = 'open' AND i.due_date < current_date THEN 'overdue' ELSE i.status END AS status,
                  to_char(i.paid_at, 'YYYY-MM-DD') AS "paidAt",
                  (SELECT coalesce(sum(p.amount_cents), 0)::float8 FROM payments p WHERE p.invoice_id = i.id) AS "paidCents"
             FROM invoices i WHERE i.contract_id = $1 ORDER BY i.due_date DESC`,
          [id],
        )
      ).rows;
      const actions = (
        await tx.query(
          `SELECT a.id, a.action, a.status, a.reason, a.payload, a.created_at AS "createdAt" FROM pending_actions a
            WHERE a.resource_id = $1 ORDER BY a.created_at DESC LIMIT 20`,
          [id],
        )
      ).rows;
      return { ...contract, invoices, actions };
    });
  });

  /** Contrato direto (sem proposta): assinado fora da plataforma. */
  app.post('/contracts', { config: { permission: 'contracts:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createContractInput, req.body);
    const dbCtx = singleTenantContext(access, 'contracts:write', req);
    const lead = await leadDays();
    const contract = await withContext(ctx.pool, dbCtx, async (tx) => {
      const number = await nextNumber(tx, 'contract_number_seq', 'CTR');
      const { id } = (
        await tx.query<{ id: string }>(
          `INSERT INTO contracts (tenant_id, number, title, periodicity, recurring_amount_cents, setup_amount_cents, start_date, end_date, billing_day, services, signature_status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual', $11) RETURNING id`,
          [dbCtx.tenantId, number, input.title, input.periodicity, input.recurringAmountCents, input.setupAmountCents, input.startDate, input.endDate ?? null, input.billingDay, JSON.stringify(input.services), access.principal.userId],
        )
      ).rows[0]!;
      await issueInitialInvoices(tx, { tenantId: dbCtx.tenantId, contractId: id, title: input.title, setupCents: input.setupAmountCents, today: isoDate(new Date()), leadDays: lead });
      await recordActivity(tx, { tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, type: 'contract.created', data: { contractId: id, number } });
      await ctx.audit.recordIn(tx, { action: 'contract.create', result: 'success', tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, resourceType: 'contract', resourceId: id, ...requestMeta(req), metadata: { recurringAmountCents: input.recurringAmountCents } });
      return findContract(tx, id);
    });
    return reply.code(201).send(contract);
  });

  /** Alterações não críticas. Suspender para a geração de faturas. */
  app.patch('/contracts/:id', { config: { permission: 'contracts:write' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateContractInput, req.body);
    return withContext(ctx.pool, access.context('contracts:write', requestedTenant(req)), async (tx) => {
      const current = await findContract(tx, id);
      if (!current) throw notFound();
      if (current.status === 'cancelled') throw badRequest('Contrato cancelado não pode ser alterado');
      const map: Record<string, string> = { title: 'title', endDate: 'end_date', billingDay: 'billing_day', status: 'status' };
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [k, col] of Object.entries(map)) {
        const v = (input as Record<string, unknown>)[k];
        if (v !== undefined) sets.push(`${col} = $${params.push(v)}`);
      }
      await tx.query(`UPDATE contracts SET ${sets.join(', ')} WHERE id = $1`, params);
      await ctx.audit.recordIn(tx, { action: 'contract.update', result: 'success', tenantId: current.tenantId, actorUserId: access.principal.userId, resourceType: 'contract', resourceId: id, ...requestMeta(req), metadata: input });
      return findContract(tx, id);
    });
  });

  app.post('/contracts/:id/change-value', { config: { permission: 'contracts:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(changeValueInput, req.body);
    const result = await withContext(ctx.pool, access.context('contracts:write', requestedTenant(req)), async (tx) => {
      const c = await findContract(tx, id);
      if (!c) throw notFound();
      return requestCriticalAction(tx, ctx, access, requestMeta(req), {
        tenantId: c.tenantId,
        action: 'contract.change_value',
        resourceId: id,
        payload: { recurringAmountCents: input.recurringAmountCents, previousCents: c.recurringAmountCents, contractNumber: c.number },
        reason: input.reason,
      });
    });
    return reply.code(result.status === 'pending' ? 202 : 200).send(result);
  });

  app.post('/contracts/:id/cancel', { config: { permission: 'contracts:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(cancelInput, req.body);
    const result = await withContext(ctx.pool, access.context('contracts:write', requestedTenant(req)), async (tx) => {
      const c = await findContract(tx, id);
      if (!c) throw notFound();
      if (c.status === 'cancelled') throw badRequest('Contrato já cancelado');
      return requestCriticalAction(tx, ctx, access, requestMeta(req), { tenantId: c.tenantId, action: 'contract.cancel', resourceId: id, payload: { contractNumber: c.number }, reason: input.reason });
    });
    return reply.code(result.status === 'pending' ? 202 : 200).send(result);
  });
}
