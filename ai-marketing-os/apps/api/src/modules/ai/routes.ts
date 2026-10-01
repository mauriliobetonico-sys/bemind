import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  aiSettingsInput,
  chatMessageInput,
  createMeetingInput,
  createMemoryInput,
  decideMemoryInput,
  listMemoryQuery,
  listRunsQuery,
  meetingMessageInput,
  meetingTaskToCreateInput,
  planDemandInput,
  usdBrlRateInput,
  uuidParam,
} from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, SYSTEM, type Tx } from '../../db/pool';
import { AppError, badRequest, conflict, notFound, parse } from '../../lib/errors';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { enqueue } from '../../outbox/outbox';
import { listAgents } from '../../ai/agents';
import { budgetStatus } from '../../ai/gateway';
import { queueRun } from '../../ai/runs';
import { monthRange } from '../finance/profitability';
import { recordActivity, singleTenantContext } from '../work/common';

const integrationPending = () => new AppError(409, 'integration_pending', 'IA não configurada: defina ANTHROPIC_API_KEY no servidor.');

const RUN_SELECT = `
  SELECT r.id, r.tenant_id AS "tenantId", t.name AS "clientName", r.agent_key AS "agentKey", r.kind, r.status,
         r.demand_id AS "demandId", r.meeting_id AS "meetingId", r.parent_run_id AS "parentRunId",
         r.deliverable_id AS "deliverableId", r.step_index AS "stepIndex", r.revision, r.instruction, r.output, r.error,
         r.model, r.input_tokens AS "inputTokens", r.output_tokens AS "outputTokens", r.cost_usd_micros::float8 AS "costUsdMicros",
         r.attempts, r.created_at AS "createdAt", r.started_at AS "startedAt", r.finished_at AS "finishedAt"
    FROM agent_runs r JOIN tenants t ON t.id = r.tenant_id`;

const MEMORY_SELECT = `
  SELECT m.id, m.tenant_id AS "tenantId", t.name AS "clientName", m.kind, m.content, m.status, m.source_type AS "sourceType",
         m.source_run_id AS "sourceRunId", r.demand_id AS "sourceDemandId", r.meeting_id AS "sourceMeetingId",
         m.proposed_by_agent AS "proposedByAgent", pu.name AS "proposedByName", du.name AS "decidedByName",
         m.decided_at AS "decidedAt", m.decision_note AS "decisionNote", (m.embedding IS NOT NULL) AS "hasEmbedding",
         m.created_at AS "createdAt", m.updated_at AS "updatedAt"
    FROM agent_memories m
    JOIN tenants t ON t.id = m.tenant_id
    LEFT JOIN agent_runs r ON r.tenant_id = m.tenant_id AND r.id = m.source_run_id
    LEFT JOIN users pu ON pu.id = m.proposed_by_user
    LEFT JOIN users du ON du.id = m.decided_by`;

async function agencyTenantId(tx: Tx): Promise<string> {
  const r = (await tx.query<{ id: string }>(`SELECT id FROM tenants WHERE kind = 'agency' LIMIT 1`)).rows[0];
  if (!r) throw new Error('tenant da agência não encontrado');
  return r.id;
}

export async function aiRoutes(app: FastifyInstance, ctx: AppContext) {
  // ------------------------------------------------------------------ status e equipe
  app.get('/ai/status', { config: { permission: 'ai:read' } }, async () => ctx.ai.status());

  app.get('/ai/agents', { config: { permission: 'ai:read' } }, async () => ({ items: listAgents() }));

  // ------------------------------------------------------------------ demandas → Orchestrator
  app.post('/demands/:id/ai/plan', { config: { permission: 'ai:run' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(planDemandInput, req.body ?? {});
    if (!ctx.ai.configured) throw integrationPending();
    const runId = await withContext(ctx.pool, access.context('ai:run', requestedTenant(req)), async (tx) => {
      const d = (await tx.query<{ tenant_id: string; status: string }>('SELECT tenant_id, status FROM demands WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!d) throw notFound();
      if (['delivered', 'cancelled'].includes(d.status)) throw conflict('Demanda encerrada');
      const b = await budgetStatus(tx, d.tenant_id);
      if (!b.enabled) throw conflict('IA desativada para este cliente');
      if (b.limitUsdMicros !== null && b.spentUsdMicros >= b.limitUsdMicros) throw conflict('Orçamento mensal de IA deste cliente atingido');
      const active = (
        await tx.query(`SELECT 1 FROM agent_runs WHERE demand_id = $1 AND kind IN ('plan','produce','qa') AND status IN ('queued','running') LIMIT 1`, [id])
      ).rowCount;
      if (active) throw conflict('Já existe um plano em execução para esta demanda');
      const runId = await queueRun(tx, {
        tenantId: d.tenant_id,
        agentKey: 'orchestrator',
        kind: 'plan',
        demandId: id,
        instruction: input.instruction ?? null,
        requestedBy: access.principal.userId,
      });
      await recordActivity(tx, { tenantId: d.tenant_id, actorUserId: access.principal.userId, type: 'ai.plan_requested', data: { demandId: id, runId } });
      await ctx.audit.recordIn(tx, { action: 'ai.plan_requested', result: 'success', tenantId: d.tenant_id, actorUserId: access.principal.userId, resourceType: 'demand', resourceId: id, ...requestMeta(req) });
      return runId;
    });
    return reply.code(202).send({ runId });
  });

  // ------------------------------------------------------------------ execuções
  app.get('/ai/runs', { config: { permission: 'ai:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(listRunsQuery, req.query);
    const where: string[] = [`r.kind <> 'chat'`];
    const params: unknown[] = [];
    if (q.demandId) where.push(`r.demand_id = $${params.push(q.demandId)}`);
    if (q.status) where.push(`r.status = $${params.push(q.status)}`);
    params.push(q.limit);
    return withContext(ctx.pool, access.context('ai:read', requestedTenant(req)), async (tx) => ({
      items: (await tx.query(`${RUN_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT $${params.length}`, params)).rows,
    }));
  });

  app.get('/ai/runs/:id', { config: { permission: 'ai:read' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('ai:read', requestedTenant(req)), async (tx) => {
      const run = (await tx.query(`${RUN_SELECT} WHERE r.id = $1 AND r.kind <> 'chat'`, [id])).rows[0];
      if (!run) throw notFound();
      const children = (await tx.query(`${RUN_SELECT} WHERE r.parent_run_id = $1 ORDER BY r.step_index, r.created_at`, [id])).rows;
      return { ...run, children };
    });
  });

  app.post('/ai/runs/:id/retry', { config: { permission: 'ai:run' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    if (!ctx.ai.configured) throw integrationPending();
    return withContext(ctx.pool, access.context('ai:run', requestedTenant(req)), async (tx) => {
      const r = (await tx.query<{ tenant_id: string; status: string; kind: string }>('SELECT tenant_id, status, kind FROM agent_runs WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r || r.kind === 'chat') throw notFound();
      if (!['failed', 'blocked'].includes(r.status)) throw conflict('Só é possível repetir execuções com falha ou bloqueadas');
      await tx.query(`UPDATE agent_runs SET status = 'queued', error = NULL, finished_at = NULL WHERE id = $1`, [id]);
      await enqueue(tx, { type: 'agent.run', tenantId: r.tenant_id, payload: { runId: id } });
      await ctx.audit.recordIn(tx, { action: 'ai.run_retried', result: 'success', tenantId: r.tenant_id, actorUserId: access.principal.userId, resourceType: 'agent_run', resourceId: id, ...requestMeta(req) });
      return { ok: true };
    });
  });

  app.post('/ai/runs/:id/cancel', { config: { permission: 'ai:run' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('ai:run', requestedTenant(req)), async (tx) => {
      const r = (await tx.query<{ tenant_id: string; status: string; kind: string }>('SELECT tenant_id, status, kind FROM agent_runs WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r || r.kind === 'chat') throw notFound();
      // Cancela a execução e tudo que ainda está na fila abaixo dela (passos futuros, QA).
      const n = (
        await tx.query(
          `WITH RECURSIVE tree AS (SELECT id FROM agent_runs WHERE id = $1
                                   UNION ALL SELECT c.id FROM agent_runs c JOIN tree ON c.parent_run_id = tree.id)
           UPDATE agent_runs SET status = 'cancelled', finished_at = now()
            WHERE id IN (SELECT id FROM tree) AND status IN ('queued', 'running', 'failed', 'blocked')`,
          [id],
        )
      ).rowCount;
      await ctx.audit.recordIn(tx, { action: 'ai.run_cancelled', result: 'success', tenantId: r.tenant_id, actorUserId: access.principal.userId, resourceType: 'agent_run', resourceId: id, ...requestMeta(req) });
      return { cancelled: n };
    });
  });

  // ------------------------------------------------------------------ memória
  app.get('/ai/memory', { config: { permission: 'ai:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(listMemoryQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) where.push(`m.status = $${params.push(q.status)}`);
    if (q.kind) where.push(`m.kind = $${params.push(q.kind)}`);
    return withContext(ctx.pool, access.context('ai:read', requestedTenant(req)), async (tx) => ({
      items: (
        await tx.query(
          `${MEMORY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY (m.status = 'proposed') DESC, m.updated_at DESC LIMIT 300`,
          params,
        )
      ).rows,
    }));
  });

  app.post('/ai/memory', { config: { permission: 'ai:run' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createMemoryInput, req.body);
    const dbCtx = singleTenantContext(access, 'ai:run', req);
    const actor = access.principal.userId;
    // Quem pode aprovar registra direto como aprovada; os demais propõem.
    const approve = access.can('ai:memory_approve', dbCtx.tenantId);
    const row = await withContext(ctx.pool, dbCtx, async (tx) => {
      const m = (
        await tx.query<{ id: string }>(
          `INSERT INTO agent_memories (tenant_id, kind, content, status, source_type, proposed_by_user, decided_by, decided_at)
           VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7) RETURNING id`,
          [dbCtx.tenantId, input.kind, input.content, approve ? 'approved' : 'proposed', actor, approve ? actor : null, approve ? new Date() : null],
        )
      ).rows[0]!;
      if (approve) await enqueue(tx, { type: 'memory.embed', tenantId: dbCtx.tenantId, payload: { memoryId: m.id } });
      await ctx.audit.recordIn(tx, { action: 'ai.memory_created', result: 'success', tenantId: dbCtx.tenantId, actorUserId: actor, resourceType: 'agent_memory', resourceId: m.id, ...requestMeta(req), metadata: { kind: input.kind, approved: approve } });
      return (await tx.query(`${MEMORY_SELECT} WHERE m.id = $1`, [m.id])).rows[0];
    });
    return reply.code(201).send(row);
  });

  app.post('/ai/memory/:id/decide', { config: { permission: 'ai:memory_approve' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(decideMemoryInput, req.body);
    const actor = access.principal.userId;
    return withContext(ctx.pool, access.context('ai:memory_approve', requestedTenant(req)), async (tx) => {
      const m = (await tx.query<{ tenant_id: string; status: string; content: string }>('SELECT tenant_id, status, content FROM agent_memories WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!m) throw notFound();
      const status = input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : 'archived';
      if (status === 'rejected' && m.status !== 'proposed') throw conflict('Só memórias propostas podem ser rejeitadas');
      const content = input.content ?? m.content;
      await tx.query(
        `UPDATE agent_memories SET status = $2, content = $3, decided_by = $4, decided_at = now(), decision_note = $5,
                embedding = CASE WHEN $3 = content THEN embedding ELSE NULL END
          WHERE id = $1`,
        [id, status, content, actor, input.note ?? null],
      );
      if (status === 'approved') await enqueue(tx, { type: 'memory.embed', tenantId: m.tenant_id, payload: { memoryId: id } });
      await ctx.audit.recordIn(tx, {
        action: `ai.memory_${input.decision}`,
        result: 'success',
        tenantId: m.tenant_id,
        actorUserId: actor,
        resourceType: 'agent_memory',
        resourceId: id,
        ...requestMeta(req),
        metadata: { edited: content !== m.content },
      });
      return (await tx.query(`${MEMORY_SELECT} WHERE m.id = $1`, [id])).rows[0];
    });
  });

  // ------------------------------------------------------------------ Agent Room
  app.get('/ai/meetings', { config: { permission: 'ai:read' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('ai:read', requestedTenant(req)), async (tx) => ({
      items: (
        await tx.query(
          `SELECT m.id, m.tenant_id AS "tenantId", t.name AS "clientName", m.title, m.agenda, m.agent_keys AS "agentKeys", m.status,
                  m.created_at AS "createdAt", m.closed_at AS "closedAt", u.name AS "createdByName",
                  (SELECT count(*)::int FROM agent_messages x WHERE x.meeting_id = m.id) AS "messageCount"
             FROM agent_meetings m JOIN tenants t ON t.id = m.tenant_id LEFT JOIN users u ON u.id = m.created_by
            ORDER BY (m.status <> 'closed') DESC, m.created_at DESC LIMIT 100`,
        )
      ).rows,
    }));
  });

  app.post('/ai/meetings', { config: { permission: 'ai:run' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createMeetingInput, req.body);
    const dbCtx = singleTenantContext(access, 'ai:run', req);
    const m = await withContext(ctx.pool, dbCtx, async (tx) => {
      const row = (
        await tx.query<{ id: string }>(
          `INSERT INTO agent_meetings (tenant_id, title, agenda, agent_keys, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [dbCtx.tenantId, input.title, input.agenda ?? null, [...new Set(input.agentKeys)], access.principal.userId],
        )
      ).rows[0]!;
      await recordActivity(tx, { tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, type: 'ai.meeting_opened', data: { meetingId: row.id, title: input.title } });
      return row;
    });
    return reply.code(201).send(m);
  });

  app.get('/ai/meetings/:id', { config: { permission: 'ai:read' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('ai:read', requestedTenant(req)), async (tx) => {
      const m = (
        await tx.query(
          `SELECT m.id, m.tenant_id AS "tenantId", t.name AS "clientName", m.title, m.agenda, m.agent_keys AS "agentKeys", m.status,
                  m.outcome, m.created_at AS "createdAt", m.closed_at AS "closedAt"
             FROM agent_meetings m JOIN tenants t ON t.id = m.tenant_id WHERE m.id = $1`,
          [id],
        )
      ).rows[0];
      if (!m) throw notFound();
      const messages = (
        await tx.query(
          `SELECT x.id, x.author_type AS "authorType", x.agent_key AS "agentKey", u.name AS "authorName", x.content, x.created_at AS "createdAt"
             FROM agent_messages x LEFT JOIN users u ON u.id = x.author_user_id
            WHERE x.meeting_id = $1 ORDER BY x.created_at`,
          [id],
        )
      ).rows;
      const pending = (
        await tx.query(`SELECT id, agent_key AS "agentKey", kind, status, error FROM agent_runs WHERE meeting_id = $1 AND status IN ('queued','running','failed','blocked') ORDER BY created_at`, [id])
      ).rows;
      return { ...m, messages, runs: pending };
    });
  });

  app.post('/ai/meetings/:id/messages', { config: { permission: 'ai:run' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(meetingMessageInput, req.body);
    const result = await withContext(ctx.pool, access.context('ai:run', requestedTenant(req)), async (tx) => {
      const m = (await tx.query<{ tenant_id: string; status: string; agent_keys: string[] }>('SELECT tenant_id, status, agent_keys FROM agent_meetings WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!m) throw notFound();
      if (m.status !== 'open') throw conflict('Reunião encerrada');
      const ask = input.ask ?? m.agent_keys;
      if (ask.some((k) => !m.agent_keys.includes(k))) throw badRequest('Agente não participa desta reunião');
      const msg = (
        await tx.query<{ id: string }>(
          `INSERT INTO agent_messages (tenant_id, meeting_id, author_type, author_user_id, content) VALUES ($1, $2, 'human', $3, $4) RETURNING id`,
          [m.tenant_id, id, access.principal.userId, input.content],
        )
      ).rows[0]!;
      const runs: string[] = [];
      if (ask.length && ctx.ai.configured) {
        for (const agentKey of ask) {
          runs.push(await queueRun(tx, { tenantId: m.tenant_id, agentKey: agentKey as never, kind: 'reply', meetingId: id, requestedBy: access.principal.userId }));
        }
      }
      return { messageId: msg.id, runs, ai: ctx.ai.configured ? 'configured' : 'integration_pending' };
    });
    return reply.code(201).send(result);
  });

  app.post('/ai/meetings/:id/close', { config: { permission: 'ai:run' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('ai:run', requestedTenant(req)), async (tx) => {
      const m = (await tx.query<{ tenant_id: string; status: string }>('SELECT tenant_id, status FROM agent_meetings WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!m) throw notFound();
      if (m.status !== 'open') throw conflict('Reunião já encerrada');
      await tx.query(`UPDATE agent_runs SET status = 'cancelled', finished_at = now() WHERE meeting_id = $1 AND kind = 'reply' AND status = 'queued'`, [id]);
      if (!ctx.ai.configured) {
        // Sem IA: encerra sem ata automática (nada é simulado).
        await tx.query(`UPDATE agent_meetings SET status = 'closed', closed_at = now() WHERE id = $1`, [id]);
        return { status: 'closed', summary: 'integration_pending' };
      }
      await tx.query(`UPDATE agent_meetings SET status = 'summarizing' WHERE id = $1`, [id]);
      const runId = await queueRun(tx, { tenantId: m.tenant_id, agentKey: 'orchestrator', kind: 'summarize', meetingId: id, requestedBy: access.principal.userId });
      return { status: 'summarizing', runId };
    });
  });

  /** Transforma uma tarefa sugerida na ata em tarefa real (decisão humana). */
  app.post('/ai/meetings/:id/tasks', { config: { permission: 'tasks:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(meetingTaskToCreateInput, req.body);
    const task = await withContext(ctx.pool, access.context('tasks:write', requestedTenant(req)), async (tx) => {
      const m = (await tx.query<{ tenant_id: string; outcome: { tasks?: { title: string; owner: string; dueDate: string | null }[] } | null; title: string }>('SELECT tenant_id, outcome, title FROM agent_meetings WHERE id = $1', [id])).rows[0];
      if (!m) throw notFound();
      const t = m.outcome?.tasks?.[input.index];
      if (!t) throw notFound('Tarefa não encontrada na ata');
      const due = t.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : null;
      const title = t.title.trim().slice(0, 200).padEnd(2, '.');
      return (
        await tx.query(
          `INSERT INTO tasks (tenant_id, title, description, due_date, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, title`,
          [m.tenant_id, title, `Da reunião "${m.title}" (responsável sugerido: ${t.owner})`, due, access.principal.userId],
        )
      ).rows[0];
    });
    return reply.code(201).send(task);
  });

  // ------------------------------------------------------------------ Chat Global (por usuário)
  const chatCtx = async (userId: string) => {
    const agency = await withContext(ctx.pool, SYSTEM, agencyTenantId);
    return { agency, db: { scope: 'tenant' as const, tenantIds: [agency], userId } };
  };

  app.get('/ai/chat/threads', { config: { permission: 'ai:chat' } }, async (req) => {
    const access = requireAccess(req);
    if (!access.hasGlobal('ai:chat')) throw new AppError(403, 'forbidden', 'Acesso negado');
    const { db } = await chatCtx(access.principal.userId);
    return withContext(ctx.pool, db, async (tx) => ({
      items: (
        await tx.query(`SELECT id, title, created_at AS "createdAt", updated_at AS "updatedAt" FROM ai_chat_threads WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`, [
          access.principal.userId,
        ])
      ).rows,
    }));
  });

  app.post('/ai/chat/threads', { config: { permission: 'ai:chat' } }, async (req, reply) => {
    const access = requireAccess(req);
    if (!access.hasGlobal('ai:chat')) throw new AppError(403, 'forbidden', 'Acesso negado');
    const input = parse(chatMessageInput, req.body);
    if (!ctx.ai.configured) throw integrationPending();
    const { agency, db } = await chatCtx(access.principal.userId);
    const out = await withContext(ctx.pool, db, async (tx) => {
      const t = (
        await tx.query<{ id: string }>(`INSERT INTO ai_chat_threads (tenant_id, user_id, title) VALUES ($1, $2, $3) RETURNING id`, [
          agency,
          access.principal.userId,
          input.content.slice(0, 80),
        ])
      ).rows[0]!;
      await tx.query(`INSERT INTO agent_messages (tenant_id, thread_id, author_type, author_user_id, content) VALUES ($1, $2, 'human', $3, $4)`, [agency, t.id, access.principal.userId, input.content]);
      const runId = await queueRun(tx, { tenantId: agency, agentKey: 'orchestrator', kind: 'chat', threadId: t.id, requestedBy: access.principal.userId });
      return { id: t.id, runId };
    });
    return reply.code(201).send(out);
  });

  const ownThread = async (tx: Tx, id: string, userId: string) => {
    const t = (await tx.query<{ id: string; title: string }>('SELECT id, title FROM ai_chat_threads WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
    if (!t) throw notFound();
    return t;
  };

  app.get('/ai/chat/threads/:id', { config: { permission: 'ai:chat' } }, async (req) => {
    const access = requireAccess(req);
    if (!access.hasGlobal('ai:chat')) throw new AppError(403, 'forbidden', 'Acesso negado');
    const { id } = parse(uuidParam, req.params);
    const { db } = await chatCtx(access.principal.userId);
    return withContext(ctx.pool, db, async (tx) => {
      const t = await ownThread(tx, id, access.principal.userId);
      const messages = (
        await tx.query(`SELECT id, author_type AS "authorType", content, data, created_at AS "createdAt" FROM agent_messages WHERE thread_id = $1 ORDER BY created_at`, [id])
      ).rows;
      const pending = (await tx.query(`SELECT id, status, error FROM agent_runs WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1`, [id])).rows[0] ?? null;
      return { ...t, messages, lastRun: pending };
    });
  });

  app.post('/ai/chat/threads/:id/messages', { config: { permission: 'ai:chat' } }, async (req, reply) => {
    const access = requireAccess(req);
    if (!access.hasGlobal('ai:chat')) throw new AppError(403, 'forbidden', 'Acesso negado');
    const { id } = parse(uuidParam, req.params);
    const input = parse(chatMessageInput, req.body);
    if (!ctx.ai.configured) throw integrationPending();
    const { agency, db } = await chatCtx(access.principal.userId);
    const out = await withContext(ctx.pool, db, async (tx) => {
      await ownThread(tx, id, access.principal.userId);
      const busy = (await tx.query(`SELECT 1 FROM agent_runs WHERE thread_id = $1 AND status IN ('queued','running')`, [id])).rowCount;
      if (busy) throw conflict('Aguarde a resposta anterior');
      await tx.query(`INSERT INTO agent_messages (tenant_id, thread_id, author_type, author_user_id, content) VALUES ($1, $2, 'human', $3, $4)`, [agency, id, access.principal.userId, input.content]);
      return { runId: await queueRun(tx, { tenantId: agency, agentKey: 'orchestrator', kind: 'chat', threadId: id, requestedBy: access.principal.userId }) };
    });
    return reply.code(201).send(out);
  });

  app.delete('/ai/chat/threads/:id', { config: { permission: 'ai:chat' } }, async (req, reply) => {
    const access = requireAccess(req);
    if (!access.hasGlobal('ai:chat')) throw new AppError(403, 'forbidden', 'Acesso negado');
    const { id } = parse(uuidParam, req.params);
    const { db } = await chatCtx(access.principal.userId);
    await withContext(ctx.pool, db, async (tx) => {
      await ownThread(tx, id, access.principal.userId);
      // O consumo (ai_usage) permanece: é trilha de custo.
      await tx.query('DELETE FROM ai_chat_threads WHERE id = $1', [id]);
    });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ orçamento e consumo
  app.get('/ai/settings', { config: { permission: 'ai:settings' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('ai:settings', requestedTenant(req)), async (tx) => {
      const items = (
        await tx.query(
          `SELECT c.tenant_id AS "tenantId", c.trade_name AS "clientName", coalesce(s.enabled, true) AS enabled,
                  s.monthly_budget_usd_micros::float8 AS "monthlyBudgetUsdMicros", coalesce(s.auto_plan_demands, false) AS "autoPlanDemands",
                  coalesce((SELECT sum(cost_usd_micros) FROM ai_usage u WHERE u.tenant_id = c.tenant_id AND u.created_at >= date_trunc('month', now())), 0)::float8 AS "spentUsdMicros"
             FROM clients c LEFT JOIN ai_settings s ON s.tenant_id = c.tenant_id
            ORDER BY c.trade_name`,
        )
      ).rows;
      const rate = access.hasGlobal('ai:settings') ? Number((await tx.query<{ r: string }>('SELECT usd_brl_rate AS r FROM agency_settings WHERE id = 1')).rows[0]?.r ?? 0) : null;
      return { items, usdBrlRate: rate, status: ctx.ai.status() };
    });
  });

  app.put('/ai/settings/:id', { config: { permission: 'ai:settings' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(aiSettingsInput, req.body);
    return withContext(ctx.pool, access.context('ai:settings', id), async (tx) => {
      const ok = (await tx.query(`SELECT 1 FROM clients WHERE tenant_id = $1`, [id])).rowCount;
      if (!ok) throw notFound();
      const micros = input.monthlyBudgetUsd === null ? null : Math.round(input.monthlyBudgetUsd * 1_000_000);
      await tx.query(
        `INSERT INTO ai_settings (tenant_id, enabled, monthly_budget_usd_micros, auto_plan_demands, updated_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET enabled = EXCLUDED.enabled, monthly_budget_usd_micros = EXCLUDED.monthly_budget_usd_micros,
                auto_plan_demands = EXCLUDED.auto_plan_demands, updated_by = EXCLUDED.updated_by`,
        [id, input.enabled, micros, input.autoPlanDemands, access.principal.userId],
      );
      await ctx.audit.recordIn(tx, { action: 'ai.settings_updated', result: 'success', tenantId: id, actorUserId: access.principal.userId, resourceType: 'ai_settings', resourceId: id, ...requestMeta(req), metadata: input });
      return { ok: true };
    });
  });

  app.put('/ai/usd-rate', { config: { permission: 'ai:settings' } }, async (req) => {
    const access = requireAccess(req);
    if (!access.hasGlobal('ai:settings')) throw new AppError(403, 'forbidden', 'Acesso negado');
    const input = parse(usdBrlRateInput, req.body);
    await withContext(ctx.pool, access.context('ai:settings'), async (tx) => {
      await tx.query('UPDATE agency_settings SET usd_brl_rate = $1 WHERE id = 1', [input.usdBrlRate]);
      await ctx.audit.recordIn(tx, { action: 'ai.usd_rate_updated', result: 'success', actorUserId: access.principal.userId, ...requestMeta(req), metadata: input });
    });
    return { ok: true };
  });

  app.get('/ai/usage', { config: { permission: 'ai:settings' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }), req.query);
    const { month, from, to } = monthRange(q.month);
    return withContext(ctx.pool, access.context('ai:settings', requestedTenant(req)), async (tx) => {
      const by = async (col: string) =>
        (
          await tx.query(
            `SELECT ${col} AS key, count(*)::int AS calls, sum(input_tokens + cache_read_tokens + cache_write_tokens)::float8 AS "inputTokens",
                    sum(output_tokens)::float8 AS "outputTokens", sum(cost_usd_micros)::float8 AS "costUsdMicros"
               FROM ai_usage u JOIN tenants t ON t.id = u.tenant_id
              WHERE u.created_at >= $1::date AND u.created_at < ($2::date + 1)
              GROUP BY 1 ORDER BY "costUsdMicros" DESC NULLS LAST`,
            [from, to],
          )
        ).rows;
      return { month, byClient: await by('t.name'), byAgent: await by('u.agent_key'), byModel: await by('u.model'), byPurpose: await by('u.purpose') };
    });
  });
}
