import { z } from 'zod';
import { PRODUCER_AGENT_KEYS } from '@aimos/shared';
import { recordActivity } from '../../modules/work/common';
import { defineTool, type ConnectorDef } from '../registry';

export const internalConnector: ConnectorDef = {
  key: 'internal',
  name: 'Sistema interno',
  description: 'Ações dentro da própria plataforma (tarefas e calendário do cliente). Sempre disponível.',
  availability: 'available',
  builtIn: true,
  fields: [],
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-DD');

export const createTaskTool = defineTool({
  name: 'internal.create_task',
  connector: 'internal',
  title: 'Criar tarefa interna',
  description: 'Cria uma tarefa para a equipe no cliente (opcionalmente ligada a uma demanda).',
  risk: 'LOW',
  allowedAgents: ['orchestrator', ...PRODUCER_AGENT_KEYS],
  permission: 'tasks:write',
  rateLimitPerMinute: 30,
  params: z.strictObject({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(4000).nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    demandId: z.uuid().nullable().optional(),
  }),
  async validate(tx, _tenantId, p) {
    if (p.demandId && !(await tx.query('SELECT 1 FROM demands WHERE id = $1', [p.demandId])).rowCount) throw new Error('Demanda não encontrada neste cliente');
  },
  async execute(ctx, p) {
    const id = await ctx.withTenant(async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO tasks (tenant_id, demand_id, title, description, due_date) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [ctx.tenantId, p.demandId ?? null, p.title, p.description ?? null, p.dueDate ?? null],
      );
      return r.rows[0]!.id;
    });
    return { summary: `Tarefa criada: ${p.title}`, data: { taskId: id } };
  },
});

export const scheduleEventTool = defineTool({
  name: 'internal.schedule_event',
  connector: 'internal',
  title: 'Agendar no calendário (interno)',
  description: 'Cria um evento INTERNO no calendário do cliente (o cliente não vê até a equipe mudar a visibilidade).',
  risk: 'LOW',
  allowedAgents: ['orchestrator', 'social_media', 'customer_success', 'traffic'],
  permission: 'work:manage',
  rateLimitPerMinute: 30,
  params: z.strictObject({
    title: z.string().trim().min(2).max(200),
    kind: z.enum(['content', 'campaign', 'meeting', 'task', 'delivery']),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  }),
  async execute(ctx, p) {
    if (p.endsAt && new Date(p.endsAt) < new Date(p.startsAt)) throw new Error('Fim antes do início');
    const id = await ctx.withTenant(async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO calendar_events (tenant_id, kind, title, description, starts_at, ends_at, visibility) VALUES ($1, $2, $3, $4, $5, $6, 'internal') RETURNING id`,
        [ctx.tenantId, p.kind, p.title, p.description ?? null, p.startsAt, p.endsAt ?? null],
      );
      await recordActivity(tx, { tenantId: ctx.tenantId, actorUserId: null, type: 'mcp.calendar_event_created', data: { eventId: r.rows[0]!.id, title: p.title } });
      return r.rows[0]!.id;
    });
    return { summary: `Evento interno agendado: ${p.title}`, data: { eventId: id } };
  },
});
