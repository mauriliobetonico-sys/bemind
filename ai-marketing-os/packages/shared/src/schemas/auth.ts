import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'E-mail inválido' }));

/** Política mínima: 12+ caracteres, sem limite superior baixo (máx. 256 evita DoS no hash). */
export const passwordSchema = z
  .string()
  .min(12, 'A senha precisa ter pelo menos 12 caracteres')
  .max(256, 'Senha longa demais');

export const loginInput = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginInput>;

export const setPasswordInput = z.strictObject({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type SetPasswordInput = z.infer<typeof setPasswordInput>;

export const forgotPasswordInput = z.strictObject({ email: emailSchema });
