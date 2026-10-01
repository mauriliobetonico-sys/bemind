import pg from 'pg';

export type Scope = 'system' | 'global' | 'tenant';

/**
 * Contexto de acesso aplicado a uma transação. É sempre construído no
 * servidor (security/access.ts) — nunca a partir de dados do cliente.
 */
export interface DbContext {
  scope: Scope;
  /** Obrigatório (e não vazio) quando scope = 'tenant'. */
  tenantIds?: readonly string[];
  userId?: string | null;
}

export type Tx = pg.PoolClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, statement_timeout: 15_000 });
  // bigint (int8) chega como string; valores monetários são convertidos explicitamente.
  return pool;
}

/**
 * Executa `fn` dentro de uma transação com o contexto de RLS definido via
 * SET LOCAL. Toda leitura/escrita de dados de negócio passa por aqui.
 */
export async function withContext<T>(pool: pg.Pool, ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let tenantIds = '';
  if (ctx.scope === 'tenant') {
    const ids = ctx.tenantIds ?? [];
    if (ids.length === 0) throw new Error('Contexto de tenant vazio');
    for (const id of ids) {
      if (!UUID_RE.test(id)) throw new Error('tenant_id inválido no contexto');
    }
    tenantIds = ids.join(',');
  }
  if (ctx.userId && !UUID_RE.test(ctx.userId)) throw new Error('user_id inválido no contexto');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.scope', $1, true),
              set_config('app.tenant_ids', $2, true),
              set_config('app.user_id', $3, true)`,
      [ctx.scope, tenantIds, ctx.userId ?? ''],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export const SYSTEM: DbContext = { scope: 'system' };
