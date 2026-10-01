import { WORKFLOW_VARIABLES, type WorkflowTrigger } from '@aimos/shared';
import type { AppContext } from '../context';
import type { Tx } from '../db/pool';
import { requestToolCall, ToolPolicyError } from '../mcp/hub';

/** Troca {{variavel}} pelos valores do evento — só variáveis declaradas para o gatilho. */
export function renderParams(template: unknown, vars: Record<string, string>, allowed: string[]): unknown {
  if (typeof template === 'string') {
    return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (m, name: string) => (allowed.includes(name) && name in vars ? vars[name]! : m));
  }
  if (Array.isArray(template)) return template.map((v) => renderParams(v, vars, allowed));
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, renderParams(v, vars, allowed)]));
  }
  return template;
}

/**
 * Dispara as regras de workflow do cliente para um evento. Cada regra só
 * PEDE uma ferramenta ao MCP Hub — política, risco e aprovação humana
 * valem como para um agente. Idempotente: (regra, evento) roda uma vez,
 * mesmo com retry do worker. Roda na transação do handler do evento.
 */
export async function runWorkflows(tx: Tx, ctx: AppContext, tenantId: string, trigger: WorkflowTrigger, eventKey: string, vars: Record<string, string>) {
  // O handler roda em escopo system: restringe o RLS ao tenant do evento enquanto as regras rodam,
  // para que parâmetros de uma regra nunca alcancem dados de outro cliente.
  const prev = (await tx.query<{ scope: string; tenants: string }>(`SELECT current_setting('app.scope', true) AS scope, current_setting('app.tenant_ids', true) AS tenants`)).rows[0]!;
  await tx.query(`SELECT set_config('app.scope', 'tenant', true), set_config('app.tenant_ids', $1, true)`, [tenantId]);
  try {
    await runRules(tx, ctx, tenantId, trigger, eventKey, vars);
  } finally {
    await tx.query(`SELECT set_config('app.scope', $1, true), set_config('app.tenant_ids', $2, true)`, [prev.scope ?? 'system', prev.tenants ?? '']);
  }
}

async function runRules(tx: Tx, ctx: AppContext, tenantId: string, trigger: WorkflowTrigger, eventKey: string, vars: Record<string, string>) {
  const rules = (
    await tx.query<{ id: string; name: string; tool: string; params: unknown; conditions: { demandTypes?: string[] } }>(
      `SELECT id, name, tool, params, conditions FROM workflow_rules WHERE tenant_id = $1 AND trigger = $2 AND enabled ORDER BY created_at`,
      [tenantId, trigger],
    )
  ).rows;
  for (const [i, rule] of rules.entries()) {
    const types = rule.conditions?.demandTypes ?? [];
    if (types.length && vars.demandType && !types.includes(vars.demandType)) continue;
    const run = (
      await tx.query<{ id: string }>(
        `INSERT INTO workflow_runs (tenant_id, rule_id, trigger, event_key, status) VALUES ($1, $2, $3, $4, 'requested')
         ON CONFLICT (rule_id, event_key) DO NOTHING RETURNING id`,
        [tenantId, rule.id, trigger, eventKey],
      )
    ).rows[0];
    if (!run) continue; // já disparada para este evento
    await tx.query(`SAVEPOINT wf_${i}`);
    try {
      const call = await requestToolCall(tx, ctx, {
        tenantId,
        tool: rule.tool,
        params: renderParams(rule.params, vars, WORKFLOW_VARIABLES[trigger]),
        reason: `Workflow "${rule.name}"`,
        requester: { type: 'workflow', ruleId: rule.id },
      });
      await tx.query(`RELEASE SAVEPOINT wf_${i}`);
      await tx.query(`UPDATE workflow_runs SET tool_call_id = $2 WHERE id = $1`, [run.id, call.id]);
    } catch (err) {
      await tx.query(`ROLLBACK TO SAVEPOINT wf_${i}`);
      if (!(err instanceof ToolPolicyError)) throw err;
      await tx.query(`UPDATE workflow_runs SET status = 'rejected', error = $2 WHERE id = $1`, [run.id, err.message.slice(0, 500)]);
    }
  }
}
