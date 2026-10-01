import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Variável opcional: string vazia (padrão do docker compose) conta como ausente. */
const optionalSecret = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Segredo para links assinados (propostas). Mínimo 32 caracteres; nunca reutilize em outro sistema. */
  APP_SECRET: z.string().min(32, 'APP_SECRET precisa de pelo menos 32 caracteres'),

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

  /** Diretório (volume) onde os arquivos ficam, organizados por tenant. */
  STORAGE_DIR: z.string().default('./data/storage'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2048).default(200),
  /** clamd (ClamAV). Sem host, os arquivos ficam com scan_status = 'skipped'. */
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  /** Chave da Anthropic (somente servidor). Sem ela, os agentes ficam em "integration_pending". */
  ANTHROPIC_API_KEY: optionalSecret,
  /** Modelo padrão dos agentes. */
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** Fallback do servidor da Anthropic quando o modelo recusa por política (beta). */
  AI_SERVER_FALLBACK: bool.default(true),
  AI_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(300_000),
  /** Chave da OpenAI usada SOMENTE para embeddings da memória (busca semântica). Opcional. */
  OPENAI_API_KEY: optionalSecret,
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  /** Chave (64 hex = 32 bytes) que cifra as credenciais das integrações. Sem ela, não é possível salvar segredos. */
  CREDENTIALS_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().regex(/^[0-9a-fA-F]{64}$/, 'CREDENTIALS_KEY precisa ter 64 caracteres hexadecimais (openssl rand -hex 32)').optional(),
  ),
  /** Permite integrações em endereços privados (ex.: n8n na mesma rede). Desligado: só hosts públicos e HTTPS. */
  MCP_ALLOW_PRIVATE_HOSTS: bool.default(false),

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
