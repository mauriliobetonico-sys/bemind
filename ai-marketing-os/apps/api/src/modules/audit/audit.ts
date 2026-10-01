import type pg from 'pg';
import { withContext, SYSTEM, type Tx } from '../../db/pool';

export interface AuditEntry {
  action: string;
  result: 'success' | 'denied' | 'failure';
  tenantId?: string | null;
  actorUserId?: string | null;
  resourceType?: string;
  resourceId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEYS = /password|token|secret|hash|authorization|cookie/i;

/** Remove campos sensíveis antes de persistir metadados. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export class AuditService {
  constructor(private readonly pool: pg.Pool) {}

  /** Grava na transação do chamador: o registro some se a operação for desfeita. */
  async recordIn(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.query(
      `INSERT INTO audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, result, ip, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.tenantId ?? null,
        entry.actorUserId ?? null,
        entry.action,
        entry.resourceType ?? null,
        entry.resourceId ?? null,
        entry.result,
        entry.ip ?? null,
        entry.userAgent?.slice(0, 500) ?? null,
        JSON.stringify(redact(entry.metadata ?? {})),
      ],
    );
  }

  /** Grava em transação própria (ex.: login negado, acesso negado). Nunca lança. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await withContext(this.pool, SYSTEM, (tx) => this.recordIn(tx, entry));
    } catch (err) {
      console.error('falha ao gravar auditoria', (err as Error).message);
    }
  }
}
