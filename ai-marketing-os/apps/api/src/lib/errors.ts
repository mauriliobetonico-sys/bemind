import type { ZodType } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message = 'Requisição inválida', details?: unknown) =>
  new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Autenticação necessária') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Acesso negado') => new AppError(403, 'forbidden', message);
/** Usado também para recursos de outro tenant: não revela que o recurso existe. */
export const notFound = (message = 'Recurso não encontrado') => new AppError(404, 'not_found', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Dados inválidos',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

/** Postgres unique_violation */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}
