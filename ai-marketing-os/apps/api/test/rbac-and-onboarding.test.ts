import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, clientPayload, createTestEnv, drainOutbox, login, PASSWORD, seedUser, tokenFromEmail, type TestEnv, type World } from './helpers';

let env: TestEnv;
let w: World;

beforeAll(async () => {
  env = await createTestEnv();
  w = await buildWorld(env);
});
afterAll(() => env.close());

describe('RBAC', () => {
  it('somente papéis globais criam clientes (tenants:manage)', async () => {
    expect((await w.gestorA.post('/api/clients', clientPayload('Gama'))).statusCode).toBe(403);
    expect((await w.operadorA.post('/api/clients', clientPayload('Gama'))).statusCode).toBe(403);
    expect((await w.userA.post('/api/clients', clientPayload('Gama'))).statusCode).toBe(403);
  });

  it('negações de permissão são auditadas', async () => {
    await w.operadorA.get('/api/audit');
    const r = await env.admin.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE actor_user_id = $1 AND action = 'security.permission_denied'`,
      [w.operadorA.userId],
    );
    expect(r.rows[0].n).toBeGreaterThan(0);
  });

  it('ADMIN não cria SUPER_ADMIN nem se promove', async () => {
    expect((await w.admin.post('/api/users', { name: 'Novo', email: 'novo-super@teste.dev', globalRole: 'SUPER_ADMIN' })).statusCode).toBe(403);
    expect((await w.admin.patch(`/api/users/${w.admin.userId}`, { globalRole: 'SUPER_ADMIN' })).statusCode).toBe(400);
  });

  it('ADMIN não altera um SUPER_ADMIN', async () => {
    expect((await w.admin.patch(`/api/users/${w.superAdmin.userId}`, { status: 'disabled' })).statusCode).toBe(403);
  });

  it('SUPER_ADMIN cria ADMIN e o convite é enviado', async () => {
    env.mailer.sent.length = 0;
    const res = await w.superAdmin.post('/api/users', { name: 'Nova Admin', email: 'nova-admin@teste.dev', globalRole: 'ADMIN' });
    expect(res.statusCode).toBe(201);
    await drainOutbox(env);
    expect(env.mailer.sent.map((m) => m.to)).toContain('nova-admin@teste.dev');
  });

  it('associação de equipe dá acesso só ao tenant atribuído', async () => {
    const u = await seedUser(env.admin, { name: 'Operadora B' });
    expect((await w.admin.put(`/api/users/${u.id}/memberships`, { tenantId: w.clientB.tenantId, roleKey: 'OPERADOR' })).statusCode).toBe(200);
    const op = await login(env.app, u.email);
    expect((await op.get(`/api/clients/${w.clientB.id}`)).statusCode).toBe(200);
    expect((await op.get(`/api/clients/${w.clientA.id}`)).statusCode).toBe(404);
    expect((await w.admin.delete(`/api/users/${u.id}/memberships/${w.clientB.tenantId}`)).statusCode).toBe(204);
    expect((await op.get(`/api/clients/${w.clientB.id}`)).statusCode).toBe(403);
  });

  it('administrador não pode virar usuário CLIENTE', async () => {
    const res = await w.superAdmin.put(`/api/users/${w.admin.userId}/memberships`, { tenantId: w.clientA.tenantId, roleKey: 'CLIENTE' });
    expect(res.statusCode).toBe(400);
  });

  it('o tenant da agência não pode ser suspenso', async () => {
    const tenants = (await w.admin.get('/api/tenants')).json() as { items: { id: string; kind: string }[] };
    const agency = tenants.items.find((t) => t.kind === 'agency')!;
    expect((await w.admin.patch(`/api/tenants/${agency.id}`, { status: 'suspended' })).statusCode).toBe(400);
  });
});

describe('Onboarding automático', () => {
  it('criar cliente provisiona tenant, usuário convidado, associação, histórico, eventos e auditoria', async () => {
    const payload = clientPayload('Delta', { cnpj: '11.222.333/0001-81', status: 'onboarding' });
    const res = await w.admin.post('/api/clients', payload);
    expect(res.statusCode).toBe(201);
    const client = res.json() as { id: string; tenantId: string; cnpj: string; tenantStatus: string };
    expect(client.cnpj).toBe('11222333000181');
    expect(client.tenantStatus).toBe('onboarding');

    const user = (await env.admin.query(`SELECT id, status, password_hash FROM users WHERE email = $1`, [payload.email])).rows[0];
    expect(user.status).toBe('invited');
    expect(user.password_hash).toBeNull();
    const membership = (await env.admin.query(`SELECT role_key FROM tenant_users WHERE user_id = $1 AND tenant_id = $2`, [user.id, client.tenantId])).rows[0];
    expect(membership.role_key).toBe('CLIENTE');
    const events = (await env.admin.query(`SELECT type FROM outbox_events WHERE tenant_id = $1 ORDER BY created_at`, [client.tenantId])).rows.map((r) => r.type);
    expect(events).toEqual(expect.arrayContaining(['user.invite', 'client.created']));
    const audit = (await env.admin.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'client.create' AND resource_id = $1`, [client.id])).rows[0];
    expect(audit.n).toBe(1);

    // O token do convite não existe em claro no banco (nem no outbox).
    const outboxText = (await env.admin.query(`SELECT payload::text AS p FROM outbox_events WHERE tenant_id = $1`, [client.tenantId])).rows.map((r) => r.p).join(' ');
    expect(outboxText).not.toMatch(/token/i);

    env.mailer.sent.length = 0;
    await drainOutbox(env);
    const mail = env.mailer.sent.find((m) => m.to === payload.email)!;
    expect(mail.subject).toContain('Delta');
    expect(mail.text).toContain('Plano contratado: PRO');
    expect(mail.text).toContain('https://app.test');
    expect(mail.text).not.toMatch(/senha:\s*\S+/i);

    const set = await env.app.inject({ method: 'POST', url: '/api/auth/password/set', payload: { token: tokenFromEmail(mail.text), password: PASSWORD } });
    expect(set.statusCode).toBe(204);
    const agent = await login(env.app, payload.email);
    const overview = (await agent.get('/api/portal/overview')).json() as { client: { id: string } };
    expect(overview.client.id).toBe(client.id);
  });

  it('CNPJ duplicado → 409 e nada é provisionado (transação única)', async () => {
    const before = (await env.admin.query(`SELECT count(*)::int AS n FROM tenants`)).rows[0].n;
    const res = await w.admin.post('/api/clients', clientPayload('Delta Clone', { cnpj: '11222333000181' }));
    expect(res.statusCode).toBe(409);
    const after = (await env.admin.query(`SELECT count(*)::int AS n FROM tenants`)).rows[0].n;
    expect(after).toBe(before);
  });

  it('falha de SMTP não perde o convite: retry com backoff e novo link', async () => {
    const payload = clientPayload('Épsilon');
    expect((await w.admin.post('/api/clients', payload)).statusCode).toBe(201);
    env.mailer.sent.length = 0;
    env.mailer.failNext = 1;
    const first = await drainOutbox(env);
    expect(first.failed).toBeGreaterThan(0);
    const pending = (
      await env.admin.query(`SELECT status, attempts, last_error FROM outbox_events WHERE type = 'user.invite' AND payload->>'userId' = (SELECT id::text FROM users WHERE email = $1)`, [payload.email])
    ).rows[0];
    expect(pending.status).toBe('pending');
    expect(pending.last_error).toContain('SMTP');
    await env.admin.query(`UPDATE outbox_events SET available_at = now() WHERE status = 'pending'`);
    await drainOutbox(env);
    expect(env.mailer.sent.some((m) => m.to === payload.email)).toBe(true);
  });

  it('atualização registra histórico com o que mudou', async () => {
    const res = await w.admin.patch(`/api/clients/${w.clientA.id}`, { monthlyFeeCents: 410000, segment: 'Varejo' });
    expect(res.statusCode).toBe(200);
    const events = (await w.admin.get(`/api/clients/${w.clientA.id}/events`)).json() as { items: { type: string; data: { changes?: Record<string, unknown> } }[] };
    const last = events.items[0]!;
    expect(last.type).toBe('client.updated');
    expect(Object.keys(last.data.changes!)).toEqual(expect.arrayContaining(['monthlyFeeCents', 'segment']));
  });

  it('painel administrativo calcula MRR a partir dos contratos ativos e traz o bloco real de agentes', async () => {
    const res = await w.admin.get('/api/dashboard/admin');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { revenue: { mrrCents: number }; pendingModules: { phase: number }[]; ai: { status: string; costThisMonthUsdMicros: number | null } };
    const sum = (await env.admin.query(`SELECT coalesce(sum(round(recurring_amount_cents / CASE periodicity WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 ELSE 1 END)),0)::bigint AS s FROM contracts WHERE status = 'active'`)).rows[0].s;
    expect(body.revenue.mrrCents).toBe(Number(sum));
    expect(body.pendingModules).toEqual([]);
    expect(body.ai.status).toBe('integration_pending'); // ambiente de teste sem chave
    expect(typeof body.ai.costThisMonthUsdMicros).toBe('number');
  });
});
