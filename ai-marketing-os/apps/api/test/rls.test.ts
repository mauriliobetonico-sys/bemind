/**
 * Isolamento no PRÓPRIO BANCO: mesmo que a API tivesse um bug, o role da
 * aplicação (aimos_app) não consegue ler nem escrever dados de outro tenant.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { withContext, type DbContext } from '../src/db/pool';
import { buildWorld, createTestEnv, type TestEnv, type World } from './helpers';

let env: TestEnv;
let w: World;
let pool: pg.Pool;

beforeAll(async () => {
  env = await createTestEnv();
  w = await buildWorld(env);
  pool = new pg.Pool({ connectionString: inject('appUrl'), max: 2 });
});
afterAll(async () => {
  await pool.end();
  await env.close();
});

const tenantA = (): DbContext => ({ scope: 'tenant', tenantIds: [w.clientA.tenantId] });

describe('RLS no PostgreSQL', () => {
  it('o role da aplicação não é superusuário nem tem BYPASSRLS', async () => {
    const r = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('sem contexto, nenhuma linha de nenhuma tabela de tenant é visível', async () => {
    for (const table of ['tenants', 'clients', 'client_events', 'tenant_users', 'users', 'sessions', 'password_tokens', 'audit_logs', 'outbox_events']) {
      const r = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(r.rows[0].n, table).toBe(0);
    }
  });

  it('contexto do tenant A enxerga somente A', async () => {
    const rows = await withContext(pool, tenantA(), async (tx) => (await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM clients')).rows);
    expect(rows.map((r) => r.tenant_id)).toEqual([w.clientA.tenantId]);
  });

  it('contexto de A não consegue inserir histórico no tenant B', async () => {
    await expect(
      withContext(pool, tenantA(), (tx) =>
        tx.query(`INSERT INTO client_events (tenant_id, client_id, type) VALUES ($1, $2, 'invasao')`, [w.clientB.tenantId, w.clientB.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('contexto de A não consegue mover o próprio cliente para o tenant B', async () => {
    await expect(
      withContext(pool, tenantA(), (tx) => tx.query('UPDATE clients SET tenant_id = $1 WHERE id = $2', [w.clientB.tenantId, w.clientA.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it('UPDATE/DELETE em linhas de B afeta zero linhas', async () => {
    const n = await withContext(pool, tenantA(), async (tx) => (await tx.query(`UPDATE clients SET notes = 'x' WHERE id = $1`, [w.clientB.id])).rowCount);
    expect(n).toBe(0);
  });

  it('FK composta impede histórico de A apontando para o cliente de B (mesmo em escopo global)', async () => {
    await expect(
      withContext(pool, { scope: 'global' }, (tx) =>
        tx.query(`INSERT INTO client_events (tenant_id, client_id, type) VALUES ($1, $2, 'cruzado')`, [w.clientA.tenantId, w.clientB.id]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('escopo tenant não lê sessões nem tokens de senha', async () => {
    const n = await withContext(pool, tenantA(), async (tx) => (await tx.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n);
    expect(n).toBe(0);
  });

  it('auditoria é append-only para a aplicação', async () => {
    await expect(withContext(pool, { scope: 'system' }, (tx) => tx.query('DELETE FROM audit_logs'))).rejects.toThrow(/permission denied/);
    await expect(withContext(pool, { scope: 'system' }, (tx) => tx.query(`UPDATE audit_logs SET action = 'x'`))).rejects.toThrow(/permission denied/);
  });

  it('a aplicação não pode alterar papéis e permissões', async () => {
    await expect(
      withContext(pool, { scope: 'system' }, (tx) => tx.query(`INSERT INTO role_permissions VALUES ('CLIENTE', 'audit:read')`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('contexto com tenant_id inválido é recusado antes de chegar ao banco', async () => {
    await expect(withContext(pool, { scope: 'tenant', tenantIds: ["x' OR 1=1 --"] }, async () => 1)).rejects.toThrow(/inválido/);
    await expect(withContext(pool, { scope: 'tenant', tenantIds: [] }, async () => 1)).rejects.toThrow(/vazio/);
  });

  it('o contexto não vaza entre transações na mesma conexão', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.scope', 'global', true)`);
      await client.query('COMMIT');
      const r = await client.query('SELECT count(*)::int AS n FROM clients');
      expect(r.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });
});
