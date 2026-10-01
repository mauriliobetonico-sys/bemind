import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp } from '../src/app';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createContext } from '../src/bootstrap';
import { loadEnv } from '../src/config/env';
import type { AppContext } from '../src/context';
import { MemoryMailer } from '../src/mail/mailer';
import { hashPassword } from '../src/security/password';
import { processOutbox } from '../src/outbox/outbox';
import { outboxHandlers } from '../src/outbox/handlers';

export const PASSWORD = 'senha-de-teste-super-longa';
export const APP_URL = 'https://app.test';

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  mailer: MemoryMailer;
  admin: pg.Pool;
  close: () => Promise<void>;
}

export async function createTestEnv(overrides: Record<string, string> = {}): Promise<TestEnv> {
  const mailer = new MemoryMailer();
  const env = loadEnv({
    NODE_ENV: 'test',
    APP_URL,
    APP_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    DATABASE_URL: inject('appUrl'),
    COOKIE_SECURE: 'true',
    AUTH_RATE_PER_MINUTE: '10000',
    RATE_LIMIT_PER_MINUTE: '100000',
    STORAGE_DIR: mkdtempSync(path.join(tmpdir(), 'aimos-storage-')),
    ...overrides,
  });
  const ctx = createContext({ env, mailer });
  const app = await buildApp(ctx);
  await app.ready();
  const admin = new pg.Pool({ connectionString: inject('adminUrl'), max: 2 });
  return {
    app,
    ctx,
    mailer,
    admin,
    close: async () => {
      await app.close();
      await ctx.pool.end();
      await admin.end();
    },
  };
}

export const uid = () => randomBytes(4).toString('hex');

/** Fixture direta no banco (superusuário): só para preparar cenários. */
export async function seedUser(
  admin: pg.Pool,
  opts: { name?: string; globalRole?: string | null; memberships?: { tenantId: string; roleKey: string }[]; status?: string } = {},
): Promise<{ id: string; email: string }> {
  const email = `u-${uid()}@teste.dev`;
  const hash = await hashPassword(PASSWORD);
  const { id } = (
    await admin.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, global_role, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [email, opts.name ?? 'Usuário Teste', hash, opts.globalRole ?? null, opts.status ?? 'active'],
    )
  ).rows[0]!;
  for (const m of opts.memberships ?? []) {
    await admin.query('INSERT INTO tenant_users (tenant_id, user_id, role_key) VALUES ($1, $2, $3)', [m.tenantId, id, m.roleKey]);
  }
  return { id, email };
}

/** Cliente HTTP autenticado: carrega cookies de sessão e o token CSRF. */
export class Agent {
  constructor(
    private readonly app: FastifyInstance,
    readonly cookie: string,
    readonly csrf: string,
    readonly userId: string,
  ) {}

  request(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string>; csrf?: boolean } = {}) {
    const headers: Record<string, string> = { cookie: this.cookie, ...opts.headers };
    if (method !== 'GET' && opts.csrf !== false) headers['x-csrf-token'] = this.csrf;
    return this.app.inject({ method, url, headers, payload: opts.body as never });
  }
  get(url: string, headers?: Record<string, string>) {
    return this.request('GET', url, { headers });
  }
  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', url, { body: body ?? {}, headers });
  }
  patch(url: string, body: unknown, headers?: Record<string, string>) {
    return this.request('PATCH', url, { body, headers });
  }
  put(url: string, body: unknown, headers?: Record<string, string>) {
    return this.request('PUT', url, { body, headers });
  }
  delete(url: string, headers?: Record<string, string>) {
    return this.request('DELETE', url, { headers });
  }
}

export function cookieHeader(res: LightMyRequestResponse): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD): Promise<Agent> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login falhou (${res.statusCode}): ${res.body}`);
  const body = res.json() as { csrfToken: string; user: { id: string } };
  return new Agent(app, cookieHeader(res), body.csrfToken, body.user.id);
}

export function clientPayload(name: string, extra: Record<string, unknown> = {}) {
  return {
    legalName: `${name} Comércio LTDA`,
    tradeName: name,
    responsibleName: `Responsável ${name}`,
    email: `contato-${uid()}@${name.toLowerCase().replace(/\W/g, '')}.dev`,
    plan: 'PRO',
    status: 'active',
    monthlyFeeCents: 250000,
    ...extra,
  };
}

/** Processa o outbox até esvaziar (vários lotes), somando os resultados. */
export async function drainOutbox(env: TestEnv) {
  const handlers = outboxHandlers(env.ctx);
  const total = { processed: 0, failed: 0, dead: 0 };
  for (let i = 0; i < 50; i++) {
    const r = await processOutbox(env.ctx.pool, handlers, { maxAttempts: env.ctx.env.OUTBOX_MAX_ATTEMPTS });
    total.processed += r.processed;
    total.failed += r.failed;
    total.dead += r.dead;
    if (r.processed + r.failed + r.dead === 0) break;
  }
  return total;
}

export function tokenFromEmail(text: string): string {
  const m = text.match(/set-password\?token=([A-Za-z0-9_\-%]+)/);
  if (!m) throw new Error('token não encontrado no e-mail');
  return decodeURIComponent(m[1]!);
}

export interface World {
  superAdmin: Agent;
  admin: Agent;
  clientA: { id: string; tenantId: string };
  clientB: { id: string; tenantId: string };
  userA: Agent;
  userB: Agent;
  gestorA: Agent;
  operadorA: Agent;
}

/**
 * Cenário padrão: dois clientes criados PELA API (provisionamento real),
 * usuários CLIENTE ativados pelo link do e-mail de boas-vindas, e equipe
 * interna com associações restritas ao cliente A.
 */
export async function buildWorld(env: TestEnv): Promise<World> {
  const sa = await seedUser(env.admin, { name: 'Super', globalRole: 'SUPER_ADMIN' });
  const ad = await seedUser(env.admin, { name: 'Admin', globalRole: 'ADMIN' });
  const superAdmin = await login(env.app, sa.email);
  const admin = await login(env.app, ad.email);

  const create = async (name: string) => {
    const payload = clientPayload(name);
    const res = await admin.post('/api/clients', payload);
    if (res.statusCode !== 201) throw new Error(`criar cliente falhou: ${res.body}`);
    const body = res.json() as { id: string; tenantId: string };
    return { ...body, email: payload.email };
  };
  const a = await create(`Alfa ${uid()}`);
  const b = await create(`Beta ${uid()}`);

  env.mailer.sent.length = 0;
  await drainOutbox(env);
  const activate = async (email: string) => {
    const mail = env.mailer.sent.find((m) => m.to === email);
    if (!mail) throw new Error(`e-mail de boas-vindas não enviado para ${email}`);
    const res = await env.app.inject({ method: 'POST', url: '/api/auth/password/set', payload: { token: tokenFromEmail(mail.text), password: PASSWORD } });
    if (res.statusCode !== 204) throw new Error(`ativação falhou: ${res.body}`);
    return login(env.app, email);
  };
  const userA = await activate(a.email);
  const userB = await activate(b.email);

  const g = await seedUser(env.admin, { name: 'Gestor A', memberships: [{ tenantId: a.tenantId, roleKey: 'GESTOR' }] });
  const o = await seedUser(env.admin, { name: 'Operador A', memberships: [{ tenantId: a.tenantId, roleKey: 'OPERADOR' }] });

  return {
    superAdmin,
    admin,
    clientA: { id: a.id, tenantId: a.tenantId },
    clientB: { id: b.id, tenantId: b.tenantId },
    userA,
    userB,
    gestorA: await login(env.app, g.email),
    operadorA: await login(env.app, o.email),
  };
}

/** PNG 1×1 válido (assinatura real, detectável pelo conteúdo). */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Monta um corpo multipart/form-data para app.inject. */
export function multipart(files: { name: string; content: Buffer }[]) {
  const boundary = `----aimos${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      f.content,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
