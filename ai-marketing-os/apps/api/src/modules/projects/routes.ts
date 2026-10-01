import type { FastifyInstance } from 'fastify';
import { createProjectInput, updateProjectInput, uuidParam } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, type Tx } from '../../db/pool';
import { notFound, parse } from '../../lib/errors';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { buildUpdate, dateOnly, recordActivity, singleTenantContext } from '../work/common';

const SELECT = `
  SELECT p.id, p.tenant_id AS "tenantId", t.name AS "clientName", p.name, p.description, p.status,
         ${dateOnly('p.start_date', 'startDate')}, ${dateOnly('p.due_date', 'dueDate')},
         p.created_at AS "createdAt", p.updated_at AS "updatedAt",
         (SELECT count(*)::int FROM demands d WHERE d.project_id = p.id AND d.status NOT IN ('delivered', 'cancelled')) AS "openDemands",
         (SELECT count(*)::int FROM demands d WHERE d.project_id = p.id) AS "totalDemands"
    FROM projects p JOIN tenants t ON t.id = p.tenant_id`;

const COLUMNS = { name: 'name', description: 'description', status: 'status', startDate: 'start_date', dueDate: 'due_date' };

async function findProject(tx: Tx, id: string) {
  return (await tx.query(`${SELECT} WHERE p.id = $1`, [id])).rows[0];
}

export async function projectRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/projects', { config: { permission: 'work:read' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('work:read', requestedTenant(req)), async (tx) => ({
      items: (await tx.query(`${SELECT} ORDER BY (p.status IN ('done','cancelled')), p.due_date NULLS LAST, p.name LIMIT 300`)).rows,
    }));
  });

  app.get('/projects/:id', { config: { permission: 'work:read' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const project = await withContext(ctx.pool, access.context('work:read', requestedTenant(req)), (tx) => findProject(tx, id));
    if (!project) throw notFound();
    return project;
  });

  app.post('/projects', { config: { permission: 'work:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createProjectInput, req.body);
    const dbCtx = singleTenantContext(access, 'work:manage', req);
    const project = await withContext(ctx.pool, dbCtx, async (tx) => {
      const { id } = (
        await tx.query<{ id: string }>(
          `INSERT INTO projects (tenant_id, name, description, status, start_date, due_date, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [dbCtx.tenantId, input.name, input.description, input.status, input.startDate ?? null, input.dueDate ?? null, access.principal.userId],
        )
      ).rows[0]!;
      await recordActivity(tx, { tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, type: 'project.created', data: { projectId: id, name: input.name } });
      await ctx.audit.recordIn(tx, { action: 'project.create', result: 'success', tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, resourceType: 'project', resourceId: id, ...requestMeta(req) });
      return findProject(tx, id);
    });
    return reply.code(201).send(project);
  });

  app.patch('/projects/:id', { config: { permission: 'work:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateProjectInput, req.body);
    return withContext(ctx.pool, access.context('work:manage', requestedTenant(req)), async (tx) => {
      const current = await findProject(tx, id);
      if (!current) throw notFound();
      const { sets, params } = buildUpdate(input, COLUMNS);
      await tx.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $1`, [id, ...params]);
      await ctx.audit.recordIn(tx, { action: 'project.update', result: 'success', tenantId: current.tenantId, actorUserId: access.principal.userId, resourceType: 'project', resourceId: id, ...requestMeta(req), metadata: { fields: Object.keys(input) } });
      return findProject(tx, id);
    });
  });
}
