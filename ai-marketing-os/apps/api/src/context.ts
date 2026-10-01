import type pg from 'pg';
import type { Env } from './config/env';
import type { RolePermissionCache } from './security/access';
import type { SessionService } from './security/sessions';
import type { AuditService } from './modules/audit/audit';
import type { Mailer } from './mail/mailer';

/** Dependências compartilhadas pela API e pelo worker. */
export interface AppContext {
  env: Env;
  pool: pg.Pool;
  sessions: SessionService;
  audit: AuditService;
  rolePermissions: RolePermissionCache;
  mailer: Mailer;
}
