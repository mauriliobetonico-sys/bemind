import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateReportInput,
  listNotificationsQuery,
  NOTIFICATION_CATEGORIES,
  notificationPreferencesInput,
  reportSettingsInput,
  uuidParam,
  WORKFLOW_VARIABLES,
  workflowRuleInput,
  type WorkflowTrigger,
} from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, type DbContext } from '../../db/pool';
import { AppError, badRequest, notFound, parse } from '../../lib/errors';
import type { Access } from '../../security/access';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { enqueue } from '../../outbox/outbox';
import { connectorByKey, toolByName } from '../../mcp/catalog';
import { localNow } from '../../automation/daily-report';
import { singleTenantContext } from '../work/common';

/**
 * Contexto das notificações do PRÓPRIO usuário: tenants que ele alcança
 * (global ou associações ativas). O RLS ainda exige user_id = usuário da sessão.
 */
function ownContext(access: Access): DbContext {
  const userId = access.principal.userId;
  if (access.principal.globalRole) return { scope: 'global', userId };
  const tenantIds = access.principal.memberships.filter((m) => !['suspended', 'archived'].includes(m.tenantStatus)).map((m) => m.tenantId);
  if (!tenantIds.length) throw new AppError(403, 'forbidden', 'Acesso negado');
  return { scope: 'tenant', tenantIds, userId };
}

const readInput = z.strictObject({ ids: z.array(z.uuid()).max(200).optional(), all: z.boolean().optional() });

const REPORT_SELECT = `
  SELECT r.id, r.tenant_id AS "tenantId", t.name AS "clientName", to_char(r.report_date, 'YYYY-MM-DD') AS date, r.intro,
         r.generator, r.has_activity AS "hasActivity", r.emailed_to AS "emailedTo", r.emailed_at AS "emailedAt", r.created_at AS "createdAt"
    FROM daily_reports r JOIN tenants t ON t.id = r.tenant_id`;

const RULE_SELECT = `
  SELECT w.id, w.tenant_id AS "tenantId", t.name AS "clientName", w.name, w.trigger, w.conditions, w.tool, w.params, w.enabled,
         w.created_at AS "createdAt", w.updated_at AS "updatedAt",
         (SELECT count(*)::int FROM workflow_runs r WHERE r.rule_id = w.id) AS "runs",
         (SELECT max(r.created_at) FROM workflow_runs r WHERE r.rule_id = w.id) AS "lastRunAt"
    FROM workflow_rules w JOIN tenants t ON t.id = w.tenant_id`;

/** Regras só usam marcadores do gatilho escolhido e ferramentas existentes e disponíveis. */
function validateRule(input: z.infer<typeof workflowRuleInput>) {
  const tool = toolByName(input.tool);
  if (!tool) throw badRequest('Ferramenta desconhecida');
  const connector = connectorByKey(tool.connector);
  if (connector?.availability !== 'available') throw new AppError(409, 'integration_pending', `${connector?.name ?? tool.connector}: integration pending`);
  const allowed = WORKFLOW_VARIABLES[input.trigger as WorkflowTrigger];
  const used = [...JSON.stringify(input.params).matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)].map((m) => m[1]!);
  const bad = used.filter((v) => !allowed.includes(v));
  if (bad.length) throw badRequest(`Marcadores não disponíveis para este gatilho: ${[...new Set(bad)].join(', ')}`);
  if (JSON.stringify(input.params).length > 8_000) throw badRequest('Parâmetros grandes demais');
}

export async function automationRoutes(app: FastifyInstance, ctx: AppContext) {
  // ------------------------------------------------------------------ notificações (do próprio usuário)
  app.get('/notifications', { config: { auth: 'session' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(listNotificationsQuery, req.query);
    return withContext(ctx.pool, ownContext(access), async (tx) => ({
      items: (
        await tx.query(
          `SELECT n.id, n.tenant_id AS "tenantId", t.name AS "clientName", n.category, n.title, n.body, n.link, n.read_at AS "readAt", n.created_at AS "createdAt"
             FROM notifications n JOIN tenants t ON t.id = n.tenant_id
            WHERE n.user_id = $1 ${q.unread === 'true' ? 'AND n.read_at IS NULL' : ''}
            ORDER BY n.created_at DESC LIMIT $2`,
          [access.principal.userId, q.limit],
        )
      ).rows,
    }));
  });

  app.get('/notifications/unread-count', { config: { auth: 'session' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, ownContext(access), async (tx) => ({
      count: (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [access.principal.userId])).rows[0]!.n,
    }));
  });

  app.post('/notifications/read', { config: { auth: 'session' } }, async (req) => {
    const access = requireAccess(req);
    const input = parse(readInput, req.body);
    if (!input.all && !input.ids?.length) throw badRequest('Informe ids ou all');
    return withContext(ctx.pool, ownContext(access), async (tx) => {
      const r = input.all
        ? await tx.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [access.principal.userId])
        : await tx.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL`, [access.principal.userId, input.ids]);
      return { updated: r.rowCount };
    });
  });

  app.get('/notifications/preferences', { config: { auth: 'session' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, ownContext(access), async (tx) => {
      const rows = (await tx.query<{ category: string; email: boolean }>(`SELECT category, email FROM notification_preferences WHERE user_id = $1`, [access.principal.userId])).rows;
      return { email: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, rows.find((r) => r.category === c)?.email ?? true])) };
    });
  });

  app.put('/notifications/preferences', { config: { auth: 'session' } }, async (req) => {
    const access = requireAccess(req);
    const input = parse(notificationPreferencesInput, req.body);
    return withContext(ctx.pool, ownContext(access), async (tx) => {
      for (const [category, email] of Object.entries(input.email)) {
        await tx.query(
          `INSERT INTO notification_preferences (user_id, category, email) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, category) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`,
          [access.principal.userId, category, email],
        );
      }
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ relatório diário
  app.get('/reports', { config: { permission: 'reports:read' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('reports:read', requestedTenant(req)), async (tx) => ({
      items: (await tx.query(`${REPORT_SELECT} ORDER BY r.report_date DESC, t.name LIMIT 120`)).rows,
    }));
  });

  app.get('/reports/settings', { config: { permission: 'reports:manage' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('reports:manage', requestedTenant(req)), async (tx) => ({
      timezone: ctx.env.APP_TIMEZONE,
      hour: ctx.env.DAILY_REPORT_HOUR,
      today: localNow(ctx.env.APP_TIMEZONE).date,
      items: (
        await tx.query(
          `SELECT tenant_id AS "tenantId", trade_name AS "clientName", status, daily_report_enabled AS "dailyReportEnabled",
                  daily_report_weekdays_only AS "dailyReportWeekdaysOnly"
             FROM clients ORDER BY trade_name`,
        )
      ).rows,
    }));
  });

  app.put('/reports/settings/:id', { config: { permission: 'reports:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(reportSettingsInput, req.body);
    return withContext(ctx.pool, access.context('reports:manage', id), async (tx) => {
      const r = await tx.query(`UPDATE clients SET daily_report_enabled = $2, daily_report_weekdays_only = $3 WHERE tenant_id = $1`, [id, input.dailyReportEnabled, input.dailyReportWeekdaysOnly]);
      if (!r.rowCount) throw notFound();
      await ctx.audit.recordIn(tx, { action: 'report.settings_updated', result: 'success', tenantId: id, actorUserId: access.principal.userId, ...requestMeta(req), metadata: input });
      return { ok: true };
    });
  });

  app.get('/reports/:id', { config: { permission: 'reports:read' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('reports:read', requestedTenant(req)), async (tx) => {
      const r = (await tx.query(`${REPORT_SELECT.replace('r.created_at AS "createdAt"', 'r.created_at AS "createdAt", r.sections')} WHERE r.id = $1`, [id])).rows[0];
      if (!r) throw notFound();
      return r;
    });
  });

  /** Gera (ou regenera) o relatório de um cliente — na fila, não na requisição. */
  app.post('/reports/generate', { config: { permission: 'reports:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(generateReportInput, req.body ?? {});
    const dbCtx = singleTenantContext(access, 'reports:manage', req);
    const date = input.date ?? localNow(ctx.env.APP_TIMEZONE).date;
    await withContext(ctx.pool, dbCtx, async (tx) => {
      await enqueue(tx, { type: 'report.generate', tenantId: dbCtx.tenantId, payload: { date, force: true, send: input.send, createdBy: access.principal.userId } });
      await ctx.audit.recordIn(tx, { action: 'report.generate_requested', result: 'success', tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, ...requestMeta(req), metadata: { date, send: input.send } });
    });
    return reply.code(202).send({ date, status: 'queued' });
  });

  app.post('/reports/:id/send', { config: { permission: 'reports:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    await withContext(ctx.pool, access.context('reports:manage', requestedTenant(req)), async (tx) => {
      const r = (await tx.query<{ tenant_id: string }>(`SELECT tenant_id FROM daily_reports WHERE id = $1`, [id])).rows[0];
      if (!r) throw notFound();
      await enqueue(tx, { type: 'report.send', tenantId: r.tenant_id, payload: { reportId: id } });
      await ctx.audit.recordIn(tx, { action: 'report.send_requested', result: 'success', tenantId: r.tenant_id, actorUserId: access.principal.userId, resourceType: 'daily_report', resourceId: id, ...requestMeta(req) });
    });
    return reply.code(202).send({ status: 'queued' });
  });

  // ------------------------------------------------------------------ workflows
  app.get('/workflows', { config: { permission: 'workflows:manage' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('workflows:manage', requestedTenant(req)), async (tx) => ({
      items: (await tx.query(`${RULE_SELECT} ORDER BY t.name, w.created_at`)).rows,
    }));
  });

  app.post('/workflows', { config: { permission: 'workflows:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(workflowRuleInput, req.body);
    validateRule(input);
    const dbCtx = singleTenantContext(access, 'workflows:manage', req);
    const row = await withContext(ctx.pool, dbCtx, async (tx) => {
      const { id } = (
        await tx.query<{ id: string }>(
          `INSERT INTO workflow_rules (tenant_id, name, trigger, conditions, tool, params, enabled, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [dbCtx.tenantId, input.name, input.trigger, JSON.stringify({ demandTypes: input.demandTypes }), input.tool, JSON.stringify(input.params), input.enabled, access.principal.userId],
        )
      ).rows[0]!;
      await ctx.audit.recordIn(tx, { action: 'workflow.created', result: 'success', tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, resourceType: 'workflow_rule', resourceId: id, ...requestMeta(req), metadata: { trigger: input.trigger, tool: input.tool } });
      return (await tx.query(`${RULE_SELECT} WHERE w.id = $1`, [id])).rows[0];
    });
    return reply.code(201).send(row);
  });

  app.put('/workflows/:id', { config: { permission: 'workflows:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(workflowRuleInput, req.body);
    validateRule(input);
    return withContext(ctx.pool, access.context('workflows:manage', requestedTenant(req)), async (tx) => {
      const r = await tx.query<{ tenant_id: string }>(
        `UPDATE workflow_rules SET name = $2, trigger = $3, conditions = $4, tool = $5, params = $6, enabled = $7 WHERE id = $1 RETURNING tenant_id`,
        [id, input.name, input.trigger, JSON.stringify({ demandTypes: input.demandTypes }), input.tool, JSON.stringify(input.params), input.enabled],
      );
      if (!r.rowCount) throw notFound();
      await ctx.audit.recordIn(tx, { action: 'workflow.updated', result: 'success', tenantId: r.rows[0]!.tenant_id, actorUserId: access.principal.userId, resourceType: 'workflow_rule', resourceId: id, ...requestMeta(req), metadata: { trigger: input.trigger, tool: input.tool, enabled: input.enabled } });
      return (await tx.query(`${RULE_SELECT} WHERE w.id = $1`, [id])).rows[0];
    });
  });

  app.delete('/workflows/:id', { config: { permission: 'workflows:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    await withContext(ctx.pool, access.context('workflows:manage', requestedTenant(req)), async (tx) => {
      const r = await tx.query<{ tenant_id: string }>(`DELETE FROM workflow_rules WHERE id = $1 RETURNING tenant_id`, [id]);
      if (!r.rowCount) throw notFound();
      await ctx.audit.recordIn(tx, { action: 'workflow.deleted', result: 'success', tenantId: r.rows[0]!.tenant_id, actorUserId: access.principal.userId, resourceType: 'workflow_rule', resourceId: id, ...requestMeta(req) });
    });
    return reply.code(204).send();
  });

  app.get('/workflows/:id/runs', { config: { permission: 'workflows:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('workflows:manage', requestedTenant(req)), async (tx) => ({
      items: (
        await tx.query(
          `SELECT r.id, r.trigger, r.event_key AS "eventKey", r.status, r.error, r.created_at AS "createdAt", r.tool_call_id AS "toolCallId",
                  c.status AS "toolCallStatus"
             FROM workflow_runs r LEFT JOIN mcp_tool_calls c ON c.tenant_id = r.tenant_id AND c.id = r.tool_call_id
            WHERE r.rule_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
          [id],
        )
      ).rows,
    }));
  });
}
