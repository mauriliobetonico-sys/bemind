import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actionPolicyInput, decideActionInput, uuidParam } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, type Tx } from '../../db/pool';
import { AppError, conflict, forbidden, notFound, parse } from '../../lib/errors';
import type { Access } from '../../security/access';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { enqueue } from '../../outbox/outbox';
import { recordActivity } from '../work/common';

export type CriticalAction = 'contract.change_value' | 'contract.cancel' | 'invoice.cancel' | 'expense.delete';

interface PendingAction {
  id: string;
  tenant_id: string;
  action: CriticalAction;
  resource_id: string;
  payload: Record<string, unknown>;
  reason: string;
  requested_by: string | null;
}

/**
 * Executores das ações críticas. Rodam SOMENTE depois da aprovação humana
 * (ou quando a política da ação não exige aprovação). Erros de negócio
 * abortam a execução e a ação fica marcada como "failed".
 */
const EXECUTORS: Record<CriticalAction, (tx: Tx, a: PendingAction, actor: string) => Promise<void>> = {
  'contract.change_value': async (tx, a, actor) => {
    const amount = Number(a.payload.recurringAmountCents);
    const r = await tx.query(`UPDATE contracts SET recurring_amount_cents = $2 WHERE id = $1 AND status IN ('active', 'suspended') RETURNING tenant_id`, [a.resource_id, amount]);
    if (!r.rowCount) throw new AppError(409, 'invalid_state', 'Contrato não está ativo');
    // Faturas futuras ainda em aberto e sem pagamento acompanham o novo valor.
    await tx.query(
      `UPDATE invoices SET amount_cents = $2
        WHERE contract_id = $1 AND kind = 'recurring' AND status = 'open' AND period_start > current_date
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = invoices.id)`,
      [a.resource_id, amount],
    );
    await recordActivity(tx, { tenantId: a.tenant_id, actorUserId: actor, type: 'contract.value_changed', data: { contractId: a.resource_id, recurringAmountCents: amount } });
  },
  'contract.cancel': async (tx, a, actor) => {
    const r = await tx.query(
      `UPDATE contracts SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, end_date = coalesce(end_date, current_date)
        WHERE id = $1 AND status <> 'cancelled' RETURNING id`,
      [a.resource_id, a.reason],
    );
    if (!r.rowCount) throw new AppError(409, 'invalid_state', 'Contrato já cancelado');
    await tx.query(
      `UPDATE invoices SET status = 'cancelled', cancelled_reason = 'Contrato cancelado'
        WHERE contract_id = $1 AND status = 'open' AND coalesce(period_start, due_date) > current_date
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = invoices.id)`,
      [a.resource_id],
    );
    await recordActivity(tx, { tenantId: a.tenant_id, actorUserId: actor, type: 'contract.cancelled', data: { contractId: a.resource_id, reason: a.reason } });
  },
  'invoice.cancel': async (tx, a, actor) => {
    const r = await tx.query(
      `UPDATE invoices SET status = 'cancelled', cancelled_reason = $2
        WHERE id = $1 AND status = 'open' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = invoices.id)
        RETURNING number`,
      [a.resource_id, a.reason],
    );
    if (!r.rowCount) throw new AppError(409, 'invalid_state', 'Só faturas em aberto e sem pagamento podem ser canceladas');
    await recordActivity(tx, { tenantId: a.tenant_id, actorUserId: actor, type: 'invoice.cancelled', data: { invoiceId: a.resource_id, number: r.rows[0].number, reason: a.reason } });
  },
  'expense.delete': async (tx, a) => {
    const r = await tx.query(`UPDATE expenses SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [a.resource_id]);
    if (!r.rowCount) throw new AppError(409, 'invalid_state', 'Despesa já excluída');
  },
};

/**
 * Pede uma ação crítica. Se a política exigir aprovação humana, cria um
 * pedido pendente e avisa os aprovadores; senão, executa na hora.
 */
export async function requestCriticalAction(
  tx: Tx,
  ctx: AppContext,
  access: Access,
  meta: { ip: string | null; userAgent: string | null },
  a: { tenantId: string; action: CriticalAction; resourceId: string; payload?: Record<string, unknown>; reason: string },
): Promise<{ status: 'pending' | 'executed'; actionId: string }> {
  const policy = (await tx.query<{ requires_approval: boolean }>(`SELECT requires_approval FROM action_policies WHERE action = $1`, [a.action])).rows[0];
  const requiresApproval = policy?.requires_approval ?? true;
  const actor = access.principal.userId;
  const row = (
    await tx
      .query<PendingAction>(
        `INSERT INTO pending_actions (tenant_id, action, resource_id, payload, reason, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, tenant_id, action, resource_id, payload, reason, requested_by`,
        [a.tenantId, a.action, a.resourceId, JSON.stringify(a.payload ?? {}), a.reason, actor],
      )
      .catch((err) => {
        if ((err as { code?: string }).code === '23505') throw conflict('Já existe um pedido pendente para este item');
        throw err;
      })
  ).rows[0]!;

  if (!requiresApproval) {
    await EXECUTORS[a.action](tx, row, actor);
    await tx.query(`UPDATE pending_actions SET status = 'executed', decided_by = $2, decided_at = now(), decision_note = 'Política: sem aprovação' WHERE id = $1`, [row.id, actor]);
    await ctx.audit.recordIn(tx, { action: `${a.action}.executed`, result: 'success', tenantId: a.tenantId, actorUserId: actor, resourceType: 'pending_action', resourceId: row.id, ...meta, metadata: { policy: 'no_approval' } });
    return { status: 'executed', actionId: row.id };
  }
  await enqueue(tx, { type: 'action.requested', tenantId: a.tenantId, payload: { actionId: row.id } });
  await ctx.audit.recordIn(tx, { action: `${a.action}.requested`, result: 'success', tenantId: a.tenantId, actorUserId: actor, resourceType: 'pending_action', resourceId: row.id, ...meta, metadata: { reason: a.reason, payload: a.payload } });
  return { status: 'pending', actionId: row.id };
}

const listQuery = z.strictObject({ status: z.enum(['pending', 'rejected', 'executed', 'failed']).optional() });

export async function hitlRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/actions', { config: { permission: 'finance:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(listQuery, req.query);
    return withContext(ctx.pool, access.context('finance:read', requestedTenant(req)), async (tx) => ({
      items: (
        await tx.query(
          `SELECT a.id, a.tenant_id AS "tenantId", t.name AS "clientName", a.action, a.resource_id AS "resourceId", a.payload, a.reason,
                  a.status, a.decision_note AS "decisionNote", a.error, a.created_at AS "createdAt", a.decided_at AS "decidedAt",
                  a.requested_by AS "requestedBy", ru.name AS "requestedByName", du.name AS "decidedByName", p.allow_self_approval AS "allowSelfApproval"
             FROM pending_actions a
             JOIN tenants t ON t.id = a.tenant_id
             JOIN action_policies p ON p.action = a.action
             LEFT JOIN users ru ON ru.id = a.requested_by
             LEFT JOIN users du ON du.id = a.decided_by
            ${q.status ? 'WHERE a.status = $1' : ''}
            ORDER BY (a.status <> 'pending'), a.created_at DESC LIMIT 200`,
          q.status ? [q.status] : [],
        )
      ).rows,
    }));
  });

  /** Decisão humana: aprovar executa a ação na mesma transação; rejeitar só registra. */
  app.post('/actions/:id/decide', { config: { permission: 'finance:approve' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(decideActionInput, req.body);
    const meta = requestMeta(req);
    const actor = access.principal.userId;
    try {
      return await withContext(ctx.pool, access.context('finance:approve', requestedTenant(req)), async (tx) => {
        const a = (
          await tx.query<PendingAction & { status: string; allow_self_approval: boolean }>(
            `SELECT a.*, p.allow_self_approval FROM pending_actions a JOIN action_policies p ON p.action = a.action WHERE a.id = $1 FOR UPDATE OF a`,
            [id],
          )
        ).rows[0];
        if (!a) throw notFound();
        if (a.status !== 'pending') throw conflict('Este pedido já foi decidido');
        if (a.requested_by === actor && !a.allow_self_approval) throw forbidden('A política desta ação exige outra pessoa para aprovar');
        if (input.decision === 'reject') {
          await tx.query(`UPDATE pending_actions SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`, [id, actor, input.note]);
          await ctx.audit.recordIn(tx, { action: `${a.action}.rejected`, result: 'success', tenantId: a.tenant_id, actorUserId: actor, resourceType: 'pending_action', resourceId: id, ...meta });
          return { id, status: 'rejected' };
        }
        await EXECUTORS[a.action](tx, a, actor);
        await tx.query(`UPDATE pending_actions SET status = 'executed', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`, [id, actor, input.note]);
        await ctx.audit.recordIn(tx, {
          action: `${a.action}.approved`,
          result: 'success',
          tenantId: a.tenant_id,
          actorUserId: actor,
          resourceType: 'pending_action',
          resourceId: id,
          ...meta,
          metadata: { selfApproved: a.requested_by === actor, payload: a.payload },
        });
        return { id, status: 'executed' };
      });
    } catch (err) {
      // Falha de execução após aprovação: registra o motivo (transação própria).
      if (err instanceof AppError && err.code === 'invalid_state') {
        await withContext(ctx.pool, access.context('finance:approve', requestedTenant(req)), (tx) =>
          tx.query(`UPDATE pending_actions SET status = 'failed', decided_by = $2, decided_at = now(), error = $3 WHERE id = $1 AND status = 'pending'`, [id, actor, err.message]),
        );
      }
      throw err;
    }
  });

  app.get('/action-policies', { config: { permission: 'finance:approve' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('finance:approve'), async (tx) => ({
      items: (
        await tx.query(`SELECT action, description, requires_approval AS "requiresApproval", allow_self_approval AS "allowSelfApproval" FROM action_policies ORDER BY action`)
      ).rows,
    }));
  });

  /** Mudar a política de uma ação crítica é, por si só, sensível: só SUPER_ADMIN. */
  app.put('/action-policies/:action', { config: { permission: 'platform:settings' } }, async (req) => {
    const access = requireAccess(req);
    const { action } = parse(z.strictObject({ action: z.string().regex(/^[a-z_]+\.[a-z_]+$/) }), req.params);
    const input = parse(actionPolicyInput, req.body);
    return withContext(ctx.pool, access.context('platform:settings'), async (tx) => {
      const r = await tx.query(`UPDATE action_policies SET requires_approval = $2, allow_self_approval = $3, updated_at = now() WHERE action = $1 RETURNING action`, [action, input.requiresApproval, input.allowSelfApproval]);
      if (!r.rowCount) throw notFound();
      await ctx.audit.recordIn(tx, { action: 'policy.change', result: 'success', actorUserId: access.principal.userId, resourceType: 'action_policy', resourceId: action, ...requestMeta(req), metadata: input });
      return { action, ...input };
    });
  });
}

