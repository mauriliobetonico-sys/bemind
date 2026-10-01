import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v === undefined ? null : v));
const cents = z.number().int().min(0).max(100_000_000_00);

export const PERIODICITIES = ['monthly', 'quarterly', 'yearly'] as const;
export type Periodicity = (typeof PERIODICITIES)[number];
export const PERIODICITY_LABELS: Record<Periodicity, string> = { monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual' };
export const PERIOD_MONTHS: Record<Periodicity, number> = { monthly: 1, quarterly: 3, yearly: 12 };

// ---------------------------------------------------------------- propostas
export const PROPOSAL_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviada',
  viewed: 'Visualizada',
  accepted: 'Aceita',
  rejected: 'Recusada',
  expired: 'Expirada',
};

export const proposalItemInput = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  quantity: z.number().positive().max(100000),
  unitPriceCents: cents,
  recurrence: z.enum(['recurring', 'one_time']),
});
export type ProposalItemInput = z.infer<typeof proposalItemInput>;

const proposalFields = {
  title: z.string().trim().min(2).max(200),
  validUntil: z.iso.date(),
  periodicity: z.enum(PERIODICITIES),
  discountType: z.enum(['none', 'percent', 'amount']),
  /** percent: 0–100; amount: em centavos, sobre o valor recorrente. */
  discountValue: z.number().min(0),
  notes: optionalText(5000),
  internalNotes: optionalText(5000),
  items: z.array(proposalItemInput).min(1, 'Inclua ao menos um serviço').max(50),
};

const discountRule = (v: { discountType?: string; discountValue?: number }) =>
  v.discountType !== 'percent' || (v.discountValue ?? 0) <= 100;

export const createProposalInput = z
  .strictObject({
    ...proposalFields,
    periodicity: z.enum(PERIODICITIES).default('monthly'),
    discountType: z.enum(['none', 'percent', 'amount']).default('none'),
    discountValue: z.number().min(0).default(0),
  })
  .refine(discountRule, { message: 'Desconto percentual máximo de 100%', path: ['discountValue'] });
export type CreateProposalInput = z.infer<typeof createProposalInput>;

export const updateProposalInput = z
  .strictObject(proposalFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' })
  .refine(discountRule, { message: 'Desconto percentual máximo de 100%', path: ['discountValue'] });

export interface ProposalTotals {
  items: (ProposalItemInput & { totalCents: number })[];
  recurringSubtotalCents: number;
  discountCents: number;
  recurringTotalCents: number;
  oneTimeTotalCents: number;
}

/**
 * Cálculo único (servidor e tela): itens arredondados ao centavo; o desconto
 * incide sobre o valor recorrente e nunca o deixa negativo.
 */
export function computeProposalTotals(
  items: ProposalItemInput[],
  discountType: 'none' | 'percent' | 'amount',
  discountValue: number,
): ProposalTotals {
  const withTotals = items.map((i) => ({ ...i, totalCents: Math.round(i.quantity * i.unitPriceCents) }));
  const recurringSubtotalCents = withTotals.filter((i) => i.recurrence === 'recurring').reduce((a, i) => a + i.totalCents, 0);
  const oneTimeTotalCents = withTotals.filter((i) => i.recurrence === 'one_time').reduce((a, i) => a + i.totalCents, 0);
  let discountCents = 0;
  if (discountType === 'percent') discountCents = Math.round((recurringSubtotalCents * Math.min(discountValue, 100)) / 100);
  if (discountType === 'amount') discountCents = Math.round(discountValue);
  discountCents = Math.min(discountCents, recurringSubtotalCents);
  return { items: withTotals, recurringSubtotalCents, discountCents, recurringTotalCents: recurringSubtotalCents - discountCents, oneTimeTotalCents };
}

export const acceptProposalInput = z.strictObject({
  name: z.string().trim().min(3, 'Informe seu nome completo').max(160),
  agree: z.literal(true, { message: 'É preciso concordar com os termos da proposta' }),
});
export const rejectProposalInput = z.strictObject({ reason: optionalText(2000) });
export const manualAcceptInput = z.strictObject({ acceptedByName: z.string().trim().min(3).max(160), note: optionalText(1000) });

// ---------------------------------------------------------------- contratos
export const CONTRACT_STATUSES = ['active', 'suspended', 'ended', 'cancelled'] as const;
export const CONTRACT_STATUS_LABELS: Record<(typeof CONTRACT_STATUSES)[number], string> = {
  active: 'Ativo',
  suspended: 'Suspenso',
  ended: 'Encerrado',
  cancelled: 'Cancelado',
};
export const createContractInput = z.strictObject({
  title: z.string().trim().min(2).max(200),
  periodicity: z.enum(PERIODICITIES).default('monthly'),
  recurringAmountCents: cents,
  setupAmountCents: cents.default(0),
  startDate: z.iso.date(),
  endDate: z.iso.date().optional().nullable(),
  billingDay: z.number().int().min(1).max(28).default(10),
  services: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
});
/** Alterações diretas (não críticas). Valor e cancelamento passam por HITL. */
export const updateContractInput = z
  .strictObject({
    title: z.string().trim().min(2).max(200),
    endDate: z.iso.date().nullable(),
    billingDay: z.number().int().min(1).max(28),
    status: z.enum(['active', 'suspended', 'ended']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' });
export const changeValueInput = z.strictObject({ recurringAmountCents: cents, reason: z.string().trim().min(5).max(1000) });
export const cancelInput = z.strictObject({ reason: z.string().trim().min(5).max(1000) });

// ---------------------------------------------------------------- faturas, pagamentos, despesas
export const PAYMENT_METHODS = ['pix', 'boleto', 'transfer', 'card', 'cash', 'other'] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  pix: 'PIX',
  boleto: 'Boleto',
  transfer: 'Transferência',
  card: 'Cartão',
  cash: 'Dinheiro',
  other: 'Outro',
};
export const registerPaymentInput = z.strictObject({
  amountCents: z.number().int().positive(),
  paidAt: z.iso.date(),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(200),
});
export const createInvoiceInput = z.strictObject({
  description: z.string().trim().min(2).max(300),
  amountCents: z.number().int().positive(),
  dueDate: z.iso.date(),
  contractId: z.uuid().optional().nullable(),
});
export const listInvoicesQuery = z.strictObject({
  status: z.enum(['open', 'overdue', 'paid', 'cancelled']).optional(),
  contractId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const EXPENSE_CATEGORIES = ['infrastructure', 'ai', 'software', 'staff', 'freelancer', 'media', 'tax', 'marketing', 'other'] as const;
export const EXPENSE_CATEGORY_LABELS: Record<(typeof EXPENSE_CATEGORIES)[number], string> = {
  infrastructure: 'Infraestrutura',
  ai: 'IA',
  software: 'Software',
  staff: 'Equipe',
  freelancer: 'Freelancer',
  media: 'Mídia',
  tax: 'Impostos',
  marketing: 'Marketing',
  other: 'Outros',
};
export const createExpenseInput = z.strictObject({
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(2).max(300),
  supplier: optionalText(200),
  amountCents: z.number().int().positive(),
  incurredOn: z.iso.date(),
  /** Rateio direto para um cliente (opcional). */
  clientTenantId: z.uuid().optional().nullable(),
});
export const periodQuery = z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use AAAA-MM').optional() });

export const agencySettingsInput = z
  .strictObject({
    agencyName: z.string().trim().min(2).max(200),
    agencyDocument: optionalText(30),
    agencyAddress: optionalText(300),
    agencyEmail: optionalText(200),
    agencyPhone: optionalText(40),
    paymentInstructions: optionalText(2000),
    proposalFooter: optionalText(2000),
    marginAlertPercent: z.number().min(-100).max(100),
    invoiceLeadDays: z.number().int().min(0).max(60),
  })
  .partial();

export const decideActionInput = z.strictObject({ decision: z.enum(['approve', 'reject']), note: optionalText(1000) });
export const actionPolicyInput = z.strictObject({ requiresApproval: z.boolean(), allowSelfApproval: z.boolean() });

export const ACTION_LABELS: Record<string, string> = {
  'contract.change_value': 'Alterar valor do contrato',
  'contract.cancel': 'Cancelar contrato',
  'invoice.cancel': 'Cancelar fatura',
  'expense.delete': 'Excluir despesa',
};
