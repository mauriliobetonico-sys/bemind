import type pg from 'pg';
import { withContext, SYSTEM } from '../db/pool';
import { generateToken, hashToken, safeEqual } from './tokens';
import type { Membership, Principal } from './access';

export interface SessionConfig {
  ttlHours: number;
  idleMinutes: number;
}

export interface CreatedSession {
  sessionId: string;
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

interface SessionRow {
  id: string;
  csrf_hash: Buffer;
  user_id: string;
  last_seen_at: Date;
  expires_at: Date;
  email: string;
  name: string;
  global_role: string | null;
}

export class SessionService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: SessionConfig,
  ) {}

  async create(userId: string, ip: string | null, userAgent: string | null): Promise<CreatedSession> {
    const token = generateToken();
    const csrfToken = generateToken();
    const expiresAt = new Date(Date.now() + this.config.ttlHours * 3600_000);
    const { id } = await withContext(this.pool, SYSTEM, async (tx) =>
      (
        await tx.query<{ id: string }>(
          `INSERT INTO sessions (token_hash, csrf_hash, user_id, ip, user_agent, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [hashToken(token), hashToken(csrfToken), userId, ip, userAgent?.slice(0, 500) ?? null, expiresAt],
        )
      ).rows[0]!,
    );
    return { sessionId: id, token, csrfToken, expiresAt };
  }

  /**
   * Valida o token e devolve o principal com suas associações. Sessões
   * revogadas, expiradas, ociosas ou de usuários desativados são rejeitadas.
   */
  async resolve(token: string): Promise<{ principal: Principal; csrfHash: Buffer } | null> {
    if (!token || token.length > 200) return null;
    return withContext(this.pool, SYSTEM, async (tx) => {
      const row = (
        await tx.query<SessionRow>(
          `SELECT s.id, s.csrf_hash, s.user_id, s.last_seen_at, s.expires_at, u.email, u.name, u.global_role
             FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
              AND u.status = 'active'`,
          [hashToken(token)],
        )
      ).rows[0];
      if (!row) return null;

      const idleMs = this.config.idleMinutes * 60_000;
      const sinceSeen = Date.now() - row.last_seen_at.getTime();
      if (sinceSeen > idleMs) {
        await tx.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [row.id]);
        return null;
      }
      if (sinceSeen > 60_000) {
        await tx.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.id]);
      }

      const memberships = (
        await tx.query<Membership>(
          `SELECT tu.tenant_id AS "tenantId", t.name AS "tenantName", t.kind AS "tenantKind",
                  t.status AS "tenantStatus", tu.role_key AS "roleKey"
             FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id
            WHERE tu.user_id = $1
            ORDER BY t.name`,
          [row.user_id],
        )
      ).rows;

      return {
        csrfHash: row.csrf_hash,
        principal: {
          userId: row.user_id,
          sessionId: row.id,
          email: row.email,
          name: row.name,
          globalRole: row.global_role,
          memberships,
        },
      };
    });
  }

  verifyCsrf(csrfHash: Buffer, provided: string | undefined): boolean {
    if (!provided || provided.length > 200) return false;
    return safeEqual(csrfHash, hashToken(provided));
  }

  async revoke(sessionId: string): Promise<void> {
    await withContext(this.pool, SYSTEM, (tx) =>
      tx.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]),
    );
  }

  async revokeAllForUser(userId: string, tx?: pg.PoolClient): Promise<void> {
    const sql = 'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL';
    if (tx) {
      await tx.query(sql, [userId]);
      return;
    }
    await withContext(this.pool, SYSTEM, (t) => t.query(sql, [userId]));
  }
}
