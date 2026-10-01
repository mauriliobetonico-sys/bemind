import { z } from 'zod';
import { AGENT_LABELS, MEMORY_KINDS, PRODUCER_AGENT_KEYS, type AgentKey } from '@aimos/shared';
import type { AppContext } from '../context';
import { SYSTEM, withContext, type Tx } from '../db/pool';
import { enqueue } from '../outbox/outbox';
import { recordActivity } from '../modules/work/common';
import { AGENTS, fence, systemPrompt } from './agents';
import { clientContext, demandContext, memoryContext } from './context';
import { AiBlockedError, AiOutputError, tenantCtx } from './gateway';
import { ProviderRetryableError, type ProviderMessage } from './provider';
import { runChat } from './chat';
import { requestToolCall, toolsForAgent, ToolPolicyError } from '../mcp/hub';

/** Marcador que o agente usa para se referir ao entregável que acabou de produzir. */
export const THIS_DELIVERABLE = 'ESTE_ENTREGAVEL';

/** Ferramentas disponíveis para o agente neste cliente, descritas para o prompt. */
async function toolsPrompt(tx: Tx, tenantId: string, agentKey: AgentKey, withDeliverable: boolean): Promise<string> {
  const tools = await toolsForAgent(tx, tenantId, agentKey);
  if (!tools.length) return 'Ferramentas: nenhuma disponível para você neste cliente — deixe actionRequests vazio.';
  return [
    'Ferramentas que você pode PROPOR em actionRequests (o servidor aplica a política; risco médio/alto vai para aprovação humana):',
    ...tools.map((t) => `- ${t.name} (risco ${t.risk}): ${t.description} Parâmetros (JSON Schema): ${JSON.stringify(t.schema)}`),
    withDeliverable ? `Para se referir ao entregável que você está produzindo agora, use "deliverableId": "${THIS_DELIVERABLE}".` : '',
    'Só proponha uma ação quando ela for claramente útil para a demanda. Nunca invente IDs.',
  ].filter(Boolean).join('\n');
}

/** Encaminha as ações propostas ao MCP Hub (cada uma isolada num SAVEPOINT). */
async function submitActionRequests(
  tx: Tx,
  ctx: AppContext,
  run: { id: string; tenant_id: string; agent_key: AgentKey },
  requests: { tool: string; paramsJson: string; reason: string }[],
  deliverableId: string | null,
) {
  const results: { tool: string; status: string; error?: string; callId?: string }[] = [];
  for (const [i, a] of requests.slice(0, 3).entries()) {
    let params: unknown;
    try {
      params = JSON.parse(a.paramsJson.replaceAll(THIS_DELIVERABLE, deliverableId ?? THIS_DELIVERABLE));
    } catch {
      results.push({ tool: a.tool, status: 'rejected', error: 'parâmetros não são JSON válido' });
      continue;
    }
    await tx.query(`SAVEPOINT action_${i}`);
    try {
      const r = await requestToolCall(tx, ctx, { tenantId: run.tenant_id, tool: a.tool, params, reason: a.reason || 'Proposta do agente', requester: { type: 'agent', agentKey: run.agent_key, runId: run.id } });
      await tx.query(`RELEASE SAVEPOINT action_${i}`);
      results.push({ tool: a.tool, status: r.status, callId: r.id });
    } catch (err) {
      await tx.query(`ROLLBACK TO SAVEPOINT action_${i}`);
      if (!(err instanceof ToolPolicyError)) throw err;
      results.push({ tool: a.tool, status: 'rejected', error: err.message.slice(0, 300) });
    }
  }
  return results;
}

/** Quantas vezes o QA pode devolver um entregável ao agente antes de parar para um humano. */
export const MAX_REVISIONS = 2;

// ------------------------------------------------------------------ formatos de saída
const memoryProposals = z
  .array(z.object({ kind: z.enum(MEMORY_KINDS), content: z.string() }))
  .describe('Aprendizados sobre o cliente que valem guardar (no máximo 3). Serão revisados por um humano.');

export const planOutput = z.object({
  summary: z.string().describe('O que o cliente pediu, em 2-4 frases'),
  missingInfo: z.array(z.string()).describe('Informações que faltam e que um humano deveria obter'),
  steps: z
    .array(
      z.object({
        agent: z.enum(PRODUCER_AGENT_KEYS),
        title: z.string().describe('Nome curto do entregável deste passo'),
        instruction: z.string().describe('O que este agente deve produzir'),
      }),
    )
    .describe('De 1 a 6 passos, em ordem de execução'),
  qaFocus: z.array(z.string()).describe('Pontos que o QA deve verificar com atenção'),
});

const actionRequests = z
  .array(z.object({ tool: z.string(), paramsJson: z.string().describe('Parâmetros da ferramenta como JSON (objeto)'), reason: z.string() }))
  .describe('Ações propostas por meio das ferramentas disponíveis (no máximo 3). Passam pela política e, quando exigido, por aprovação humana. Deixe vazio se não houver.');

export const produceOutput = z.object({
  deliverableTitle: z.string(),
  content: z.string().describe('O entregável completo, em Markdown'),
  notes: z.string().describe('Observações para a equipe: premissas, pendências, alternativas'),
  memoryProposals,
  actionRequests,
});

export const qaOutput = z.object({
  approved: z.boolean(),
  score: z.number().describe('Nota de 0 a 100'),
  issues: z.array(
    z.object({
      severity: z.enum(['blocker', 'major', 'minor']),
      item: z.string().describe('Item do checklist: copy, marca, fatos, design, objetivo, briefing'),
      reason: z.string(),
    }),
  ),
  summary: z.string(),
});

export const replyOutput = z.object({ content: z.string(), memoryProposals, actionRequests });

export const summaryOutput = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  tasks: z.array(z.object({ title: z.string(), owner: z.string().describe('Pessoa ou agente sugerido'), dueDate: z.string().nullable().describe('AAAA-MM-DD ou null') })),
  strategyChanges: z.array(z.string()),
});

// ------------------------------------------------------------------ fila
interface NewRun {
  tenantId: string;
  agentKey: AgentKey;
  kind: 'plan' | 'produce' | 'qa' | 'reply' | 'summarize' | 'chat';
  demandId?: string | null;
  meetingId?: string | null;
  threadId?: string | null;
  parentRunId?: string | null;
  deliverableId?: string | null;
  stepIndex?: number | null;
  revision?: number;
  instruction?: string | null;
  requestedBy?: string | null;
  /** false = cria a execução sem enfileirar (passos futuros do plano). */
  start?: boolean;
}

/** Cria uma execução e (por padrão) a enfileira na MESMA transação (outbox). */
export async function queueRun(tx: Tx, r: NewRun): Promise<string> {
  const { id } = (
    await tx.query<{ id: string }>(
      `INSERT INTO agent_runs (tenant_id, agent_key, kind, demand_id, meeting_id, thread_id, parent_run_id, deliverable_id,
                               step_index, revision, instruction, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        r.tenantId, r.agentKey, r.kind, r.demandId ?? null, r.meetingId ?? null, r.threadId ?? null, r.parentRunId ?? null,
        r.deliverableId ?? null, r.stepIndex ?? null, r.revision ?? 0, r.instruction ?? null, r.requestedBy ?? null,
      ],
    )
  ).rows[0]!;
  if (r.start !== false) await enqueue(tx, { type: 'agent.run', tenantId: r.tenantId, payload: { runId: id } });
  return id;
}

async function startRun(tx: Tx, runId: string) {
  await tx.query(`UPDATE agent_runs SET status = 'queued', error = NULL WHERE id = $1`, [runId]);
  const t = (await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM agent_runs WHERE id = $1', [runId])).rows[0]!;
  await enqueue(tx, { type: 'agent.run', tenantId: t.tenant_id, payload: { runId } });
}

async function proposeMemories(tx: Tx, tenantId: string, runId: string, agentKey: string, items: { kind: string; content: string }[]) {
  for (const m of items.slice(0, 3)) {
    const content = m.content.trim().slice(0, 4000);
    if (content.length < 3) continue;
    await tx.query(
      `INSERT INTO agent_memories (tenant_id, kind, content, status, source_type, source_run_id, proposed_by_agent)
       VALUES ($1, $2, $3, 'proposed', 'run', $4, $5)`,
      [tenantId, m.kind, content, runId, agentKey],
    );
  }
}

// ------------------------------------------------------------------ execução
interface RunRow {
  id: string;
  tenant_id: string;
  agent_key: AgentKey;
  kind: NewRun['kind'];
  status: string;
  demand_id: string | null;
  meeting_id: string | null;
  thread_id: string | null;
  parent_run_id: string | null;
  deliverable_id: string | null;
  step_index: number | null;
  revision: number;
  instruction: string | null;
  requested_by: string | null;
}

/**
 * Executa uma execução reivindicada da fila. Reabre o contexto de RLS do
 * tenant do job; nada aqui roda em escopo global.
 *  - AiBlockedError (sem chave, IA desligada, orçamento): 'blocked', sem retry;
 *  - AiOutputError (recusa, saída inválida): 'failed', sem retry;
 *  - erro transitório do provedor: volta para a fila (backoff do outbox);
 *    na última tentativa, 'failed'.
 */
export async function executeRun(ctx: AppContext, tenantId: string, runId: string, opts: { lastAttempt: boolean }): Promise<void> {
  const run = await withContext(ctx.pool, tenantCtx(tenantId), async (tx) => {
    const r = (
      await tx.query<RunRow>(
        `UPDATE agent_runs SET status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now())
          WHERE id = $1 AND tenant_id = $2 AND status = 'queued' RETURNING *`,
        [runId, tenantId],
      )
    ).rows[0];
    return r ?? null;
  });
  if (!run) return; // cancelada, concluída ou de outro tenant: nada a fazer

  const finish = (status: 'failed' | 'blocked', error: string) =>
    withContext(ctx.pool, tenantCtx(tenantId), (tx) =>
      tx.query(`UPDATE agent_runs SET status = $2, error = $3, finished_at = now() WHERE id = $1`, [runId, status, error.slice(0, 2000)]),
    );

  try {
    switch (run.kind) {
      case 'plan':
        return await runPlan(ctx, run);
      case 'produce':
        return await runProduce(ctx, run);
      case 'qa':
        return await runQa(ctx, run);
      case 'reply':
        return await runReply(ctx, run);
      case 'summarize':
        return await runSummarize(ctx, run);
      case 'chat':
        return await runChat(ctx, run, (tx, out) => succeed(tx, run.id, out));
    }
  } catch (err) {
    if (err instanceof AiBlockedError) return void (await finish('blocked', `${err.reason}: ${err.message}`));
    if (err instanceof AiOutputError) return void (await finish('failed', err.message));
    if (err instanceof ProviderRetryableError && !opts.lastAttempt) {
      await withContext(ctx.pool, tenantCtx(tenantId), (tx) => tx.query(`UPDATE agent_runs SET status = 'queued', error = $2 WHERE id = $1`, [runId, err.message.slice(0, 2000)]));
      throw err; // outbox reagenda com backoff
    }
    await finish('failed', (err as Error).message ?? 'erro desconhecido');
  }
}

async function succeed(tx: Tx, runId: string, output: unknown) {
  await tx.query(`UPDATE agent_runs SET status = 'succeeded', output = $2, error = NULL, finished_at = now() WHERE id = $1`, [runId, JSON.stringify(output)]);
}

const meta = (run: RunRow, purpose: string, projectId?: string | null) => ({
  tenantId: run.tenant_id,
  agentKey: run.agent_key,
  purpose,
  runId: run.id,
  demandId: run.demand_id,
  projectId: projectId ?? null,
});

async function runPlan(ctx: AppContext, run: RunRow) {
  const agent = AGENTS.orchestrator;
  const prompt = await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => {
    const d = await demandContext(tx, run.demand_id!);
    return { d, client: await clientContext(tx, run.tenant_id), memory: await memoryContext(tx, run.tenant_id, agent.memoryScopes, d.title, ctx.ai.embedder) };
  });
  const team = PRODUCER_AGENT_KEYS.map((k) => `- ${k}: ${AGENTS[k].name} — ${AGENTS[k].objective}`).join('\n');
  const out = await ctx.ai.structured(
    meta(run, 'demand.plan', prompt.d.projectId),
    {
      system: systemPrompt(agent, 'montar o plano de execução desta demanda com a equipe disponível'),
      effort: agent.limits.effort,
      maxTokens: agent.limits.maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            prompt.client,
            prompt.memory,
            prompt.d.text,
            `Equipe disponível:\n${team}`,
            run.instruction ? `Orientação da equipe humana:\n${fence('mensagens', run.instruction)}` : '',
            'Monte o plano: de 1 a 6 passos, cada um com um agente da lista. Não inclua QA nos passos — o QA revisa cada entregável automaticamente.',
          ].filter(Boolean).join('\n\n'),
        },
      ],
    },
    planOutput,
  );
  const steps = out.steps.slice(0, 6);
  if (!steps.length) throw new AiOutputError('O plano veio sem passos.');

  await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => {
    await succeed(tx, run.id, { ...out, steps });
    for (const [i, s] of steps.entries()) {
      await queueRun(tx, {
        tenantId: run.tenant_id,
        agentKey: s.agent,
        kind: 'produce',
        demandId: run.demand_id,
        parentRunId: run.id,
        stepIndex: i,
        instruction: `${s.title}\n${s.instruction}`,
        requestedBy: run.requested_by,
        start: i === 0,
      });
    }
    await tx.query(`UPDATE demands SET status = 'in_production' WHERE id = $1 AND status IN ('submitted', 'planning')`, [run.demand_id]);
    await recordActivity(tx, {
      tenantId: run.tenant_id,
      actorUserId: null,
      type: 'ai.plan_created',
      data: { demandId: run.demand_id, runId: run.id, steps: steps.map((s) => AGENT_LABELS[s.agent]) },
    });
  });
}

async function runProduce(ctx: AppContext, run: RunRow) {
  const agent = AGENTS[run.agent_key];
  const prompt = await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => {
    const d = await demandContext(tx, run.demand_id!);
    const plan = (await tx.query<{ output: z.infer<typeof planOutput> | null }>('SELECT output FROM agent_runs WHERE id = $1', [run.parent_run_id])).rows[0]?.output;
    // Entregáveis já produzidos pelos passos anteriores (contexto para o próximo agente).
    const previous = (
      await tx.query<{ agent_key: AgentKey; title: string; description: string | null }>(
        `SELECT DISTINCT ON (r.step_index) r.agent_key, v.title, v.description
           FROM agent_runs r JOIN deliverables v ON v.tenant_id = r.tenant_id AND v.id = r.deliverable_id
          WHERE r.parent_run_id = $1 AND r.kind = 'produce' AND r.step_index < $2 AND r.status = 'succeeded'
          ORDER BY r.step_index, r.revision DESC`,
        [run.parent_run_id, run.step_index ?? 0],
      )
    ).rows;
    const current = run.deliverable_id
      ? (await tx.query<{ description: string | null }>('SELECT description FROM deliverables WHERE id = $1', [run.deliverable_id])).rows[0]
      : undefined;
    return {
      d,
      plan,
      previous,
      current,
      tools: run.revision === 0 ? await toolsPrompt(tx, run.tenant_id, run.agent_key, true) : 'Ferramentas: não proponha ações numa revisão — deixe actionRequests vazio.',
      client: await clientContext(tx, run.tenant_id),
      memory: await memoryContext(tx, run.tenant_id, agent.memoryScopes, `${d.title}\n${run.instruction ?? ''}`, ctx.ai.embedder),
    };
  });

  const out = await ctx.ai.structured(
    meta(run, run.revision ? 'demand.revise' : 'demand.produce', prompt.d.projectId),
    {
      system: systemPrompt(agent, run.revision ? 'revisar o entregável conforme o parecer do QA' : 'produzir o entregável deste passo do plano'),
      effort: agent.limits.effort,
      maxTokens: agent.limits.maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            prompt.client,
            prompt.memory,
            prompt.d.text,
            prompt.plan ? fence('plano', `Resumo: ${prompt.plan.summary}\nPontos de atenção do QA: ${prompt.plan.qaFocus.join('; ')}`) : '',
            ...prompt.previous.map((p) => fence('entregavel', `Passo anterior (${AGENT_LABELS[p.agent_key]}): ${p.title}\n${(p.description ?? '').slice(0, 12_000)}`)),
            prompt.current?.description ? fence('entregavel', `Versão atual a revisar:\n${prompt.current.description.slice(0, 20_000)}`) : '',
            prompt.tools,
            `Sua tarefa:\n${run.instruction ?? ''}`,
          ].filter(Boolean).join('\n\n'),
        },
      ],
    },
    produceOutput,
  );

  await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => {
    const title = out.deliverableTitle.trim().slice(0, 200).padEnd(2, '.');
    const body = `${out.content}${out.notes.trim() ? `\n\n---\nObservações do agente (${agent.name}): ${out.notes.trim()}` : ''}`.slice(0, 100_000);
    let deliverableId = run.deliverable_id;
    if (deliverableId) {
      // Revisão: só altera enquanto ninguém levou o entregável adiante.
      const upd = await tx.query(
        `UPDATE deliverables SET title = $2, description = $3, version = version + 1, agent_run_id = $4
          WHERE id = $1 AND status = 'draft'`,
        [deliverableId, title, body, run.id],
      );
      if (!upd.rowCount) throw new AiOutputError('O entregável já saiu do rascunho; revisão automática interrompida.');
    } else {
      deliverableId = (
        await tx.query<{ id: string }>(
          `INSERT INTO deliverables (tenant_id, demand_id, title, description, status, agent_run_id)
           VALUES ($1, $2, $3, $4, 'draft', $5) RETURNING id`,
          [run.tenant_id, run.demand_id, title, body, run.id],
        )
      ).rows[0]!.id;
    }
    await tx.query('UPDATE agent_runs SET deliverable_id = $2 WHERE id = $1', [run.id, deliverableId]);
    // Ações só na primeira versão (revisões não repetem pedidos).
    const actions = run.revision === 0 ? await submitActionRequests(tx, ctx, run, out.actionRequests, deliverableId) : [];
    await succeed(tx, run.id, { deliverableTitle: title, notes: out.notes, memoryProposals: out.memoryProposals.length, actions });
    await proposeMemories(tx, run.tenant_id, run.id, run.agent_key, out.memoryProposals);
    await recordActivity(tx, {
      tenantId: run.tenant_id,
      actorUserId: null,
      type: 'ai.deliverable_drafted',
      data: { demandId: run.demand_id, deliverableId, agent: AGENT_LABELS[run.agent_key], revision: run.revision },
    });
    await queueRun(tx, {
      tenantId: run.tenant_id,
      agentKey: 'qa',
      kind: 'qa',
      demandId: run.demand_id,
      parentRunId: run.id,
      deliverableId,
      stepIndex: run.step_index,
      revision: run.revision,
      requestedBy: run.requested_by,
    });
  });
}

async function runQa(ctx: AppContext, run: RunRow) {
  const agent = AGENTS.qa;
  const prompt = await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => {
    const d = await demandContext(tx, run.demand_id!);
    const v = (await tx.query<{ title: string; description: string | null }>('SELECT title, description FROM deliverables WHERE id = $1', [run.deliverable_id])).rows[0];
    if (!v) throw new AiOutputError('Entregável não encontrado para revisão.');
    const producer = (await tx.query<{ agent_key: AgentKey; instruction: string | null; parent_run_id: string | null }>('SELECT agent_key, instruction, parent_run_id FROM agent_runs WHERE id = $1', [run.parent_run_id])).rows[0]!;
    const plan = (await tx.query<{ output: z.infer<typeof planOutput> | null }>('SELECT output FROM agent_runs WHERE id = $1', [producer.parent_run_id])).rows[0]?.output;
    return { d, v, producer, plan, client: await clientContext(tx, run.tenant_id), memory: await memoryContext(tx, run.tenant_id, agent.memoryScopes, d.title, ctx.ai.embedder) };
  });

  const out = await ctx.ai.structured(
    meta(run, 'demand.qa', prompt.d.projectId),
    {
      system: systemPrompt(agent, 'revisar o entregável e decidir se está pronto para revisão humana'),
      effort: agent.limits.effort,
      maxTokens: agent.limits.maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            prompt.client,
            prompt.memory,
            prompt.d.text,
            prompt.plan ? fence('plano', `Pontos de atenção: ${prompt.plan.qaFocus.join('; ')}`) : '',
            `Tarefa dada ao agente ${AGENT_LABELS[prompt.producer.agent_key]}:\n${fence('mensagens', prompt.producer.instruction ?? '')}`,
            fence('entregavel', `${prompt.v.title}\n\n${(prompt.v.description ?? '').slice(0, 30_000)}`),
            'Checklist: copy (ortografia, clareza, CTA), marca (tom, cores/fontes citadas, regras aprovadas), fatos (nada inventado), design (especificações), objetivo (atende ao briefing). Reprove (approved=false) se houver qualquer problema blocker ou major.',
          ].filter(Boolean).join('\n\n'),
        },
      ],
    },
    qaOutput,
  );
  // Regra do sistema, não do modelo: problema grave nunca passa.
  const approved = out.approved && !out.issues.some((i) => i.severity !== 'minor');
  const review = { ...out, approved, score: Math.max(0, Math.min(100, Math.round(out.score))), revision: run.revision, at: new Date().toISOString() };

  await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => {
    await succeed(tx, run.id, review);
    // O QA da IA é parecer: grava no entregável, mas NÃO muda o status (quem envia ao cliente é um humano).
    await tx.query('UPDATE deliverables SET ai_review = $2 WHERE id = $1', [run.deliverable_id, JSON.stringify(review)]);
    await recordActivity(tx, {
      tenantId: run.tenant_id,
      actorUserId: null,
      type: approved ? 'ai.qa_passed' : 'ai.qa_failed',
      data: { demandId: run.demand_id, deliverableId: run.deliverable_id, score: review.score, revision: run.revision },
    });
    if (!approved && run.revision < MAX_REVISIONS) {
      const feedback = out.issues.map((i) => `- [${i.severity}] ${i.item}: ${i.reason}`).join('\n');
      await queueRun(tx, {
        tenantId: run.tenant_id,
        agentKey: prompt.producer.agent_key,
        kind: 'produce',
        demandId: run.demand_id,
        parentRunId: prompt.producer.parent_run_id,
        deliverableId: run.deliverable_id,
        stepIndex: run.step_index,
        revision: run.revision + 1,
        instruction: `${prompt.producer.instruction ?? ''}\n\nParecer do QA (corrija tudo):\n${feedback}\n${out.summary}`,
        requestedBy: run.requested_by,
      });
      return;
    }
    await advancePlan(tx, run, prompt.producer.parent_run_id);
  });
}

/** Próximo passo do plano (ou conclusão). */
async function advancePlan(tx: Tx, run: RunRow, planRunId: string | null) {
  if (!planRunId) return;
  const next = (
    await tx.query<{ id: string }>(
      `SELECT id FROM agent_runs WHERE parent_run_id = $1 AND kind = 'produce' AND status = 'queued' AND step_index > $2
         AND revision = 0 ORDER BY step_index LIMIT 1`,
      [planRunId, run.step_index ?? -1],
    )
  ).rows[0];
  if (next) return startRun(tx, next.id);
  await recordActivity(tx, { tenantId: run.tenant_id, actorUserId: null, type: 'ai.plan_completed', data: { demandId: run.demand_id, runId: planRunId } });
  await tx.query(`UPDATE demands SET status = 'in_review' WHERE id = $1 AND status = 'in_production'`, [run.demand_id]);
}

// ------------------------------------------------------------------ Agent Room
async function meetingTranscript(tx: Tx, meetingId: string) {
  const m = (await tx.query<{ title: string; agenda: string | null; status: string }>('SELECT title, agenda, status FROM agent_meetings WHERE id = $1', [meetingId])).rows[0];
  if (!m) throw new AiOutputError('Reunião não encontrada.');
  const msgs = (
    await tx.query<{ author_type: string; name: string | null; agent_key: AgentKey | null; content: string }>(
      `SELECT m.author_type, u.name, m.agent_key, m.content FROM agent_messages m LEFT JOIN users u ON u.id = m.author_user_id
        WHERE m.meeting_id = $1 ORDER BY m.created_at DESC LIMIT 40`,
      [meetingId],
    )
  ).rows.reverse();
  const transcript = msgs
    .map((x) => `${x.author_type === 'agent' ? `${AGENT_LABELS[x.agent_key!]} (agente)` : x.author_type === 'human' ? `${x.name ?? 'Equipe'} (humano)` : 'Sistema'}: ${x.content.slice(0, 6000)}`)
    .join('\n\n');
  return { m, transcript };
}

async function runReply(ctx: AppContext, run: RunRow) {
  const agent = AGENTS[run.agent_key];
  const p = await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => {
    const { m, transcript } = await meetingTranscript(tx, run.meeting_id!);
    return {
      m,
      transcript,
      tools: await toolsPrompt(tx, run.tenant_id, run.agent_key, false),
      client: await clientContext(tx, run.tenant_id),
      memory: await memoryContext(tx, run.tenant_id, agent.memoryScopes, `${m.title}\n${m.agenda ?? ''}`, ctx.ai.embedder),
    };
  });
  if (p.m.status !== 'open') return withContext(ctx.pool, tenantCtx(run.tenant_id), (tx) => succeed(tx, run.id, { skipped: 'reunião encerrada' }));
  const out = await ctx.ai.structured(
    meta(run, 'room.reply'),
    {
      system: systemPrompt(agent, 'contribuir na reunião do Agent Room com a sua especialidade, de forma objetiva'),
      effort: 'medium',
      maxTokens: 8_000,
      messages: [
        {
          role: 'user',
          content: [
            p.client,
            p.memory,
            fence('mensagens', `Reunião: ${p.m.title}\nPauta: ${p.m.agenda ?? '(sem pauta)'}\n\n${p.transcript}`),
            p.tools,
            'Responda à última mensagem da equipe humana como participante desta reunião. Seja direto (até ~250 palavras), concorde ou discorde dos outros agentes com argumentos.',
          ].join('\n\n'),
        },
      ],
    },
    replyOutput,
  );
  await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => {
    await tx.query(
      `INSERT INTO agent_messages (tenant_id, meeting_id, author_type, agent_key, run_id, content) VALUES ($1, $2, 'agent', $3, $4, $5)`,
      [run.tenant_id, run.meeting_id, run.agent_key, run.id, out.content.slice(0, 40_000) || '(sem resposta)'],
    );
    const actions = await submitActionRequests(tx, ctx, run, out.actionRequests, null);
    await succeed(tx, run.id, { memoryProposals: out.memoryProposals.length, actions });
    await proposeMemories(tx, run.tenant_id, run.id, run.agent_key, out.memoryProposals);
  });
}

async function runSummarize(ctx: AppContext, run: RunRow) {
  const agent = AGENTS.orchestrator;
  const p = await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => ({ ...(await meetingTranscript(tx, run.meeting_id!)), client: await clientContext(tx, run.tenant_id) }));
  const out = await ctx.ai.structured(
    meta(run, 'room.summary'),
    {
      system: systemPrompt(agent, 'redigir a ata da reunião: resumo, decisões, tarefas com responsável sugerido e prazo, mudanças de estratégia'),
      effort: 'medium',
      maxTokens: 8_000,
      messages: [{ role: 'user', content: [p.client, fence('mensagens', `Reunião: ${p.m.title}\nPauta: ${p.m.agenda ?? ''}\n\n${p.transcript}`), 'Registre apenas o que foi efetivamente discutido.'].join('\n\n') } satisfies ProviderMessage],
    },
    summaryOutput,
  );
  await withContext(ctx.pool, tenantCtx(run.tenant_id), async (tx) => {
    await tx.query(`UPDATE agent_meetings SET status = 'closed', outcome = $2, closed_at = now() WHERE id = $1`, [run.meeting_id, JSON.stringify(out)]);
    await tx.query(
      `INSERT INTO agent_messages (tenant_id, meeting_id, author_type, run_id, content, data) VALUES ($1, $2, 'system', $3, $4, $5)`,
      [run.tenant_id, run.meeting_id, run.id, `Reunião encerrada. ${out.summary}`.slice(0, 40_000), JSON.stringify(out)],
    );
    await succeed(tx, run.id, out);
    // Mudanças de estratégia viram memória PROPOSTA (um humano aprova).
    await proposeMemories(tx, run.tenant_id, run.id, 'orchestrator', out.strategyChanges.map((c) => ({ kind: 'strategic', content: c })));
  });
}

/** Marca execuções presas (worker caiu no meio) como falhas visíveis. */
export async function failStaleRuns(ctx: AppContext): Promise<number> {
  return withContext(ctx.pool, SYSTEM, async (tx) =>
    (
      await tx.query(
        `UPDATE agent_runs SET status = 'failed', error = 'tempo esgotado (execução interrompida)', finished_at = now()
          WHERE status = 'running' AND started_at < now() - interval '30 minutes'`,
      )
    ).rowCount ?? 0,
  );
}
