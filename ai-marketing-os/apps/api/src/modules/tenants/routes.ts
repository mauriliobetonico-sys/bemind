import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uuidParam } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext } from '../../db/pool';
import { badRequest, notFound, parse } from '../../lib/errors';
import { requestMeta, requireAccess } from '../../security/plugin';

const updateTenantInput = z.strictObject({
  status: z.enum(['onboarding', 'active', 'suspended', 'archived']),
});

export async function tenantRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/tenants', { config: { permission: 'tenants:read' } }, async (req) => {
    const access = requireAccess(req);
    const rows = await withContext(ctx.pool, access.context('tenants:read'), async (tx) =>
      (
        await tx.query(
          `SELECT t.id, t.kind, t.name, t.slug, t.status, t.plan, t.created_at AS "createdAt",
                  c.id AS "clientId",
                  (SELECT count(*)::int FROM tenant_users tu WHERE tu.tenant_id = t.id) AS "userCount"
             FROM tenants t LEFT JOIN clients c ON c.tenant_id = t.id
            ORDER BY t.kind, t.name`,
        )
      ).rows,
    );
    return { items: rows };
  });

  /** Suspender/arquivar um tenant corta imediatamente o acesso de todas as associações. */
  app.patch('/tenants/:id', { config: { permission: 'tenants:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateTenantInput, req.body);
    return withContext(ctx.pool, access.context('tenants:manage'), async (tx) => {
      const tenant = (await tx.query<{ kind: string; status: string }>('SELECT kind, status FROM tenants WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!tenant) throw notFound();
      if (tenant.kind === 'agency' && input.status !== 'active') throw badRequest('O tenant da agência não pode ser desativado');
      await tx.query('UPDATE tenants SET status = $2 WHERE id = $1', [id, input.status]);
      await ctx.audit.recordIn(tx, {
        action: 'tenant.status_change',
        result: 'success',
        tenantId: id,
        actorUserId: access.principal.userId,
        resourceType: 'tenant',
        resourceId: id,
        ...requestMeta(req),
        metadata: { from: tenant.status, to: input.status },
      });
      return { id, status: input.status };
    });
  });
}
