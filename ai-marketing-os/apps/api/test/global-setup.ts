import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/db/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
    appUrl: string;
  }
}

/**
 * Cria um banco PostgreSQL descartável, aplica as migrations e expõe duas
 * URLs: administrativa (superusuário, só para fixtures) e da aplicação
 * (role aimos_app, sujeito a RLS — exatamente como em produção).
 */
export default async function setup(project: TestProject) {
  const baseAdmin = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres@localhost:5433/postgres';
  const dbName = `aimos_test_${randomBytes(4).toString('hex')}`;
  const appPassword = `test_${randomBytes(12).toString('hex')}`;

  const root = new pg.Client({ connectionString: baseAdmin });
  await root.connect();
  await root.query(`CREATE DATABASE ${dbName}`);
  await root.end();

  const adminUrl = withDatabase(baseAdmin, dbName);
  await migrate({ adminUrl, appPassword, log: () => undefined });

  const appUrl = new URL(adminUrl);
  appUrl.username = 'aimos_app';
  appUrl.password = appPassword;

  project.provide('adminUrl', adminUrl);
  project.provide('appUrl', appUrl.toString());

  return async () => {
    const r = new pg.Client({ connectionString: baseAdmin });
    await r.connect();
    await r.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await r.end();
  };
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
