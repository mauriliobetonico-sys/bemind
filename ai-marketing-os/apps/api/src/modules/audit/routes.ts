import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { withContext } from '../../db/pool';
import { parse } from '../../lib/errors';
import { requestedTenant, requireAccess } from '../../security/plugin';

const auditQuery = z.strictObject({
  action: z.string().trim().max(80).optional(),
  result: z.enum(['success', 'denied', 'failure']).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function auditRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/audit', { config: { permission: 'audit:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(auditQuery, req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.action) where.push(`a.action LIKE $${params.push(`${q.action.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)}`);
    if (q.result) where.push(`a.result = $${params.push(q.result)}`);
    if (q.before) where.push(`a.id < $${params.push(q.before)}`);
    params.push(q.limit);
    const rows = await withContext(ctx.pool, access.context('audit:read', requestedTenant(req)), async (tx) =>
      (
        await tx.query(
          `SELECT a.id::text, a.action, a.result, a.resource_type AS "resourceType", a.resource_id AS "resourceId",
                  a.tenant_id AS "tenantId", t.name AS "tenantName", a.actor_user_id AS "actorUserId",
                  u.email AS "actorEmail", host(a.ip) AS ip, a.metadata, a.created_at AS "createdAt"
             FROM audit_logs a
             LEFT JOIN tenants t ON t.id = a.tenant_id
             LEFT JOIN users u ON u.id = a.actor_user_id
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY a.id DESC
            LIMIT $${params.length}`,
          params,
        )
      ).rows,
    );
    return { items: rows };
  });
}
