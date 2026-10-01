import type { AgentKey } from '@aimos/shared';
import { z } from 'zod';
import type { AppContext } from '../context';
import { withContext, type Tx } from '../db/pool';
import { enqueue } from '../outbox/outbox';
import { recordActivity } from '../modules/work/common';
import type { Access } from '../security/access';
import { connectorByKey, TOOLS, toolByName } from './catalog';
import { IntegrationHttpError } from './http';
import type { ConnectionInfo, ToolDef } from './registry';

const tenantCtx = (tenantId: string) => ({ scope: 'tenant' as const, tenantIds: [tenantId] });

/** Falhas seguidas que abrem o circuito da conexão, e por quanto tempo. */
export const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_OPEN_MINUTES = 10;
const EXEC_TIMEOUT_MS = 60_000;

export class ToolPolicyError extends Error {
  constructor(
    readonly code: 'unknown_tool' | 'tool_disabled' | 'not_connected' | 'integration_pending' | 'agent_not_allowed' | 'forbidden' | 'invalid_params' | 'invalid_request',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Erro que manda a chamada de volta à fila (backoff do outbox). */
export class ToolRetryLater extends Error {}

export type Requester = { type: 'user'; access: Access } | { type: 'agent'; agentKey: AgentKey; runId: string | null };

interface PolicyRow {
  enabled: boolean;
  allow_self_approval: boolean;
}

export async function toolPolicy(tx: Tx, tool: string): Promise<PolicyRow> {
  const r = (await tx.query<PolicyRow>('SELECT enabled, allow_self_approval FROM mcp_tool_policies WHERE tool = $1', [tool])).rows[0];
  return r ?? { enabled: true, allow_self_approval: true };
}

/**
 * Regra de aprovação (não configurável para baixo):
 *  - HIGH: sempre exige decisão humana;
 *  - MEDIUM: exige quando quem pede é um agente;
 *  - LOW: executa direto (ações internas e reversíveis).
 */
export function needsApproval(risk: ToolDef['risk'], requester: Requester['type']): boolean {
  return risk === 'HIGH' || (risk === 'MEDIUM' && requester === 'agent');
}

async function activeConnection(tx: Tx, tenantId: string, connector: string) {
  return (
    await tx.query<{ id: string; status: string }>(`SELECT id, status FROM mcp_connections WHERE tenant_id = $1 AND connector = $2`, [tenantId, connector])
  ).rows[0];
}

/**
 * Pede uma chamada de ferramenta. Ordem: ferramenta existe e está ligada →
 * integração disponível e conectada neste cliente → quem pede pode usar
 * (permissão da pessoa ou agente permitido) → parâmetros válidos → regra de
 * negócio → risco decide se vai para a fila ou para aprovação humana.
 */
export async function requestToolCall(
  tx: Tx,
  app: AppContext,
  r: { tenantId: string; tool: string; params: unknown; reason: string; requester: Requester; meta?: { ip: string | null; userAgent: string | null } },
): Promise<{ id: string; status: 'pending_approval' | 'queued'; risk: string }> {
  const tool = toolByName(r.tool);
  if (!tool) throw new ToolPolicyError('unknown_tool', `Ferramenta desconhecida: ${r.tool}`);
  const policy = await toolPolicy(tx, tool.name);
  if (!policy.enabled) throw new ToolPolicyError('tool_disabled', 'Ferramenta desligada pela política da agência');
  const connector = connectorByKey(tool.connector)!;
  if (connector.availability !== 'available') throw new ToolPolicyError('integration_pending', `${connector.name}: integration pending`);
  let connectionId: string | null = null;
  if (!connector.builtIn) {
    const conn = await activeConnection(tx, r.tenantId, connector.key);
    if (!conn || conn.status === 'disabled') throw new ToolPolicyError('not_connected', `${connector.name} não está conectado para este cliente`);
    connectionId = conn.id;
  }
  if (r.requester.type === 'user') {
    if (!r.requester.access.can(tool.permission, r.tenantId) || !r.requester.access.can('mcp:use', r.tenantId)) {
      throw new ToolPolicyError('forbidden', 'Sem permissão para esta ferramenta neste cliente');
    }
  } else if (!tool.allowedAgents.includes(r.requester.agentKey)) {
    throw new ToolPolicyError('agent_not_allowed', `O agente ${r.requester.agentKey} não pode usar ${tool.name}`);
  }
  const parsed = tool.params.safeParse(r.params);
  if (!parsed.success) {
    throw new ToolPolicyError('invalid_params', 'Parâmetros inválidos', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  let deliverableId: string | null = null;
  if (tool.validate) {
    try {
      deliverableId = (await tool.validate(tx, r.tenantId, parsed.data as never))?.deliverableId ?? null;
    } catch (err) {
      throw new ToolPolicyError('invalid_request', (err as Error).message);
    }
  }

  const requiresApproval = needsApproval(tool.risk, r.requester.type);
  const status = requiresApproval ? 'pending_approval' : 'queued';
  const userId = r.requester.type === 'user' ? r.requester.access.principal.userId : null;
  const { id } = (
    await tx.query<{ id: string }>(
      `INSERT INTO mcp_tool_calls (tenant_id, connection_id, tool, connector, risk, status, requires_approval, params, reason,
                                   requested_by_user, requested_by_agent, run_id, deliverable_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        r.tenantId, connectionId, tool.name, tool.connector, tool.risk, status, requiresApproval, JSON.stringify(parsed.data), r.reason.slice(0, 1000),
        userId, r.requester.type === 'agent' ? r.requester.agentKey : null, r.requester.type === 'agent' ? r.requester.runId : null, deliverableId,
      ],
    )
  ).rows[0]!;
  if (requiresApproval) await enqueue(tx, { type: 'mcp.approval_requested', tenantId: r.tenantId, payload: { callId: id } });
  else await enqueue(tx, { type: 'mcp.call', tenantId: r.tenantId, payload: { callId: id } });
  await app.audit.recordIn(tx, {
    action: 'mcp.tool_requested',
    result: 'success',
    tenantId: r.tenantId,
    actorUserId: userId,
    resourceType: 'mcp_tool_call',
    resourceId: id,
    ...(r.meta ?? {}),
    metadata: { tool: tool.name, risk: tool.risk, requiresApproval, agent: r.requester.type === 'agent' ? r.requester.agentKey : undefined },
  });
  return { id, status, risk: tool.risk };
}

/** Decisão humana. Aprovar só coloca na fila — a execução externa nunca roda dentro da transação da decisão. */
export async function decideToolCall(
  tx: Tx,
  app: AppContext,
  access: Access,
  r: { id: string; decision: 'approve' | 'reject'; note?: string; meta: { ip: string | null; userAgent: string | null } },
): Promise<{ id: string; status: string }> {
  const c = (
    await tx.query<{ tenant_id: string; tool: string; status: string; requested_by_user: string | null }>(
      'SELECT tenant_id, tool, status, requested_by_user FROM mcp_tool_calls WHERE id = $1 FOR UPDATE',
      [r.id],
    )
  ).rows[0];
  if (!c) throw new ToolPolicyError('invalid_request', 'not_found');
  if (!access.can('mcp:approve', c.tenant_id)) throw new ToolPolicyError('forbidden', 'Sem permissão para aprovar neste cliente');
  if (c.status !== 'pending_approval') throw new ToolPolicyError('invalid_request', 'Esta chamada já foi decidida');
  const actor = access.principal.userId;
  const policy = await toolPolicy(tx, c.tool);
  if (c.requested_by_user === actor && !policy.allow_self_approval) throw new ToolPolicyError('forbidden', 'A política desta ferramenta exige outra pessoa para aprovar');
  const status = r.decision === 'approve' ? 'queued' : 'rejected';
  await tx.query(
    `UPDATE mcp_tool_calls SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4,
            finished_at = CASE WHEN $2 = 'rejected' THEN now() ELSE NULL END WHERE id = $1`,
    [r.id, status, actor, r.note ?? null],
  );
  if (status === 'queued') await enqueue(tx, { type: 'mcp.call', tenantId: c.tenant_id, payload: { callId: r.id } });
  await app.audit.recordIn(tx, {
    action: r.decision === 'approve' ? 'mcp.tool_approved' : 'mcp.tool_rejected',
    result: 'success',
    tenantId: c.tenant_id,
    actorUserId: actor,
    resourceType: 'mcp_tool_call',
    resourceId: r.id,
    ...r.meta,
    metadata: { tool: c.tool, selfApproved: c.requested_by_user === actor, note: r.note },
  });
  return { id: r.id, status };
}

interface CallRow {
  id: string;
  tenant_id: string;
  tool: string;
  connector: string;
  connection_id: string | null;
  params: unknown;
  requires_approval: boolean;
  decided_by: string | null;
}

/**
 * Executa uma chamada já autorizada (worker). Revalida tudo que pode ter
 * mudado desde o pedido: ferramenta ligada, conexão ativa, circuito, limite
 * por minuto. Segredos só são decifrados aqui, em memória.
 */
export async function executeToolCall(app: AppContext, tenantId: string, callId: string, opts: { lastAttempt: boolean }): Promise<void> {
  const call = await withContext(app.pool, tenantCtx(tenantId), async (tx) =>
    (
      await tx.query<CallRow>(
        `UPDATE mcp_tool_calls SET status = 'running', attempts = attempts + 1, started_at = now()
          WHERE id = $1 AND tenant_id = $2 AND status = 'queued' RETURNING id, tenant_id, tool, connector, connection_id, params, requires_approval, decided_by`,
        [callId, tenantId],
      )
    ).rows[0],
  );
  if (!call) return; // cancelada, rejeitada, já executada ou de outro tenant
  // Defesa extra (o CHECK do banco já impede): nada que exigia aprovação roda sem decisão.
  if (call.requires_approval && !call.decided_by) return finish(app, call, 'failed', { error: 'sem aprovação humana registrada' });

  const tool = toolByName(call.tool);
  const connector = connectorByKey(call.connector);
  try {
    if (!tool || !connector) throw new ToolPolicyError('unknown_tool', 'Ferramenta removida do catálogo');
    const prep = await withContext(app.pool, tenantCtx(tenantId), async (tx) => {
      const policy = await toolPolicy(tx, tool.name);
      if (!policy.enabled) throw new ToolPolicyError('tool_disabled', 'Ferramenta desligada pela política da agência');
      const recent = Number(
        (
          await tx.query<{ n: string }>(
            `SELECT count(*) AS n FROM mcp_tool_calls WHERE tenant_id = $1 AND tool = $2 AND id <> $3
                AND started_at > now() - interval '1 minute' AND status IN ('running', 'succeeded', 'failed')`,
            [tenantId, tool.name, callId],
          )
        ).rows[0]!.n,
      );
      if (recent >= tool.rateLimitPerMinute) throw new ToolRetryLater(`Limite de ${tool.rateLimitPerMinute} chamadas/min atingido`);
      if (connector.builtIn) return { connection: null as ConnectionInfo | null };
      const c = (
        await tx.query<{ id: string; status: string; config: Record<string, string>; secret_ciphertext: string | null; circuit_open: boolean }>(
          `SELECT id, status, config, secret_ciphertext, (circuit_open_until IS NOT NULL AND circuit_open_until > now()) AS circuit_open
             FROM mcp_connections WHERE tenant_id = $1 AND connector = $2`,
          [tenantId, connector.key],
        )
      ).rows[0];
      if (!c || c.status === 'disabled') throw new ToolPolicyError('not_connected', `${connector.name} foi desconectado`);
      if (c.circuit_open) throw new ToolRetryLater(`${connector.name}: muitas falhas seguidas, nova tentativa em alguns minutos`);
      const secrets = c.secret_ciphertext ? app.credentials.decrypt(c.secret_ciphertext, tenantId, c.id) : {};
      return { connection: { id: c.id, tenantId, config: c.config, secrets } };
    });

    const params = tool.params.parse(call.params);
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      tool.execute({ app, tenantId, callId, connection: prep.connection, withTenant: (fn) => withContext(app.pool, tenantCtx(tenantId), fn) }, params as never),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new IntegrationHttpError('Tempo esgotado na execução', undefined, true)), EXEC_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    await finish(app, call, 'succeeded', { result });
    if (prep.connection) await connectionHealth(app, tenantId, prep.connection.id, null);
  } catch (err) {
    const message = (err as Error).message?.slice(0, 1000) ?? 'erro desconhecido';
    const transient = err instanceof ToolRetryLater || (err instanceof IntegrationHttpError && err.retryable);
    if (err instanceof IntegrationHttpError && call.connection_id) await connectionHealth(app, tenantId, call.connection_id, message);
    if (transient && !opts.lastAttempt) {
      await withContext(app.pool, tenantCtx(tenantId), (tx) => tx.query(`UPDATE mcp_tool_calls SET status = 'queued', error = $2 WHERE id = $1`, [callId, message]));
      throw err; // outbox reagenda com backoff
    }
    await finish(app, call, 'failed', { error: message });
  }
}

async function finish(app: AppContext, call: CallRow, status: 'succeeded' | 'failed', r: { result?: unknown; error?: string }) {
  await withContext(app.pool, tenantCtx(call.tenant_id), async (tx) => {
    await tx.query(`UPDATE mcp_tool_calls SET status = $2, result = $3, error = $4, finished_at = now() WHERE id = $1`, [
      call.id, status, r.result ? JSON.stringify(r.result) : null, r.error ?? null,
    ]);
    await recordActivity(tx, {
      tenantId: call.tenant_id,
      actorUserId: null,
      type: status === 'succeeded' ? 'mcp.tool_succeeded' : 'mcp.tool_failed',
      data: { callId: call.id, tool: call.tool, summary: (r.result as { summary?: string } | undefined)?.summary, error: r.error },
    });
  });
  await app.audit.record({
    action: status === 'succeeded' ? 'mcp.tool_executed' : 'mcp.tool_failed',
    result: status === 'succeeded' ? 'success' : 'failure',
    tenantId: call.tenant_id,
    resourceType: 'mcp_tool_call',
    resourceId: call.id,
    metadata: { tool: call.tool, error: r.error },
  });
}

/** Saúde da conexão + circuit breaker: N falhas seguidas abrem o circuito por alguns minutos. */
async function connectionHealth(app: AppContext, tenantId: string, connectionId: string, error: string | null) {
  await withContext(app.pool, tenantCtx(tenantId), (tx) =>
    error === null
      ? tx.query(
          `UPDATE mcp_connections SET consecutive_failures = 0, circuit_open_until = NULL, last_error = NULL, last_used_at = now(), last_success_at = now(),
                  status = CASE WHEN status = 'error' THEN 'active' ELSE status END WHERE id = $1`,
          [connectionId],
        )
      : tx.query(
          `UPDATE mcp_connections SET consecutive_failures = consecutive_failures + 1, last_error = $2, last_used_at = now(),
                  circuit_open_until = CASE WHEN consecutive_failures + 1 >= $3 THEN now() + ($4 || ' minutes')::interval ELSE circuit_open_until END,
                  status = CASE WHEN consecutive_failures + 1 >= $3 AND status = 'active' THEN 'error' ELSE status END
            WHERE id = $1`,
          [connectionId, error, CIRCUIT_THRESHOLD, String(CIRCUIT_OPEN_MINUTES)],
        ),
  );
}

/** Ferramentas que um agente pode propor para um cliente agora (para o prompt). */
export async function toolsForAgent(tx: Tx, tenantId: string, agentKey: AgentKey) {
  const conns = new Map(
    (await tx.query<{ connector: string; status: string }>('SELECT connector, status FROM mcp_connections WHERE tenant_id = $1', [tenantId])).rows.map((c) => [c.connector, c.status]),
  );
  const disabled = new Set((await tx.query<{ tool: string }>('SELECT tool FROM mcp_tool_policies WHERE NOT enabled')).rows.map((r) => r.tool));
  return TOOLS.filter((t) => {
    const c = connectorByKey(t.connector)!;
    if (!t.allowedAgents.includes(agentKey) || disabled.has(t.name) || c.availability !== 'available') return false;
    return c.builtIn || (conns.has(c.key) && conns.get(c.key) !== 'disabled');
  }).map((t) => ({ name: t.name, title: t.title, description: t.description, risk: t.risk, schema: z.toJSONSchema(t.params) }));
}
