import { loadEnv, type Env } from './config/env';
import { createPool } from './db/pool';
import type { AppContext } from './context';
import { RolePermissionCache } from './security/access';
import { SessionService } from './security/sessions';
import { AuditService } from './modules/audit/audit';
import { SmtpMailer, type Mailer } from './mail/mailer';
import { LocalStorage } from './storage/storage';

export function createContext(overrides: { env?: Env; mailer?: Mailer; storage?: LocalStorage } = {}): AppContext {
  const env = overrides.env ?? loadEnv();
  const pool = createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  return {
    env,
    pool,
    sessions: new SessionService(pool, { ttlHours: env.SESSION_TTL_HOURS, idleMinutes: env.SESSION_IDLE_MINUTES }),
    audit: new AuditService(pool),
    rolePermissions: new RolePermissionCache(pool),
    mailer: overrides.mailer ?? new SmtpMailer(env),
    storage: overrides.storage ?? new LocalStorage(env.STORAGE_DIR),
  };
}
