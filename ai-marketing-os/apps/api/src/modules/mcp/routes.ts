import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { connectionStatusInput, decideToolCallInput, listToolCallsQuery, requestToolCallInput, toolPolicyInput, upsertConnectionInput, uuidParam } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, type Tx } from '../../db/pool';
import { AppError, badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors';
import { requestMeta, requestedTenant, requireAccess } from '../../security/plugin';
import { CONNECTORS, TOOLS, connectorByKey } from '../../mcp/catalog';
import { decideToolCall, requestToolCall, toolPolicy, ToolPolicyError } from '../../mcp/hub';
import { assertSafeUrl, IntegrationHttpError } from '../../mcp/http';
import { singleTenantContext } from '../work/common';

const CONNECTION_SELECT = `
  SELECT c.id, c.tenant_id AS "tenantId", t.name AS "clientName", c.connector, c.status, c.label, c.config,
         (c.secret_ciphertext IS NOT NULL) AS "hasSecret", c.consecutive_failures AS "consecutiveFailures",
         c.circuit_open_until AS "circuitOpenUntil", c.last_error AS "lastError", c.last_used_at AS "lastUsedAt",
         c.last_success_at AS "lastSuccessAt", c.created_at AS "createdAt", c.updated_at AS "updatedAt"
    FROM mcp_connections c JOIN tenants t ON t.id = c.tenant_id`;

const CALL_SELECT = `
  SELECT c.id, c.tenant_id AS "tenantId", t.name AS "clientName", c.tool, c.connector, c.risk, c.status,
         c.requires_approval AS "requiresApproval", c.params, c.reason, c.requested_by_agent AS "requestedByAgent",
         c.requested_by_user AS "requestedByUser", ru.name AS "requestedByName", c.run_id AS "runId", r.demand_id AS "demandId",
         c.deliverable_id AS "deliverableId", du.name AS "decidedByName", c.decided_at AS "decidedAt", c.decision_note AS "decisionNote",
         c.result, c.error, c.attempts, c.created_at AS "createdAt", c.started_at AS "startedAt", c.finished_at AS "finishedAt",
         c.scheduled_for AS "scheduledFor", c.requested_by_workflow AS "requestedByWorkflow", wr.name AS "workflowName"
    FROM mcp_tool_calls c
    LEFT JOIN workflow_rules wr ON wr.tenant_id = c.tenant_id AND wr.id = c.requested_by_workflow
    JOIN tenants t ON t.id = c.tenant_id
    LEFT JOIN users ru ON ru.id = c.requested_by_user
    LEFT JOIN users du ON du.id = c.decided_by
    LEFT JOIN agent_runs r ON r.tenant_id = c.tenant_id AND r.id = c.run_id`;

/** Erros de política viram respostas HTTP claras. */
export function policyHttpError(err: unknown): never {
  if (err instanceof ToolPolicyError) {
    if (err.message === 'not_found') throw notFound();
    const status = err.code === 'forbidden' || err.code === 'agent_not_allowed' ? 403 : err.code === 'invalid_params' || err.code === 'invalid_request' || err.code === 'unknown_tool' ? 400 : 409;
    throw new AppError(status, err.code, err.message, err.details);
  }
  throw err;
}

async function clientExists(tx: Tx, tenantId: string) {
  return !!(await tx.query(`SELECT 1 FROM clients WHERE tenant_id = $1`, [tenantId])).rowCount;
}

export async function mcpRoutes(app: FastifyInstance, ctx: AppContext) {
  // ------------------------------------------------------------------ catálogo
  app.get('/mcp/catalog', { config: { permission: 'mcp:read' } }, async (req) => {
    const access = requireAccess(req);
    const policies = await withContext(ctx.pool, access.context('mcp:read'), async (tx) =>
      new Map((await tx.query<{ tool: string; enabled: boolean; allow_self_approval: boolean }>('SELECT * FROM mcp_tool_policies')).rows.map((r) => [r.tool, r])),
    );
    return {
      credentialsKey: ctx.credentials.configured ? 'configured' : 'missing',
      smtp: ctx.mailer.configured ? 'configured' : 'integration_pending',
      connectors: CONNECTORS.map((c) => ({
        key: c.key,
        name: c.name,
        description: c.description,
        availability: c.availability,
        requirements: c.requirements ?? null,
        builtIn: !!c.builtIn,
        testable: !!c.test,
        fields: c.fields,
        capabilities: c.capabilities ?? [],
      })),
      tools: TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        connector: t.connector,
        risk: t.risk,
        allowedAgents: t.allowedAgents,
        permission: t.permission,
        rateLimitPerMinute: t.rateLimitPerMinute,
        schedulable: !!t.schedulable,
        enabled: policies.get(t.name)?.enabled ?? true,
        allowSelfApproval: policies.get(t.name)?.allow_self_approval ?? true,
        approval: t.risk === 'HIGH' ? 'always' : t.risk === 'MEDIUM' ? 'when_agent' : 'never',
      })),
    };
  });

  // ------------------------------------------------------------------ conexões
  app.get('/mcp/connections', { config: { permission: 'mcp:read' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('mcp:read', requestedTenant(req)), async (tx) => ({
      items: (await tx.query(`${CONNECTION_SELECT} ORDER BY t.name, c.connector`)).rows,
    }));
  });

  app.put('/mcp/connections/:tenantId/:connector', { config: { permission: 'mcp:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { tenantId, connector: key } = parse(z.strictObject({ tenantId: z.uuid(), connector: z.string().regex(/^[a-z_]{2,40}$/) }), req.params);
    const input = parse(upsertConnectionInput, req.body);
    const connector = connectorByKey(key);
    if (!connector) throw notFound('Integração desconhecida');
    if (connector.availability !== 'available') throw new AppError(409, 'integration_pending', `${connector.name}: integration pending — ${connector.requirements ?? ''}`.trim());
    if (connector.builtIn) throw badRequest('Esta integração é interna e não precisa ser conectada');

    // Campos: só os declarados pelo conector; obrigatórios presentes; URLs seguras.
    const configFields = connector.fields.filter((f) => !f.secret);
    const secretFields = connector.fields.filter((f) => f.secret);
    const unknown = [...Object.keys(input.config).filter((k) => !configFields.some((f) => f.name === k)), ...Object.keys(input.secrets ?? {}).filter((k) => !secretFields.some((f) => f.name === k))];
    if (unknown.length) throw badRequest(`Campos desconhecidos: ${unknown.join(', ')}`);
    for (const f of configFields) {
      const v = input.config[f.name]?.trim();
      if (f.required && !v) throw badRequest(`Preencha: ${f.label}`);
      if (v && f.type === 'url') {
        try {
          assertSafeUrl(v, ctx.env.MCP_ALLOW_PRIVATE_HOSTS);
        } catch (err) {
          throw badRequest(`${f.label}: ${(err as Error).message}`);
        }
      }
    }
    const secrets = Object.fromEntries(Object.entries(input.secrets ?? {}).filter(([, v]) => v.trim() !== ''));
    if (Object.keys(secrets).length && !ctx.credentials.configured) {
      throw new AppError(409, 'credentials_key_missing', 'Defina CREDENTIALS_KEY no servidor para salvar credenciais com segurança.');
    }

    return withContext(ctx.pool, access.context('mcp:manage', tenantId), async (tx) => {
      if (!(await clientExists(tx, tenantId))) throw notFound();
      const existing = (await tx.query<{ id: string; secret_ciphertext: string | null }>('SELECT id, secret_ciphertext FROM mcp_connections WHERE tenant_id = $1 AND connector = $2 FOR UPDATE', [tenantId, key])).rows[0];
      const id = existing?.id ?? randomUUID();
      let ciphertext = existing?.secret_ciphertext ?? null;
      if (Object.keys(secrets).length) {
        const merged = { ...(ciphertext ? ctx.credentials.decrypt(ciphertext, tenantId, id) : {}), ...secrets };
        ciphertext = ctx.credentials.encrypt(merged, tenantId, id);
      }
      const missing = secretFields.filter((f) => f.required).filter((f) => !secrets[f.name] && !existing?.secret_ciphertext);
      if (missing.length) throw badRequest(`Preencha: ${missing.map((f) => f.label).join(', ')}`);
      const config = Object.fromEntries(configFields.map((f) => [f.name, input.config[f.name]?.trim() ?? '']).filter(([, v]) => v !== ''));
      if (existing) {
        await tx.query(
          `UPDATE mcp_connections SET config = $2, secret_ciphertext = $3, label = $4, status = 'active', consecutive_failures = 0,
                  circuit_open_until = NULL, last_error = NULL WHERE id = $1`,
          [id, JSON.stringify(config), ciphertext, input.label ?? null],
        );
      } else {
        await tx.query(
          `INSERT INTO mcp_connections (id, tenant_id, connector, config, secret_ciphertext, label, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, tenantId, key, JSON.stringify(config), ciphertext, input.label ?? null, access.principal.userId],
        );
      }
      // Auditoria sem valores secretos: só QUAIS campos mudaram.
      await ctx.audit.recordIn(tx, {
        action: existing ? 'mcp.connection_updated' : 'mcp.connection_created',
        result: 'success',
        tenantId,
        actorUserId: access.principal.userId,
        resourceType: 'mcp_connection',
        resourceId: id,
        ...requestMeta(req),
        metadata: { connector: key, configFields: Object.keys(config), credentialFieldsChanged: Object.keys(secrets) },
      });
      return (await tx.query(`${CONNECTION_SELECT} WHERE c.id = $1`, [id])).rows[0];
    });
  });

  app.patch('/mcp/connections/:id/status', { config: { permission: 'mcp:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const { status } = parse(connectionStatusInput, req.body);
    return withContext(ctx.pool, access.context('mcp:manage', requestedTenant(req)), async (tx) => {
      const r = await tx.query<{ tenant_id: string }>(
        `UPDATE mcp_connections SET status = $2, consecutive_failures = 0, circuit_open_until = NULL WHERE id = $1 RETURNING tenant_id`,
        [id, status],
      );
      if (!r.rowCount) throw notFound();
      await ctx.audit.recordIn(tx, { action: `mcp.connection_${status === 'active' ? 'enabled' : 'disabled'}`, result: 'success', tenantId: r.rows[0]!.tenant_id, actorUserId: access.principal.userId, resourceType: 'mcp_connection', resourceId: id, ...requestMeta(req) });
      return (await tx.query(`${CONNECTION_SELECT} WHERE c.id = $1`, [id])).rows[0];
    });
  });

  app.post('/mcp/connections/:id/test', { config: { permission: 'mcp:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const dbCtx = access.context('mcp:manage', requestedTenant(req));
    const c = await withContext(ctx.pool, dbCtx, async (tx) =>
      (await tx.query<{ id: string; tenant_id: string; connector: string; config: Record<string, string>; secret_ciphertext: string | null }>('SELECT id, tenant_id, connector, config, secret_ciphertext FROM mcp_connections WHERE id = $1', [id])).rows[0],
    );
    if (!c) throw notFound();
    const connector = connectorByKey(c.connector);
    if (!connector?.test) throw badRequest('Esta integração não tem teste sem efeito colateral');
    let ok = false;
    let message: string;
    try {
      const secrets = c.secret_ciphertext ? ctx.credentials.decrypt(c.secret_ciphertext, c.tenant_id, c.id) : {};
      message = await connector.test(ctx, { id: c.id, tenantId: c.tenant_id, config: c.config, secrets });
      ok = true;
    } catch (err) {
      message = err instanceof IntegrationHttpError ? err.message : `Falha: ${(err as Error).message.slice(0, 200)}`;
    }
    await withContext(ctx.pool, dbCtx, async (tx) => {
      await tx.query(
        ok
          ? `UPDATE mcp_connections SET last_error = NULL, last_success_at = now(), consecutive_failures = 0, circuit_open_until = NULL, status = CASE WHEN status = 'error' THEN 'active' ELSE status END WHERE id = $1`
          : `UPDATE mcp_connections SET last_error = $2 WHERE id = $1`,
        ok ? [id] : [id, message],
      );
      await ctx.audit.recordIn(tx, { action: 'mcp.connection_tested', result: ok ? 'success' : 'failure', tenantId: c.tenant_id, actorUserId: access.principal.userId, resourceType: 'mcp_connection', resourceId: id, ...requestMeta(req), metadata: { connector: c.connector } });
    });
    return { ok, message };
  });

  app.delete('/mcp/connections/:id', { config: { permission: 'mcp:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    await withContext(ctx.pool, access.context('mcp:manage', requestedTenant(req)), async (tx) => {
      const c = (await tx.query<{ tenant_id: string; connector: string }>('SELECT tenant_id, connector FROM mcp_connections WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound();
      // Chamadas que ainda não rodaram não podem mais usar esta conexão.
      await tx.query(`UPDATE mcp_tool_calls SET status = 'cancelled', error = 'Integração removida', finished_at = now() WHERE connection_id = $1 AND status IN ('pending_approval', 'queued')`, [id]);
      await tx.query('DELETE FROM mcp_connections WHERE id = $1', [id]);
      await ctx.audit.recordIn(tx, { action: 'mcp.connection_deleted', result: 'success', tenantId: c.tenant_id, actorUserId: access.principal.userId, resourceType: 'mcp_connection', resourceId: id, ...requestMeta(req), metadata: { connector: c.connector } });
    });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ chamadas de ferramenta
  app.get('/mcp/tool-calls', { config: { permission: 'mcp:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(listToolCallsQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) where.push(`c.status = $${params.push(q.status)}`);
    if (q.deliverableId) where.push(`c.deliverable_id = $${params.push(q.deliverableId)}`);
    if (q.connector) where.push(`c.connector = $${params.push(q.connector)}`);
    params.push(q.limit);
    return withContext(ctx.pool, access.context('mcp:read', requestedTenant(req)), async (tx) => ({
      items: (
        await tx.query(
          `${CALL_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY (c.status = 'pending_approval') DESC, c.created_at DESC LIMIT $${params.length}`,
          params,
        )
      ).rows,
    }));
  });

  app.post('/mcp/tool-calls', { config: { permission: 'mcp:use' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(requestToolCallInput, req.body);
    const dbCtx = singleTenantContext(access, 'mcp:use', req);
    const out = await withContext(ctx.pool, dbCtx, (tx) =>
      requestToolCall(tx, ctx, { tenantId: dbCtx.tenantId, tool: input.tool, params: input.params, reason: input.reason, scheduledFor: input.scheduledFor ?? null, requester: { type: 'user', access }, meta: requestMeta(req) }),
    ).catch(policyHttpError);
    return reply.code(202).send(out);
  });

  app.post('/mcp/tool-calls/:id/decide', { config: { permission: 'mcp:approve' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(decideToolCallInput, req.body);
    return withContext(ctx.pool, access.context('mcp:approve', requestedTenant(req)), (tx) =>
      decideToolCall(tx, ctx, access, { id, decision: input.decision, note: input.note, meta: requestMeta(req) }),
    ).catch(policyHttpError);
  });

  app.post('/mcp/tool-calls/:id/cancel', { config: { permission: 'mcp:use' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('mcp:use', requestedTenant(req)), async (tx) => {
      const c = (await tx.query<{ tenant_id: string; status: string; requested_by_user: string | null }>('SELECT tenant_id, status, requested_by_user FROM mcp_tool_calls WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound();
      if (c.requested_by_user !== access.principal.userId && !access.can('mcp:approve', c.tenant_id)) throw forbidden('Só quem pediu ou um aprovador pode cancelar');
      if (!['pending_approval', 'queued'].includes(c.status)) throw conflict('Esta chamada não pode mais ser cancelada');
      await tx.query(`UPDATE mcp_tool_calls SET status = 'cancelled', finished_at = now() WHERE id = $1`, [id]);
      await ctx.audit.recordIn(tx, { action: 'mcp.tool_cancelled', result: 'success', tenantId: c.tenant_id, actorUserId: access.principal.userId, resourceType: 'mcp_tool_call', resourceId: id, ...requestMeta(req) });
      return { id, status: 'cancelled' };
    });
  });

  // ------------------------------------------------------------------ políticas (globais)
  app.put('/mcp/policies/:tool', { config: { permission: 'mcp:manage' } }, async (req) => {
    const access = requireAccess(req);
    if (!access.hasGlobal('mcp:manage')) throw forbidden();
    const { tool } = parse(z.strictObject({ tool: z.string().regex(/^[a-z_]+\.[a-z_]+$/) }), req.params);
    const input = parse(toolPolicyInput, req.body);
    if (!TOOLS.some((t) => t.name === tool)) throw notFound();
    return withContext(ctx.pool, access.context('mcp:manage'), async (tx) => {
      const before = await toolPolicy(tx, tool);
      await tx.query(
        `INSERT INTO mcp_tool_policies (tool, enabled, allow_self_approval, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tool) DO UPDATE SET enabled = EXCLUDED.enabled, allow_self_approval = EXCLUDED.allow_self_approval, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [tool, input.enabled, input.allowSelfApproval, access.principal.userId],
      );
      await ctx.audit.recordIn(tx, { action: 'mcp.policy_changed', result: 'success', actorUserId: access.principal.userId, resourceType: 'mcp_tool_policy', resourceId: tool, ...requestMeta(req), metadata: { before, after: input } });
      return { tool, ...input };
    });
  });
}
