import { z } from 'zod';
import { emailSchema } from './auth';

export const CLIENT_STATUSES = ['prospect', 'onboarding', 'active', 'paused', 'churned'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  prospect: 'Prospect',
  onboarding: 'Onboarding',
  active: 'Ativo',
  paused: 'Pausado',
  churned: 'Encerrado',
};

export const PLANS = ['START', 'PRO', 'BUSINESS', 'ENTERPRISE'] as const;
export type Plan = (typeof PLANS)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/** Aceita CNPJ com ou sem máscara; valida dígitos verificadores. */
export const cnpjSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => isValidCnpj(v), { message: 'CNPJ inválido' });

export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}

export const addressSchema = z.strictObject({
  street: optionalText(200),
  number: optionalText(20),
  complement: optionalText(100),
  district: optionalText(100),
  city: optionalText(100),
  state: optionalText(2),
  zip: optionalText(9),
});

const clientFields = {
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().min(2).max(200),
  cnpj: cnpjSchema.optional(),
  responsibleName: z.string().trim().min(2).max(160),
  phone: optionalText(30),
  email: emailSchema,
  address: addressSchema.optional(),
  segment: optionalText(100),
  niche: optionalText(100),
  plan: z.enum(PLANS),
  status: z.enum(CLIENT_STATUSES),
  monthlyFeeCents: z.number().int().min(0).max(100_000_000_00),
  startDate: z.iso.date().optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
  notes: optionalText(5000),
};

export const createClientInput = z.strictObject({
  ...clientFields,
  status: z.enum(CLIENT_STATUSES).default('onboarding'),
  /** Quando verdadeiro, cria o usuário CLIENTE e envia o convite de primeiro acesso. */
  inviteUser: z.boolean().default(true),
});
export type CreateClientInput = z.infer<typeof createClientInput>;

export const updateClientInput = z
  .strictObject(clientFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' });
export type UpdateClientInput = z.infer<typeof updateClientInput>;

export const listClientsQuery = z.strictObject({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
