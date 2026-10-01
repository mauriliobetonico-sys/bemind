import { z } from 'zod';

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RISK_LABELS: Record<RiskLevel, string> = { LOW: 'Baixo', MEDIUM: 'Médio', HIGH: 'Alto' };

export const TOOL_CALL_STATUSES = ['pending_approval', 'queued', 'running', 'succeeded', 'failed', 'rejected', 'cancelled'] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];
export const TOOL_CALL_STATUS_LABELS: Record<ToolCallStatus, string> = {
  pending_approval: 'Aguardando aprovação',
  queued: 'Na fila',
  running: 'Executando',
  succeeded: 'Concluída',
  failed: 'Falhou',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
};

export const CONNECTION_STATUSES = ['active', 'disabled', 'error'] as const;
export const CONNECTION_STATUS_LABELS: Record<(typeof CONNECTION_STATUSES)[number], string> = {
  active: 'Ativa',
  disabled: 'Desligada',
  error: 'Com erro',
};

/** Conectar/atualizar: os campos variam por conector e são validados no servidor. */
export const upsertConnectionInput = z.strictObject({
  label: z.string().trim().max(120).optional(),
  config: z.record(z.string(), z.string().max(2000)).default({}),
  /** Segredos (senha de aplicativo, segredo do webhook). Omitido = mantém o atual. */
  secrets: z.record(z.string(), z.string().max(4000)).optional(),
});

export const connectionStatusInput = z.strictObject({ status: z.enum(['active', 'disabled']) });

export const requestToolCallInput = z.strictObject({
  tool: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  params: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().trim().min(3).max(1000),
  /** Agendamento (ferramentas que permitem): executa a partir deste horário, depois da aprovação. */
  scheduledFor: z.iso.datetime({ offset: true }).optional(),
});

export const decideToolCallInput = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).optional(),
});

export const listToolCallsQuery = z.strictObject({
  status: z.enum(TOOL_CALL_STATUSES).optional(),
  deliverableId: z.uuid().optional(),
  connector: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const toolPolicyInput = z.strictObject({
  enabled: z.boolean(),
  allowSelfApproval: z.boolean(),
});
