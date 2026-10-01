import { z } from 'zod';

// ---------------------------------------------------------------- equipe de agentes
export const AGENT_KEYS = [
  'orchestrator',
  'director',
  'researcher',
  'copywriter',
  'social_media',
  'designer',
  'video',
  'traffic',
  'analytics',
  'customer_success',
  'finance',
  'qa',
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_LABELS: Record<AgentKey, string> = {
  orchestrator: 'Master Orchestrator',
  director: 'Diretor de Marketing',
  researcher: 'Pesquisador',
  copywriter: 'Copywriter',
  social_media: 'Social Media',
  designer: 'Designer',
  video: 'Vídeo',
  traffic: 'Tráfego',
  analytics: 'Analytics',
  customer_success: 'Customer Success',
  finance: 'Financeiro',
  qa: 'QA',
};

/** Agentes que podem produzir um passo do plano de uma demanda. */
export const PRODUCER_AGENT_KEYS = [
  'director',
  'researcher',
  'copywriter',
  'social_media',
  'designer',
  'video',
  'traffic',
  'analytics',
  'customer_success',
] as const satisfies readonly AgentKey[];

/** Agentes que podem participar de reuniões no Agent Room. */
export const ROOM_AGENT_KEYS = [...PRODUCER_AGENT_KEYS, 'finance', 'qa'] as const satisfies readonly AgentKey[];

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Na fila',
  running: 'Executando',
  succeeded: 'Concluída',
  failed: 'Falhou',
  blocked: 'Bloqueada',
  cancelled: 'Cancelada',
};
export const RUN_KIND_LABELS: Record<string, string> = {
  plan: 'Plano',
  produce: 'Produção',
  qa: 'Revisão de QA',
  reply: 'Resposta na reunião',
  summarize: 'Ata da reunião',
  chat: 'Chat Global',
};

// ---------------------------------------------------------------- memória
export const MEMORY_KINDS = ['operational', 'knowledge', 'strategic', 'brand_rules', 'experience'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  operational: 'Operacional',
  knowledge: 'Conhecimento',
  strategic: 'Estratégica',
  brand_rules: 'Regras da marca',
  experience: 'Experiência',
};
export const MEMORY_STATUSES = ['proposed', 'approved', 'rejected', 'archived'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export const MEMORY_STATUS_LABELS: Record<MemoryStatus, string> = {
  proposed: 'Proposta',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  archived: 'Arquivada',
};

export const createMemoryInput = z.strictObject({
  kind: z.enum(MEMORY_KINDS),
  content: z.string().trim().min(3).max(4000),
});

export const decideMemoryInput = z.strictObject({
  decision: z.enum(['approve', 'reject', 'archive']),
  /** Correção do texto antes de aprovar (opcional). */
  content: z.string().trim().min(3).max(4000).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const listMemoryQuery = z.strictObject({
  status: z.enum(MEMORY_STATUSES).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
});

// ---------------------------------------------------------------- execuções
export const planDemandInput = z.strictObject({
  /** Orientação extra do humano para o Orchestrator. */
  instruction: z.string().trim().max(4000).optional(),
});

export const listRunsQuery = z.strictObject({
  demandId: z.uuid().optional(),
  status: z.enum(RUN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------- Agent Room
export const createMeetingInput = z.strictObject({
  title: z.string().trim().min(2).max(200),
  agenda: z.string().trim().max(4000).optional(),
  agentKeys: z.array(z.enum(ROOM_AGENT_KEYS)).min(1).max(6),
});

export const meetingMessageInput = z.strictObject({
  content: z.string().trim().min(1).max(8000),
  /** Agentes que devem responder (padrão: todos da reunião). */
  ask: z.array(z.enum(ROOM_AGENT_KEYS)).max(6).optional(),
});

export const meetingTaskToCreateInput = z.strictObject({
  index: z.number().int().min(0).max(50),
});

// ---------------------------------------------------------------- Chat Global
export const chatMessageInput = z.strictObject({
  content: z.string().trim().min(1).max(8000),
});

// ---------------------------------------------------------------- configurações
export const aiSettingsInput = z.strictObject({
  enabled: z.boolean(),
  /** Orçamento mensal em dólares (ex.: 25.5). null = sem limite. */
  monthlyBudgetUsd: z.number().min(0).max(100_000).nullable(),
  autoPlanDemands: z.boolean(),
});

export const usdBrlRateInput = z.strictObject({
  usdBrlRate: z.number().gt(0).max(100),
});
