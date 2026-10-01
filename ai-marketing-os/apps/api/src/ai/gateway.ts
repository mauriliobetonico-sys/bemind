import type pg from 'pg';
import type { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Env } from '../config/env';
import { withContext, type Tx } from '../db/pool';
import { costMicros } from './pricing';
import type { AiProvider, ProviderMessage, ProviderRequest, ProviderResponse, ToolResultBlock, ToolSpec } from './provider';
import type { Embedder } from './embeddings';

/** Falhas que não adianta repetir: a execução fica 'blocked' ou 'failed' com o motivo. */
export class AiBlockedError extends Error {
  constructor(
    readonly reason: 'integration_pending' | 'disabled' | 'budget_exceeded',
    message: string,
  ) {
    super(message);
  }
}
export class AiOutputError extends Error {}

export interface CallMeta {
  tenantId: string;
  agentKey: string;
  purpose: string;
  runId?: string | null;
  demandId?: string | null;
  projectId?: string | null;
}

export interface CallOptions {
  system: string;
  messages: ProviderMessage[];
  effort: ProviderRequest['effort'];
  maxTokens: number;
}

export interface GatewayTool {
  spec: ToolSpec;
  run(input: unknown): Promise<string>;
}

export interface BudgetStatus {
  enabled: boolean;
  limitUsdMicros: number | null;
  spentUsdMicros: number;
  autoPlanDemands: boolean;
}

/** Contexto de RLS restrito a um único tenant (o do job). */
export const tenantCtx = (tenantId: string) => ({ scope: 'tenant' as const, tenantIds: [tenantId] });

export async function budgetStatus(tx: Tx, tenantId: string): Promise<BudgetStatus> {
  const r = (
    await tx.query<{ enabled: boolean | null; limit: string | null; auto: boolean | null; spent: string }>(
      `SELECT s.enabled, s.monthly_budget_usd_micros AS limit, s.auto_plan_demands AS auto,
              (SELECT coalesce(sum(cost_usd_micros), 0) FROM ai_usage
                WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())) AS spent
         FROM (SELECT $1::uuid AS tenant_id) t LEFT JOIN ai_settings s ON s.tenant_id = t.tenant_id`,
      [tenantId],
    )
  ).rows[0]!;
  return {
    enabled: r.enabled ?? true,
    limitUsdMicros: r.limit === null ? null : Number(r.limit),
    spentUsdMicros: Number(r.spent),
    autoPlanDemands: r.auto ?? false,
  };
}

/**
 * AI Gateway: único caminho até o modelo. Verifica integração, chave
 * liga/desliga e orçamento do cliente ANTES de chamar; mede tokens e custo
 * de toda tentativa em ai_usage (inclusive quando a saída é inválida);
 * trata stop_reason (recusa, truncamento) como erro explícito.
 */
export class AiGateway {
  constructor(
    private readonly pool: pg.Pool,
    private readonly provider: AiProvider,
    private readonly env: Env,
    readonly embedder: Embedder,
  ) {}

  get configured(): boolean {
    return this.provider.configured;
  }

  get model(): string {
    return this.env.AI_MODEL;
  }

  status() {
    return {
      provider: this.provider.name,
      llm: this.provider.configured ? 'configured' : 'integration_pending',
      model: this.env.AI_MODEL,
      serverFallback: this.env.AI_SERVER_FALLBACK,
      embeddings: this.embedder.configured ? 'configured' : 'integration_pending',
    } as const;
  }

  private async preflight(tenantId: string) {
    if (!this.provider.configured) throw new AiBlockedError('integration_pending', 'IA não configurada (ANTHROPIC_API_KEY ausente)');
    const b = await withContext(this.pool, tenantCtx(tenantId), (tx) => budgetStatus(tx, tenantId));
    if (!b.enabled) throw new AiBlockedError('disabled', 'IA desativada para este cliente');
    if (b.limitUsdMicros !== null && b.spentUsdMicros >= b.limitUsdMicros) {
      throw new AiBlockedError('budget_exceeded', 'Orçamento mensal de IA deste cliente atingido');
    }
  }

  private async meter(meta: CallMeta, res: ProviderResponse) {
    await withContext(this.pool, tenantCtx(meta.tenantId), async (tx) => {
      let total = 0;
      let inTok = 0;
      let outTok = 0;
      for (const u of res.usage) {
        const cost = costMicros(u);
        total += cost;
        inTok += u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
        outTok += u.outputTokens;
        await tx.query(
          `INSERT INTO ai_usage (tenant_id, run_id, agent_key, provider, model, purpose, demand_id, project_id,
                                 input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd_micros, stop_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            meta.tenantId, meta.runId ?? null, meta.agentKey, this.provider.name, u.model, meta.purpose,
            meta.demandId ?? null, meta.projectId ?? null, u.inputTokens, u.outputTokens, u.cacheReadTokens,
            u.cacheWriteTokens, cost, res.stopReason,
          ],
        );
      }
      if (meta.runId) {
        await tx.query(
          `UPDATE agent_runs SET model = $2, input_tokens = input_tokens + $3, output_tokens = output_tokens + $4,
                  cost_usd_micros = cost_usd_micros + $5 WHERE id = $1`,
          [meta.runId, res.model, inTok, outTok, total],
        );
      }
    });
  }

  private async call(meta: CallMeta, req: Omit<ProviderRequest, 'model' | 'timeoutMs'>): Promise<ProviderResponse> {
    await this.preflight(meta.tenantId);
    const res = await this.provider.create({ ...req, model: this.env.AI_MODEL, timeoutMs: this.env.AI_TIMEOUT_MS });
    await this.meter(meta, res);
    if (res.stopReason === 'refusal') throw new AiOutputError('O modelo recusou a solicitação (política de uso).');
    if (res.stopReason === 'max_tokens') throw new AiOutputError('Resposta cortada pelo limite de tokens.');
    return res;
  }

  /** Chamada com saída estruturada validada por Zod. */
  async structured<S extends z.ZodType>(meta: CallMeta, opts: CallOptions, schema: S): Promise<z.infer<S>> {
    const format = zodOutputFormat(schema);
    const res = await this.call(meta, { ...opts, jsonSchema: format.schema });
    const text = res.blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    try {
      return format.parse(text) as z.infer<S>;
    } catch (err) {
      throw new AiOutputError(`Saída fora do formato esperado: ${(err as Error).message.slice(0, 300)}`);
    }
  }

  /**
   * Loop de ferramentas (Chat Global). As ferramentas são funções do
   * servidor, já presas ao contexto/permissões de quem perguntou.
   */
  async toolLoop(meta: CallMeta, opts: CallOptions, tools: GatewayTool[], maxSteps = 8): Promise<{ text: string; toolCalls: { name: string; input: unknown }[] }> {
    const messages = [...opts.messages];
    const byName = new Map(tools.map((t) => [t.spec.name, t]));
    const toolCalls: { name: string; input: unknown }[] = [];
    for (let step = 0; step < maxSteps; step++) {
      const res = await this.call(meta, { ...opts, messages, tools: tools.map((t) => t.spec) });
      const uses = res.blocks.filter((b) => b.type === 'tool_use');
      if (res.stopReason !== 'tool_use' || uses.length === 0) {
        if (res.stopReason === 'pause_turn') {
          messages.push({ role: 'assistant', content: res.assistantContent });
          continue;
        }
        return { text: res.blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim(), toolCalls };
      }
      messages.push({ role: 'assistant', content: res.assistantContent });
      const results: ToolResultBlock[] = [];
      for (const u of uses) {
        if (u.type !== 'tool_use') continue;
        toolCalls.push({ name: u.name, input: u.input });
        const tool = byName.get(u.name);
        if (!tool) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: `Ferramenta desconhecida: ${u.name}`, is_error: true });
          continue;
        }
        try {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: (await tool.run(u.input)).slice(0, 30_000) });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: `Erro: ${(err as Error).message.slice(0, 500)}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    throw new AiOutputError('Limite de passos de ferramenta atingido sem resposta final.');
  }
}
