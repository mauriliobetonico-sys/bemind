import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v === undefined ? null : v));
const optionalDate = z.iso.date().optional().nullable();
const optionalUuid = z.uuid().optional().nullable();

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const PRIORITY_LABELS: Record<(typeof PRIORITIES)[number], string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };

// ---------------------------------------------------------------- projetos
export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'done', 'cancelled'] as const;
export const PROJECT_STATUS_LABELS: Record<(typeof PROJECT_STATUSES)[number], string> = {
  planning: 'Planejamento',
  active: 'Em andamento',
  on_hold: 'Pausado',
  done: 'Concluído',
  cancelled: 'Cancelado',
};

const projectFields = {
  name: text(200).min(2),
  description: optionalText(5000),
  status: z.enum(PROJECT_STATUSES),
  startDate: optionalDate,
  dueDate: optionalDate,
};
export const createProjectInput = z.strictObject({ ...projectFields, status: z.enum(PROJECT_STATUSES).default('planning') });
export const updateProjectInput = z
  .strictObject(projectFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' });

// ---------------------------------------------------------------- demandas
export const DEMAND_TYPES = ['post', 'story', 'reel', 'video', 'banner', 'campaign', 'ad', 'site', 'landing_page', 'graphic', 'other'] as const;
export const DEMAND_TYPE_LABELS: Record<(typeof DEMAND_TYPES)[number], string> = {
  post: 'Post',
  story: 'Story',
  reel: 'Reel',
  video: 'Vídeo',
  banner: 'Banner',
  campaign: 'Campanha',
  ad: 'Anúncio',
  site: 'Site',
  landing_page: 'Landing page',
  graphic: 'Material gráfico',
  other: 'Outro',
};

export const DEMAND_STATUSES = [
  'submitted',
  'planning',
  'in_production',
  'in_review',
  'awaiting_approval',
  'changes_requested',
  'approved',
  'delivered',
  'cancelled',
] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];
export const DEMAND_STATUS_LABELS: Record<DemandStatus, string> = {
  submitted: 'Recebida',
  planning: 'Planejamento',
  in_production: 'Em produção',
  in_review: 'Em revisão (QA)',
  awaiting_approval: 'Aguardando aprovação',
  changes_requested: 'Alteração solicitada',
  approved: 'Aprovada',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
};

/** Transições de status que a equipe pode fazer manualmente. As demais são automáticas (aprovações). */
export const DEMAND_MANUAL_TRANSITIONS: Record<DemandStatus, DemandStatus[]> = {
  submitted: ['planning', 'cancelled'],
  planning: ['in_production', 'cancelled'],
  in_production: ['in_review', 'planning', 'cancelled'],
  in_review: ['in_production', 'cancelled'],
  awaiting_approval: ['cancelled'],
  changes_requested: ['in_production', 'cancelled'],
  approved: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const createDemandInput = z.strictObject({
  type: z.enum(DEMAND_TYPES),
  title: text(200).min(2),
  description: text(10000).min(5, 'Descreva o que você precisa'),
  priority: z.enum(PRIORITIES).default('normal'),
  dueDate: optionalDate,
  refs: optionalText(5000),
  notes: optionalText(5000),
  projectId: optionalUuid,
});
export type CreateDemandInput = z.infer<typeof createDemandInput>;

export const updateDemandInput = z
  .strictObject({
    title: text(200).min(2),
    description: text(10000).min(5),
    priority: z.enum(PRIORITIES),
    dueDate: optionalDate,
    refs: optionalText(5000),
    notes: optionalText(5000),
    projectId: optionalUuid,
    status: z.enum(DEMAND_STATUSES),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' });

export const listDemandsQuery = z.strictObject({
  status: z.enum(DEMAND_STATUSES).optional(),
  open: z.enum(['true', 'false']).optional(),
  projectId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const briefingInput = z.strictObject({
  objective: text(5000).min(5),
  audience: optionalText(5000),
  keyMessages: optionalText(5000),
  deliverables: optionalText(5000),
  tone: optionalText(2000),
  constraints: optionalText(5000),
});

// ---------------------------------------------------------------- tarefas
export const TASK_STATUSES = ['todo', 'doing', 'review', 'done', 'blocked'] as const;
export const TASK_STATUS_LABELS: Record<(typeof TASK_STATUSES)[number], string> = {
  todo: 'A fazer',
  doing: 'Fazendo',
  review: 'Revisão',
  done: 'Concluída',
  blocked: 'Bloqueada',
};
const taskFields = {
  title: text(200).min(2),
  description: optionalText(5000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  assigneeId: optionalUuid,
  dueDate: optionalDate,
  projectId: optionalUuid,
  demandId: optionalUuid,
};
export const createTaskInput = z.strictObject({
  ...taskFields,
  status: z.enum(TASK_STATUSES).default('todo'),
  priority: z.enum(PRIORITIES).default('normal'),
});
export const updateTaskInput = z
  .strictObject(taskFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' });
export const listTasksQuery = z.strictObject({
  status: z.enum(TASK_STATUSES).optional(),
  mine: z.enum(['true', 'false']).optional(),
  demandId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  overdue: z.enum(['true', 'false']).optional(),
});

// ---------------------------------------------------------------- entregáveis e aprovações
export const DELIVERABLE_STATUSES = ['draft', 'internal_review', 'awaiting_client', 'changes_requested', 'approved'] as const;
export const DELIVERABLE_STATUS_LABELS: Record<(typeof DELIVERABLE_STATUSES)[number], string> = {
  draft: 'Rascunho',
  internal_review: 'Revisão interna (QA)',
  awaiting_client: 'Aguardando cliente',
  changes_requested: 'Alteração solicitada',
  approved: 'Aprovado',
};
export const createDeliverableInput = z.strictObject({
  title: text(200).min(2),
  description: optionalText(5000),
  fileId: optionalUuid,
});
export const updateDeliverableInput = z
  .strictObject({
    title: text(200).min(2),
    description: optionalText(5000),
    fileId: optionalUuid,
    /** Fluxo interno: rascunho → revisão interna (QA) → (QA aprova) pronto para enviar ao cliente. */
    action: z.enum(['submit_for_qa', 'qa_reject', 'new_version']),
    qaNotes: optionalText(5000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' })
  .refine((v) => v.action !== 'qa_reject' || (v.qaNotes && v.qaNotes.length > 0), {
    message: 'Informe o que precisa ser corrigido',
    path: ['qaNotes'],
  });

export const requestApprovalInput = z.strictObject({ message: optionalText(2000) });
export const decideApprovalInput = z
  .strictObject({
    decision: z.enum(['approved', 'changes_requested']),
    reason: optionalText(5000),
  })
  .refine((v) => v.decision === 'approved' || (v.reason && v.reason.length > 0), {
    message: 'Conte o que você gostaria de alterar',
    path: ['reason'],
  });

// ---------------------------------------------------------------- calendário
export const CALENDAR_KINDS = ['content', 'campaign', 'meeting', 'task', 'delivery', 'approval'] as const;
export const CALENDAR_KIND_LABELS: Record<(typeof CALENDAR_KINDS)[number], string> = {
  content: 'Conteúdo',
  campaign: 'Campanha',
  meeting: 'Reunião',
  task: 'Tarefa',
  delivery: 'Entrega',
  approval: 'Aprovação',
};
export const createEventInput = z
  .strictObject({
    kind: z.enum(CALENDAR_KINDS),
    title: text(200).min(2),
    description: optionalText(5000),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }).optional().nullable(),
    allDay: z.boolean().default(false),
    visibility: z.enum(['client', 'internal']).default('client'),
    demandId: optionalUuid,
  })
  .refine((v) => !v.endsAt || new Date(v.endsAt) >= new Date(v.startsAt), { message: 'Fim antes do início', path: ['endsAt'] });
export const calendarQuery = z
  .strictObject({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.to >= v.from, { message: 'Intervalo inválido' })
  .refine((v) => (new Date(v.to).getTime() - new Date(v.from).getTime()) / 86400000 <= 62, { message: 'Intervalo máximo de 62 dias' });

// ---------------------------------------------------------------- arquivos e Brand Vault
export const FILE_CATEGORIES = ['image', 'video', 'logo', 'brand_manual', 'catalog', 'document', 'spreadsheet', 'presentation', 'archive', 'design', 'font', 'other'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];
export const FILE_CATEGORY_LABELS: Record<FileCategory, [string, string]> = {
  image: ['imagem', 'imagens'],
  video: ['vídeo', 'vídeos'],
  logo: ['logo', 'logos'],
  brand_manual: ['manual de marca', 'manuais de marca'],
  catalog: ['catálogo', 'catálogos'],
  document: ['documento', 'documentos'],
  spreadsheet: ['planilha', 'planilhas'],
  presentation: ['apresentação', 'apresentações'],
  archive: ['arquivo compactado', 'arquivos compactados'],
  design: ['arquivo de design', 'arquivos de design'],
  font: ['fonte', 'fontes'],
  other: ['outro arquivo', 'outros arquivos'],
};

export const BRAND_KINDS = ['logo', 'font', 'color', 'manual', 'image', 'video', 'product', 'service', 'price', 'campaign', 'reference', 'document'] as const;
export const BRAND_KIND_LABELS: Record<(typeof BRAND_KINDS)[number], string> = {
  logo: 'Logo',
  font: 'Fonte',
  color: 'Cor',
  manual: 'Manual de marca',
  image: 'Imagem',
  video: 'Vídeo',
  product: 'Produto',
  service: 'Serviço',
  price: 'Preço',
  campaign: 'Campanha',
  reference: 'Referência',
  document: 'Documento',
};
export const createBrandAssetInput = z
  .strictObject({
    kind: z.enum(BRAND_KINDS),
    title: text(200).min(1),
    value: optionalText(2000),
    fileId: optionalUuid,
    notes: optionalText(2000),
  })
  .refine((v) => v.value || v.fileId, { message: 'Informe um valor ou um arquivo', path: ['value'] })
  .refine((v) => v.kind !== 'color' || (v.value && /^#[0-9a-fA-F]{6}$/.test(v.value)), { message: 'Cor no formato #RRGGBB', path: ['value'] });

export const listFilesQuery = z.strictObject({
  category: z.enum(FILE_CATEGORIES).optional(),
  demandId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
});

/** "Identifiquei: 11 imagens, 4 vídeos, 1 logo…" */
export function summarizeCategories(counts: Partial<Record<FileCategory, number>>): string {
  const parts = FILE_CATEGORIES.filter((c) => (counts[c] ?? 0) > 0).map((c) => {
    const n = counts[c]!;
    return `${n} ${FILE_CATEGORY_LABELS[c][n === 1 ? 0 : 1]}`;
  });
  if (parts.length === 0) return 'Nenhum arquivo identificado.';
  return `Identifiquei: ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0]}.`;
}
