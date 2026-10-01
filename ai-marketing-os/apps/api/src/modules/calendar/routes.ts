import type { FastifyInstance } from 'fastify';
import { calendarQuery, createEventInput, uuidParam } from '@aimos/shared';
import type { AppContext } from '../../context';
import { enqueue } from '../../outbox/outbox';
import { withContext } from '../../db/pool';
import { badRequest, notFound, parse } from '../../lib/errors';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { singleTenantContext } from '../work/common';

/**
 * Calendário unificado: eventos cadastrados + prazos derivados (demandas,
 * tarefas internas e aprovações pendentes) — sem duplicar dados.
 * O cliente vê apenas eventos de visibilidade 'client' e nunca tarefas internas.
 */
export async function calendarRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/calendar', { config: { permission: 'work:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(calendarQuery, req.query);
    const dbCtx = access.context('work:read', requestedTenant(req));
    // Tenants em que o usuário é da equipe (vê itens internos).
    const staffAll = access.hasGlobal('work:manage');
    const staffTenants = staffAll ? [] : access.tenantIdsWith('work:manage');
    const canTasks = access.canAny('tasks:read');

    return withContext(ctx.pool, dbCtx, async (tx) => {
      const params = [q.from, q.to, staffAll, staffTenants];
      const isStaff = `($3 OR x.tenant_id = ANY($4::uuid[]))`;
      const rows = (
        await tx.query(
          `SELECT * FROM (
             SELECT 'event' AS source, e.id, e.tenant_id, e.kind, e.title, e.description, e.starts_at, e.ends_at, e.all_day,
                    e.visibility, e.demand_id
               FROM calendar_events e
              WHERE e.starts_at < ($2::date + 1) AND coalesce(e.ends_at, e.starts_at) >= $1::date
             UNION ALL
             SELECT 'demand', d.id, d.tenant_id, 'delivery', 'Prazo: ' || d.title, NULL, d.due_date::timestamptz, NULL, true,
                    'client', d.id
               FROM demands d
              WHERE d.due_date BETWEEN $1::date AND $2::date AND d.status NOT IN ('delivered', 'cancelled')
             UNION ALL
             SELECT 'approval', a.id, a.tenant_id, 'approval', 'Aprovação: ' || v.title, a.message, a.created_at, NULL, false,
                    'client', v.demand_id
               FROM approvals a JOIN deliverables v ON v.tenant_id = a.tenant_id AND v.id = a.deliverable_id
              WHERE a.status = 'pending' AND a.created_at::date BETWEEN $1::date AND $2::date
             ${
               canTasks
                 ? `UNION ALL
             SELECT 'task', k.id, k.tenant_id, 'task', k.title, NULL, k.due_date::timestamptz, NULL, true, 'internal', k.demand_id
               FROM tasks k
              WHERE k.due_date BETWEEN $1::date AND $2::date AND k.status <> 'done'`
                 : ''
             }
           ) x
           WHERE x.visibility = 'client' OR ${isStaff}
           ORDER BY x.starts_at`,
          params,
        )
      ).rows;
      const names = new Map(
        (await tx.query<{ id: string; name: string }>(`SELECT id, name FROM tenants`)).rows.map((t) => [t.id, t.name]),
      );
      return {
        items: rows.map((r) => ({
          source: r.source,
          id: r.id,
          tenantId: r.tenant_id,
          clientName: names.get(r.tenant_id) ?? null,
          kind: r.kind,
          title: r.title,
          description: r.description,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          allDay: r.all_day,
          visibility: r.visibility,
          demandId: r.demand_id,
        })),
      };
    });
  });

  app.post('/calendar/events', { config: { permission: 'work:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createEventInput, req.body);
    const dbCtx = singleTenantContext(access, 'work:manage', req);
    const event = await withContext(ctx.pool, dbCtx, async (tx) => {
      const row = (
        await tx
          .query(
            `INSERT INTO calendar_events (tenant_id, kind, title, description, starts_at, ends_at, all_day, visibility, demand_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [dbCtx.tenantId, input.kind, input.title, input.description, input.startsAt, input.endsAt ?? null, input.allDay, input.visibility, input.demandId ?? null, access.principal.userId],
          )
          .catch((err) => {
            if ((err as { code?: string }).code === '23503') throw badRequest('Demanda não encontrada neste cliente');
            throw err;
          })
      ).rows[0];
      await ctx.audit.recordIn(tx, { action: 'calendar.create', result: 'success', tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, resourceType: 'calendar_event', resourceId: row.id, ...requestMeta(req) });
      if (input.kind === 'meeting') await enqueue(tx, { type: 'calendar.event_created', tenantId: dbCtx.tenantId, payload: { eventId: row.id } });
      return row;
    });
    return reply.code(201).send(event);
  });

  app.delete('/calendar/events/:id', { config: { permission: 'work:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    await withContext(ctx.pool, access.context('work:manage', requestedTenant(req)), async (tx) => {
      const r = await tx.query('DELETE FROM calendar_events WHERE id = $1 RETURNING tenant_id', [id]);
      if (r.rowCount === 0) throw notFound();
      await ctx.audit.recordIn(tx, { action: 'calendar.delete', result: 'success', tenantId: r.rows[0].tenant_id, actorUserId: access.principal.userId, resourceType: 'calendar_event', resourceId: id, ...requestMeta(req) });
    });
    return reply.code(204).send();
  });
}
