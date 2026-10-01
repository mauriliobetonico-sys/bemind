import { z } from 'zod';
import { emailSchema } from './auth';

export const createStaffUserInput = z.strictObject({
  name: z.string().trim().min(2).max(160),
  email: emailSchema,
  /** Papel global (ADMIN) ou nenhum (o acesso vem das associações). */
  globalRole: z.enum(['SUPER_ADMIN', 'ADMIN']).nullable().default(null),
});
export type CreateStaffUserInput = z.infer<typeof createStaffUserInput>;

export const updateUserInput = z
  .strictObject({
    name: z.string().trim().min(2).max(160),
    status: z.enum(['active', 'disabled']),
    globalRole: z.enum(['SUPER_ADMIN', 'ADMIN']).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' });

export const membershipInput = z.strictObject({
  tenantId: z.uuid(),
  roleKey: z.enum(['GESTOR', 'OPERADOR', 'CLIENTE']),
});
export type MembershipInput = z.infer<typeof membershipInput>;

export const uuidParam = z.strictObject({ id: z.uuid() });
