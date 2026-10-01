import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  briefingInput,
  createDeliverableInput,
  createDemandInput,
  decideApprovalInput,
  DEMAND_MANUAL_TRANSITIONS,
  listDemandsQuery,
  requestApprovalInput,
  updateDeliverableInput,
  updateDemandInput,
  uuidParam,
  type DemandStatus,
} from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, type Tx } from '../../db/pool';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import type { Access } from '../../security/access';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { enqueue } from '../../outbox/outbox';
import { budgetStatus } from '../../ai/gateway';
import { INTERNAL_EVENT_TYPES } from '../clients/repository';
import { queueRun } from '../../ai/runs';
import { buildUpdate, dateOnly, recordActivity, singleTenantContext } from '../work/common';

const DEMAND_SELECT = `
  SELECT d.id, d.tenant_id AS "tenantId", t.name AS "clientName", d.project_id AS "projectId", p.name AS "projectName",
         d.type, d.title, d.description, d.priority, ${dateOnly('d.due_date', 'dueDate')}, d.refs, d.notes, d.status,
         d.requested_by AS "requestedBy", u.name AS "requestedByName",
         (d.due_date < current_date AND d.status NOT IN ('approved', 'delivered', 'cancelled')) AS overdue,
         d.created_at AS "createdAt", d.updated_at AS "updatedAt"
    FROM demands d
    JOIN tenants t ON t.id = d.tenant_id
    LEFT JOIN projects p ON p.tenant_id = d.tenant_id AND p.id = d.project_id
    LEFT JOIN users u ON u.id = d.requested_by`;

const DEMAND_COLUMNS = { title: 'title', description: 'description', priority: 'priority', dueDate: 'due_date', refs: 'refs', notes: 'notes', projectId: 'project_id', status: 'status' };

/** Estados de entregável que o cliente pode ver (o resto é trabalho interno). */
const CLIENT_VISIBLE_DELIVERABLES = ['awaiting_client', 'changes_requested', 'approved'];

const DELIVERABLE_SELECT = `
  SELECT v.id, v.tenant_id AS "tenantId", v.demand_id AS "demandId", v.title, v.description, v.file_id AS "fileId",
         f.name AS "fileName", f.mime AS "fileMime", v.version, v.status, v.qa_notes AS "qaNotes",
         v.agent_run_id AS "agentRunId", v.ai_review AS "aiReview",
         v.created_at AS "createdAt", v.updated_at AS "updatedAt",
         (SELECT row_to_json(a) FROM (
            SELECT a.id, a.status, a.message, a.reason, a.version, a.created_at AS "createdAt", a.decided_at AS "decidedAt",
                   du.name AS "decidedByName"
              FROM approvals a LEFT JOIN users du ON du.id = a.decided_by
             WHERE a.deliverable_id = v.id ORDER BY a.created_at DESC LIMIT 1) a) AS "lastApproval"
    FROM deliverables v
    LEFT JOIN files f ON f.tenant_id = v.tenant_id AND f.id = v.file_id`;

const isStaffFor = (access: Access, tenantId: string) => access.can('work:manage', tenantId);

async function findDemand(tx: Tx, id: string, forUpdate = false) {
  return (await tx.query(`${DEMAND_SELECT} WHERE d.id = $1 ${forUpdate ? 'FOR UPDATE OF d' : ''}`, [id])).rows[0];
}

async function findDeliverable(tx: Tx, id: string, forUpdate = false) {
  return (await tx.query(`${DELIVERABLE_SELECT} WHERE v.id = $1 ${forUpdate ? 'FOR UPDATE OF v' : ''}`, [id])).rows[0];
}

async function setDemandStatus(tx: Tx, demandId: string, status: DemandStatus) {
  await tx.query('UPDATE demands SET status = $2 WHERE id = $1', [demandId, status]);
}

/** O arquivo de um entregável precisa ser do mesmo tenant (a FK composta também garante). */
async function assertFile(tx: Tx, tenantId: string, fileId: string | null | undefined) {
  if (!fileId) return;
  const ok = (await tx.query(`SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [fileId, tenantId])).rowCount;
  if (!ok) throw badRequest('Arquivo não encontrado neste cliente');
}

const approvalsQuery = z.strictObject({ status: z.enum(['pending', 'approved', 'changes_requested', 'cancelled']).optional() });

export async function demandRoutes(app: FastifyInstance, ctx: AppContext) {
  // ------------------------------------------------------------------ demandas
  app.get('/demands', { config: { permission: 'work:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(listDemandsQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) where.push(`d.status = $${params.push(q.status)}`);
    if (q.open === 'true') where.push(`d.status NOT IN ('delivered', 'cancelled')`);
    if (q.projectId) where.push(`d.project_id = $${params.push(q.projectId)}`);
    params.push(q.limit);
    return withContext(ctx.pool, access.context('work:read', requestedTenant(req)), async (tx) => ({
      items: (
        await tx.query(
          `${DEMAND_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY (d.status IN ('delivered','cancelled')), d.due_date NULLS LAST,
                    array_position(ARRAY['urgent','high','normal','low'], d.priority), d.created_at DESC
           LIMIT $${params.length}`,
          params,
        )
      ).rows,
    }));
  });

  app.get('/demands/:id', { config: { permission: 'work:read' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('work:read', requestedTenant(req)), async (tx) => {
      const demand = await findDemand(tx, id);
      if (!demand) throw notFound();
      const staff = isStaffFor(access, demand.tenantId);
      const briefing = (
        await tx.query(
          `SELECT b.version, b.objective, b.audience, b.key_messages AS "keyMessages", b.deliverables, b.tone, b.constraints,
                  b.created_at AS "createdAt", u.name AS "authorName"
             FROM briefings b LEFT JOIN users u ON u.id = b.author_id
            WHERE b.demand_id = $1 ORDER BY b.version DESC LIMIT 1`,
          [id],
        )
      ).rows[0] ?? null;
      const deliverables = (
        await tx.query(
          `${DELIVERABLE_SELECT} WHERE v.demand_id = $1 ${staff ? '' : `AND v.status = ANY($2)`} ORDER BY v.created_at`,
          staff ? [id] : [id, CLIENT_VISIBLE_DELIVERABLES],
        )
      ).rows.map((v) => (staff ? v : { ...v, qaNotes: null, agentRunId: null, aiReview: null }));
      const activity = (
        await tx.query(
          `SELECT e.id, e.type, e.data, e.created_at AS "createdAt", u.name AS "actorName"
             FROM client_events e LEFT JOIN users u ON u.id = e.actor_user_id
            WHERE e.tenant_id = $1 AND e.data->>'demandId' = $2 ${staff ? '' : `AND e.type <> ALL($3) AND e.type NOT LIKE 'ai.%' AND e.type NOT LIKE 'mcp.%'`}
            ORDER BY e.created_at DESC LIMIT 100`,
          staff ? [demand.tenantId, id] : [demand.tenantId, id, INTERNAL_EVENT_TYPES],
        )
      ).rows;
      const tasks = staff
        ? (await tx.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'done')::int AS done FROM tasks WHERE demand_id = $1`, [id])).rows[0]
        : null;
      return { ...demand, briefing, deliverables, activity, tasks, canManage: staff, allowedTransitions: staff ? DEMAND_MANUAL_TRANSITIONS[demand.status as DemandStatus] : [] };
    });
  });

  app.post('/demands', { config: { permission: 'demands:create' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createDemandInput, req.body);
    const dbCtx = singleTenantContext(access, 'demands:create', req);
    const actor = access.principal.userId;
    const demand = await withContext(ctx.pool, dbCtx, async (tx) => {
      const { id } = (
        await tx
          .query<{ id: string }>(
            `INSERT INTO demands (tenant_id, project_id, type, title, description, priority, due_date, refs, notes, requested_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [dbCtx.tenantId, input.projectId ?? null, input.type, input.title, input.description, input.priority, input.dueDate ?? null, input.refs, input.notes, actor],
          )
          .catch((err) => {
            if ((err as { code?: string }).code === '23503') throw badRequest('Projeto não encontrado neste cliente');
            throw err;
          })
      ).rows[0]!;
      await recordActivity(tx, { tenantId: dbCtx.tenantId, actorUserId: actor, type: 'demand.created', data: { demandId: id, title: input.title, demandType: input.type } });
      // DEMANDA CRIADA → equipe notificada; com auto-plano ligado, o Orchestrator monta o plano.
      await enqueue(tx, { type: 'demand.created', tenantId: dbCtx.tenantId, payload: { demandId: id } });
      if (ctx.ai.configured) {
        const b = await budgetStatus(tx, dbCtx.tenantId);
        const withinBudget = b.limitUsdMicros === null || b.spentUsdMicros < b.limitUsdMicros;
        if (b.enabled && b.autoPlanDemands && withinBudget) {
          await queueRun(tx, { tenantId: dbCtx.tenantId, agentKey: 'orchestrator', kind: 'plan', demandId: id, requestedBy: actor });
        }
      }
      await ctx.audit.recordIn(tx, { action: 'demand.create', result: 'success', tenantId: dbCtx.tenantId, actorUserId: actor, resourceType: 'demand', resourceId: id, ...requestMeta(req) });
      return findDemand(tx, id);
    });
    return reply.code(201).send(demand);
  });

  app.patch('/demands/:id', { config: { permission: 'work:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateDemandInput, req.body);
    return withContext(ctx.pool, access.context('work:manage', requestedTenant(req)), async (tx) => {
      const current = await findDemand(tx, id, true);
      if (!current) throw notFound();
      if (input.status && input.status !== current.status) {
        const allowed = DEMAND_MANUAL_TRANSITIONS[current.status as DemandStatus];
        if (!allowed.includes(input.status)) throw badRequest(`Não é possível mudar de "${current.status}" para "${input.status}"`);
      }
      const { sets, params } = buildUpdate(input, DEMAND_COLUMNS);
      await tx.query(`UPDATE demands SET ${sets.join(', ')} WHERE id = $1`, [id, ...params]).catch((err) => {
        if ((err as { code?: string }).code === '23503') throw badRequest('Projeto não encontrado neste cliente');
        throw err;
      });
      if (input.status && input.status !== current.status) {
        await recordActivity(tx, { tenantId: current.tenantId, actorUserId: access.principal.userId, type: 'demand.status_changed', data: { demandId: id, from: current.status, to: input.status } });
      }
      await ctx.audit.recordIn(tx, { action: 'demand.update', result: 'success', tenantId: current.tenantId, actorUserId: access.principal.userId, resourceType: 'demand', resourceId: id, ...requestMeta(req), metadata: { fields: Object.keys(input), status: input.status } });
      return findDemand(tx, id);
    });
  });

  app.put('/demands/:id/briefing', { config: { permission: 'work:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(briefingInput, req.body);
    return withContext(ctx.pool, access.context('work:manage', requestedTenant(req)), async (tx) => {
      const demand = await findDemand(tx, id, true);
      if (!demand) throw notFound();
      const { version } = (
        await tx.query<{ version: number }>(
          `INSERT INTO briefings (tenant_id, demand_id, version, objective, audience, key_messages, deliverables, tone, constraints, author_id)
           SELECT $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5, $6, $7, $8, $9 FROM briefings WHERE demand_id = $2
           RETURNING version`,
          [demand.tenantId, id, input.objective, input.audience, input.keyMessages, input.deliverables, input.tone, input.constraints, access.principal.userId],
        )
      ).rows[0]!;
      if (demand.status === 'submitted') await setDemandStatus(tx, id, 'planning');
      await recordActivity(tx, { tenantId: demand.tenantId, actorUserId: access.principal.userId, type: 'briefing.saved', data: { demandId: id, version } });
      return { version };
    });
  });

  // ------------------------------------------------------------------ entregáveis
  app.post('/demands/:id/deliverables', { config: { permission: 'work:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(createDeliverableInput, req.body);
    const deliverable = await withContext(ctx.pool, access.context('work:manage', requestedTenant(req)), async (tx) => {
      const demand = await findDemand(tx, id, true);
      if (!demand) throw notFound();
      if (['delivered', 'cancelled'].includes(demand.status)) throw badRequest('Demanda encerrada');
      await assertFile(tx, demand.tenantId, input.fileId);
      const { id: deliverableId } = (
        await tx.query<{ id: string }>(
          `INSERT INTO deliverables (tenant_id, demand_id, title, description, file_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [demand.tenantId, id, input.title, input.description, input.fileId ?? null, access.principal.userId],
        )
      ).rows[0]!;
      if (['submitted', 'planning'].includes(demand.status)) await setDemandStatus(tx, id, 'in_production');
      await recordActivity(tx, { tenantId: demand.tenantId, actorUserId: access.principal.userId, type: 'deliverable.created', data: { demandId: id, deliverableId, title: input.title } });
      return findDeliverable(tx, deliverableId);
    });
    return reply.code(201).send(deliverable);
  });

  /**
   * Fluxo interno do entregável:
   *   draft/changes_requested --submit_for_qa--> internal_review
   *   internal_review --qa_reject(motivo)--> draft          (QA → devolver ao produtor)
   *   changes_requested/approved --new_version--> draft (versão + 1)
   * O envio ao cliente só sai de internal_review (POST /request-approval).
   */
  app.patch('/deliverables/:id', { config: { permission: 'work:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateDeliverableInput, req.body);
    return withContext(ctx.pool, access.context('work:manage', requestedTenant(req)), async (tx) => {
      const current = await findDeliverable(tx, id, true);
      if (!current) throw notFound();
      const actor = access.principal.userId;
      if (input.fileId !== undefined) await assertFile(tx, current.tenantId, input.fileId);
      const { sets, params } = buildUpdate({ title: input.title, description: input.description, fileId: input.fileId }, { title: 'title', description: 'description', fileId: 'file_id' });

      let activity: string | null = null;
      let demandStatus: DemandStatus | null = null;
      if (input.action === 'submit_for_qa') {
        if (!['draft', 'changes_requested'].includes(current.status)) throw badRequest('Só rascunhos podem ir para o QA');
        if (!(input.fileId ?? current.fileId) && !(input.description ?? current.description)) throw badRequest('Anexe o arquivo ou descreva o entregável antes do QA');
        sets.push(`status = 'internal_review'`);
        activity = 'deliverable.submitted_for_qa';
        demandStatus = 'in_review';
      } else if (input.action === 'qa_reject') {
        if (current.status !== 'internal_review') throw badRequest('O entregável não está em revisão interna');
        params.push(input.qaNotes);
        sets.push(`status = 'draft'`, `qa_notes = $${params.length + 1}`);
        activity = 'deliverable.qa_rejected';
        demandStatus = 'in_production';
      } else if (input.action === 'new_version') {
        if (!['changes_requested', 'approved'].includes(current.status)) throw badRequest('Nova versão só após decisão do cliente');
        sets.push(`status = 'draft'`, `version = version + 1`, `qa_notes = NULL`);
        activity = 'deliverable.new_version';
        demandStatus = 'in_production';
      } else if (current.status !== 'draft' && current.status !== 'changes_requested') {
        throw badRequest('Edite o entregável criando uma nova versão');
      }
      if (sets.length) await tx.query(`UPDATE deliverables SET ${sets.join(', ')} WHERE id = $1`, [id, ...params]);
      if (demandStatus) await setDemandStatus(tx, current.demandId, demandStatus);
      if (activity) {
        await recordActivity(tx, { tenantId: current.tenantId, actorUserId: actor, type: activity, data: { demandId: current.demandId, deliverableId: id, notes: input.qaNotes ?? undefined } });
      }
      return findDeliverable(tx, id);
    });
  });

  /** QA aprovado → cria a aprovação pendente e libera o arquivo para o cliente. */
  app.post('/deliverables/:id/request-approval', { config: { permission: 'approvals:request' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(requestApprovalInput, req.body ?? {});
    const result = await withContext(ctx.pool, access.context('approvals:request', requestedTenant(req)), async (tx) => {
      const current = await findDeliverable(tx, id, true);
      if (!current) throw notFound();
      if (current.status !== 'internal_review') throw badRequest('O entregável precisa passar pelo QA (revisão interna) antes de ir ao cliente');
      const actor = access.principal.userId;
      const approval = (
        await tx
          .query<{ id: string }>(
            `INSERT INTO approvals (tenant_id, deliverable_id, version, message, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [current.tenantId, id, current.version, input.message, actor],
          )
          .catch((err) => {
            if ((err as { code?: string }).code === '23505') throw conflict('Já existe uma aprovação pendente');
            throw err;
          })
      ).rows[0]!;
      await tx.query(`UPDATE deliverables SET status = 'awaiting_client' WHERE id = $1`, [id]);
      if (current.fileId) await tx.query(`UPDATE files SET visibility = 'client' WHERE id = $1`, [current.fileId]);
      await setDemandStatus(tx, current.demandId, 'awaiting_approval');
      await recordActivity(tx, { tenantId: current.tenantId, actorUserId: actor, type: 'qa.approved', data: { demandId: current.demandId, deliverableId: id } });
      await recordActivity(tx, { tenantId: current.tenantId, actorUserId: actor, type: 'approval.requested', data: { demandId: current.demandId, deliverableId: id, approvalId: approval.id, title: current.title } });
      await enqueue(tx, { type: 'approval.requested', tenantId: current.tenantId, payload: { approvalId: approval.id } });
      await ctx.audit.recordIn(tx, { action: 'approval.request', result: 'success', tenantId: current.tenantId, actorUserId: actor, resourceType: 'approval', resourceId: approval.id, ...requestMeta(req) });
      return { id: approval.id, status: 'pending' };
    });
    return reply.code(201).send(result);
  });

  // ------------------------------------------------------------------ aprovações
  app.get('/approvals', { config: { permission: 'work:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(approvalsQuery, req.query);
    return withContext(ctx.pool, access.context('work:read', requestedTenant(req)), async (tx) => ({
      items: (
        await tx.query(
          `SELECT a.id, a.tenant_id AS "tenantId", t.name AS "clientName", a.status, a.message, a.reason, a.version,
                  a.created_at AS "createdAt", a.decided_at AS "decidedAt",
                  v.id AS "deliverableId", v.title AS "deliverableTitle", v.description AS "deliverableDescription",
                  v.file_id AS "fileId", f.name AS "fileName", f.mime AS "fileMime",
                  d.id AS "demandId", d.title AS "demandTitle", ru.name AS "requestedByName", du.name AS "decidedByName"
             FROM approvals a
             JOIN tenants t ON t.id = a.tenant_id
             JOIN deliverables v ON v.tenant_id = a.tenant_id AND v.id = a.deliverable_id
             JOIN demands d ON d.tenant_id = v.tenant_id AND d.id = v.demand_id
             LEFT JOIN files f ON f.tenant_id = v.tenant_id AND f.id = v.file_id
             LEFT JOIN users ru ON ru.id = a.requested_by
             LEFT JOIN users du ON du.id = a.decided_by
            ${q.status ? 'WHERE a.status = $1' : ''}
            ORDER BY (a.status <> 'pending'), a.created_at DESC
            LIMIT 200`,
          q.status ? [q.status] : [],
        )
      ).rows,
    }));
  });

  app.post('/approvals/:id/decide', { config: { permission: 'approvals:decide' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(decideApprovalInput, req.body);
    return withContext(ctx.pool, access.context('approvals:decide', requestedTenant(req)), async (tx) => {
      const approval = (
        await tx.query<{ id: string; tenant_id: string; status: string; deliverable_id: string; demand_id: string }>(
          `SELECT a.id, a.tenant_id, a.status, a.deliverable_id, v.demand_id
             FROM approvals a JOIN deliverables v ON v.tenant_id = a.tenant_id AND v.id = a.deliverable_id
            WHERE a.id = $1 FOR UPDATE OF a, v`,
          [id],
        )
      ).rows[0];
      if (!approval) throw notFound();
      if (approval.status !== 'pending') throw conflict('Esta aprovação já foi decidida');
      const actor = access.principal.userId;

      await tx.query(`UPDATE approvals SET status = $2, reason = $3, decided_by = $4, decided_at = now() WHERE id = $1`, [id, input.decision, input.reason, actor]);
      await tx.query(`UPDATE deliverables SET status = $2 WHERE id = $1`, [approval.deliverable_id, input.decision]);

      // ALTERAÇÃO → volta para produção na etapa certa; APROVADO → demanda aprovada quando tudo o que foi enviado estiver aprovado.
      if (input.decision === 'changes_requested') {
        await setDemandStatus(tx, approval.demand_id, 'changes_requested');
      } else {
        const pending = (
          await tx.query(`SELECT count(*)::int AS n FROM deliverables WHERE demand_id = $1 AND status <> 'approved'`, [approval.demand_id])
        ).rows[0].n as number;
        await setDemandStatus(tx, approval.demand_id, pending === 0 ? 'approved' : 'in_production');
      }
      await recordActivity(tx, {
        tenantId: approval.tenant_id,
        actorUserId: actor,
        type: input.decision === 'approved' ? 'approval.approved' : 'approval.changes_requested',
        data: { demandId: approval.demand_id, deliverableId: approval.deliverable_id, approvalId: id, reason: input.reason ?? undefined },
      });
      await enqueue(tx, { type: 'approval.decided', tenantId: approval.tenant_id, payload: { approvalId: id } });
      await ctx.audit.recordIn(tx, { action: 'approval.decide', result: 'success', tenantId: approval.tenant_id, actorUserId: actor, resourceType: 'approval', resourceId: id, ...requestMeta(req), metadata: { decision: input.decision } });
      return { id, status: input.decision };
    });
  });
}
