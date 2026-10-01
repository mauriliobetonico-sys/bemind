import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** URL pública da plataforma (usada em e-mails e na checagem de Origin). */
  APP_URL: z.url(),

  /** Conexão da aplicação: role aimos_app, sem BYPASSRLS. */
  DATABASE_URL: z.string().min(1),
  /** Conexão administrativa: usada SOMENTE pelo script de migração. */
  DATABASE_ADMIN_URL: z.string().min(1).optional(),
  /** Senha atribuída ao role aimos_app durante a migração. */
  APP_DB_PASSWORD: z.string().min(16).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  REDIS_URL: z.string().optional(),

  COOKIE_SECURE: bool.default(true),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).default(120),
  INVITE_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(72),
  RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(300),
  /** Limite por IP para login, definição e recuperação de senha. */
  AUTH_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  TRUST_PROXY: bool.default(false),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('AI Marketing OS <no-reply@localhost>'),
  SUPPORT_EMAIL: z.string().default('suporte@localhost'),

  OUTBOX_POLL_MS: z.coerce.number().int().min(200).default(2000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE=false não é permitido em produção');
  }
  return env;
}
