import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PERMISSIONS, SYSTEM_ROLES } from '@aimos/shared';

export const APP_ROLE = 'aimos_app';

function migrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db → ../../migrations ; dist → ../migrations
  for (const candidate of [path.resolve(here, '../../migrations'), path.resolve(here, '../migrations')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Diretório de migrations não encontrado (defina MIGRATIONS_DIR)');
}

export interface MigrateOptions {
  adminUrl: string;
  appPassword?: string;
  log?: (msg: string) => void;
}

/**
 * Aplica migrations pendentes usando a conexão ADMINISTRATIVA e sincroniza
 * o catálogo de papéis/permissões. Idempotente.
 */
export async function migrate({ adminUrl, appPassword, log = console.log }: MigrateOptions): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await ensureAppRole(client, appPassword);

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );

    const dir = migrationsDir();
    const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), 'utf8');
      log(`aplicando ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha em ${file}: ${(err as Error).message}`);
      }
    }

    await syncCatalog(client);
    await ensureAgencyTenant(client);
    log('migrations concluídas');
  } finally {
    await client.end();
  }
}

async function ensureAppRole(client: pg.Client, password?: string): Promise<void> {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
  if (exists.rowCount === 0) {
    if (!password) throw new Error('APP_DB_PASSWORD é obrigatório para criar o role da aplicação');
    await client.query(`CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  }
  // Mesmo que alguém altere o role manualmente, a migração restaura as garantias.
  await client.query(`ALTER ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  if (password) {
    const escaped = (await client.query<{ q: string }>('SELECT quote_literal($1) AS q', [password])).rows[0]!.q;
    await client.query(`ALTER ROLE ${APP_ROLE} PASSWORD ${escaped}`);
  }
}

async function syncCatalog(client: pg.Client): Promise<void> {
  await client.query('BEGIN');
  try {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await client.query(
        `INSERT INTO permissions (key, description) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
        [key, description],
      );
    }
    for (const role of SYSTEM_ROLES) {
      await client.query(
        `INSERT INTO roles (key, name, scope, is_system) VALUES ($1, $2, $3, true)
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, scope = EXCLUDED.scope, is_system = true`,
        [role.key, role.name, role.scope],
      );
      // Papéis de sistema são redefinidos a partir do código.
      await client.query('DELETE FROM role_permissions WHERE role_key = $1', [role.key]);
      for (const perm of role.permissions) {
        await client.query('INSERT INTO role_permissions (role_key, permission_key) VALUES ($1, $2)', [role.key, perm]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function ensureAgencyTenant(client: pg.Client): Promise<void> {
  await client.query(
    `INSERT INTO tenants (kind, name, slug, status) VALUES ('agency', 'Agência', 'agencia', 'active')
     ON CONFLICT (slug) DO NOTHING`,
  );
}
