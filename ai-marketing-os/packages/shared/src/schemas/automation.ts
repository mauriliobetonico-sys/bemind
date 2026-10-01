import { z } from 'zod';
import { DEMAND_TYPES } from './work';

// ---------------------------------------------------------------- notificações
export const NOTIFICATION_CATEGORIES = ['demand', 'approval', 'deadline', 'meeting', 'finance', 'report', 'ai', 'tools'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  demand: 'Demandas (nova, iniciada, concluída)',
  approval: 'Aprovações e alterações',
  deadline: 'Prazos e tarefas atrasadas',
  meeting: 'Reuniões',
  finance: 'Pagamentos, faturas e contratos',
  report: 'Relatório diário',
  ai: 'Agentes de IA',
  tools: 'Aprovações de ferramentas',
};

export const listNotificationsQuery = z.strictObject({
  unread: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const notificationPreferencesInput = z.strictObject({
  email: z.partialRecord(z.enum(NOTIFICATION_CATEGORIES), z.boolean()),
});

// ---------------------------------------------------------------- relatório diário
export const REPORT_SECTIONS = ['doneToday', 'inProgress', 'completed', 'needsApproval', 'nextSteps', 'notes'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const REPORT_SECTION_LABELS: Record<ReportSection, string> = {
  doneToday: 'O que fizemos hoje',
  inProgress: 'O que está em andamento',
  completed: 'O que foi concluído',
  needsApproval: 'O que precisa da sua aprovação',
  nextSteps: 'Próximos passos',
  notes: 'Observações',
};

export const reportSettingsInput = z.strictObject({
  dailyReportEnabled: z.boolean(),
  dailyReportWeekdaysOnly: z.boolean(),
});

export const generateReportInput = z.strictObject({
  /** AAAA-MM-DD; padrão: hoje (fuso da agência). */
  date: z.iso.date().optional(),
  /** Enviar por e-mail aos usuários do cliente depois de gerar. */
  send: z.boolean().default(true),
});

// ---------------------------------------------------------------- workflows
export const WORKFLOW_TRIGGERS = ['demand.created', 'demand.delivered', 'approval.approved', 'approval.changes_requested'] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];
export const WORKFLOW_TRIGGER_LABELS: Record<WorkflowTrigger, string> = {
  'demand.created': 'Nova demanda aberta',
  'demand.delivered': 'Demanda entregue',
  'approval.approved': 'Cliente aprovou um entregável',
  'approval.changes_requested': 'Cliente pediu alteração',
};

/** Marcadores disponíveis nos parâmetros, por gatilho. */
export const WORKFLOW_VARIABLES: Record<WorkflowTrigger, string[]> = {
  'demand.created': ['demandId', 'demandTitle', 'demandType', 'clientName'],
  'demand.delivered': ['demandId', 'demandTitle', 'demandType', 'clientName'],
  'approval.approved': ['demandId', 'demandTitle', 'demandType', 'deliverableId', 'deliverableTitle', 'clientName'],
  'approval.changes_requested': ['demandId', 'demandTitle', 'demandType', 'deliverableId', 'deliverableTitle', 'clientName', 'reason'],
};

export const workflowRuleInput = z.strictObject({
  name: z.string().trim().min(2).max(120),
  trigger: z.enum(WORKFLOW_TRIGGERS),
  demandTypes: z.array(z.enum(DEMAND_TYPES)).max(20).default([]),
  tool: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  params: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});
