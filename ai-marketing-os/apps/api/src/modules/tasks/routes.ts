import type { FastifyInstance } from 'fastify';
import { createTaskInput, listTasksQuery, updateTaskInput, uuidParam } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, type Tx } from '../../db/pool';
import { badRequest, notFound, parse } from '../../lib/errors';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { assertAssignable, buildUpdate, dateOnly, singleTenantContext } from '../work/common';

// Tarefas são internas da equipe: o cliente não tem tasks:read.
const SELECT = `
  SELECT k.id, k.tenant_id AS "tenantId", t.name AS "clientName", k.project_id AS "projectId", k.demand_id AS "demandId",
         d.title AS "demandTitle", k.title, k.description, k.status, k.priority,
         k.assignee_id AS "assigneeId", u.name AS "assigneeName", ${dateOnly('k.due_date', 'dueDate')},
         (k.due_date < current_date AND k.status <> 'done') AS overdue,
         k.completed_at AS "completedAt", k.created_at AS "createdAt", k.updated_at AS "updatedAt"
    FROM tasks k
    JOIN tenants t ON t.id = k.tenant_id
    LEFT JOIN demands d ON d.tenant_id = k.tenant_id AND d.id = k.demand_id
    LEFT JOIN users u ON u.id = k.assignee_id`;

const COLUMNS = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee_id',
  dueDate: 'due_date',
  projectId: 'project_id',
  demandId: 'demand_id',
};

async function findTask(tx: Tx, id: string) {
  return (await tx.query(`${SELECT} WHERE k.id = $1`, [id])).rows[0];
}

/** Erros de FK composta = projeto/demanda inexistente ou de outro cliente. */
function mapFkError(err: unknown): never {
  if ((err as { code?: string }).code === '23503') throw badRequest('Projeto ou demanda não encontrado neste cliente');
  throw err;
}

export async function taskRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/tasks', { config: { permission: 'tasks:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(listTasksQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) where.push(`k.status = $${params.push(q.status)}`);
    if (q.mine === 'true') where.push(`k.assignee_id = $${params.push(access.principal.userId)}`);
    if (q.demandId) where.push(`k.demand_id = $${params.push(q.demandId)}`);
    if (q.projectId) where.push(`k.project_id = $${params.push(q.projectId)}`);
    if (q.overdue === 'true') where.push(`k.due_date < current_date AND k.status <> 'done'`);
    return withContext(ctx.pool, access.context('tasks:read', requestedTenant(req)), async (tx) => ({
      items: (
        await tx.query(
          `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY (k.status = 'done'), k.due_date NULLS LAST,
                    array_position(ARRAY['urgent','high','normal','low'], k.priority), k.created_at
           LIMIT 500`,
          params,
        )
      ).rows,
    }));
  });

  app.post('/tasks', { config: { permission: 'tasks:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createTaskInput, req.body);
    const dbCtx = singleTenantContext(access, 'tasks:write', req);
    const task = await withContext(ctx.pool, dbCtx, async (tx) => {
      if (input.assigneeId) await assertAssignable(tx, dbCtx.tenantId, input.assigneeId);
      const { id } = (
        await tx
          .query<{ id: string }>(
            `INSERT INTO tasks (tenant_id, project_id, demand_id, title, description, status, priority, assignee_id, due_date, created_by, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $6 = 'done' THEN now() END) RETURNING id`,
            [
              dbCtx.tenantId,
              input.projectId ?? null,
              input.demandId ?? null,
              input.title,
              input.description,
              input.status,
              input.priority,
              input.assigneeId ?? null,
              input.dueDate ?? null,
              access.principal.userId,
            ],
          )
          .catch(mapFkError)
      ).rows[0]!;
      await ctx.audit.recordIn(tx, { action: 'task.create', result: 'success', tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, resourceType: 'task', resourceId: id, ...requestMeta(req) });
      return findTask(tx, id);
    });
    return reply.code(201).send(task);
  });

  app.patch('/tasks/:id', { config: { permission: 'tasks:write' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateTaskInput, req.body);
    return withContext(ctx.pool, access.context('tasks:write', requestedTenant(req)), async (tx) => {
      const current = await findTask(tx, id);
      if (!current) throw notFound();
      if (input.assigneeId) await assertAssignable(tx, current.tenantId, input.assigneeId);
      const { sets, params } = buildUpdate(input, COLUMNS);
      if (input.status) {
        params.push(input.status);
        sets.push(`completed_at = CASE WHEN $${params.length + 1} = 'done' THEN coalesce(completed_at, now()) ELSE NULL END`);
      }
      await tx.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $1`, [id, ...params]).catch(mapFkError);
      return findTask(tx, id);
    });
  });
}
