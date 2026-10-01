import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieHeader, createTestEnv, drainOutbox, login, PASSWORD, seedUser, tokenFromEmail, type TestEnv } from './helpers';

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv({ LOGIN_MAX_FAILURES: '3' });
});
afterAll(() => env.close());

const doLogin = (email: string, password: string) =>
  env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

describe('login', () => {
  it('autentica e define cookies seguros', async () => {
    const u = await seedUser(env.admin);
    const res = await doLogin(u.email, PASSWORD);
    expect(res.statusCode).toBe(200);
    const session = res.cookies.find((c) => c.name === '__Host-aimos_session')!;
    expect(session.httpOnly).toBe(true);
    expect(session.secure).toBe(true);
    expect(session.sameSite).toBe('Strict');
    expect(session.path).toBe('/');
    expect(res.json().csrfToken).toBeTypeOf('string');
    // A senha nunca volta na resposta.
    expect(res.body).not.toContain('password');
  });

  it('o token de sessão não é armazenado em claro', async () => {
    const u = await seedUser(env.admin);
    const res = await doLogin(u.email, PASSWORD);
    const token = res.cookies.find((c) => c.name === '__Host-aimos_session')!.value;
    const r = await env.admin.query(`SELECT count(*)::int AS n FROM sessions WHERE encode(token_hash, 'escape') LIKE $1`, [`%${token}%`]);
    expect(r.rows[0].n).toBe(0);
  });

  it('mesma resposta para senha errada e e-mail inexistente', async () => {
    const u = await seedUser(env.admin);
    const wrong = await doLogin(u.email, 'senha-errada-qualquer');
    const unknown = await doLogin('ninguem@teste.dev', 'senha-errada-qualquer');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('bloqueia a conta após falhas consecutivas, mesmo com a senha certa', async () => {
    const u = await seedUser(env.admin);
    for (let i = 0; i < 3; i++) expect((await doLogin(u.email, 'senha-errada-qualquer')).statusCode).toBe(401);
    expect((await doLogin(u.email, PASSWORD)).statusCode).toBe(401);
    const audit = await env.admin.query(`SELECT metadata->>'reason' AS reason FROM audit_logs WHERE actor_user_id = $1 ORDER BY id DESC LIMIT 1`, [u.id]);
    expect(audit.rows[0].reason).toBe('locked');
  });

  it('usuário desativado não entra', async () => {
    const u = await seedUser(env.admin, { status: 'disabled' });
    expect((await doLogin(u.email, PASSWORD)).statusCode).toBe(401);
  });

  it('rejeita campos extras no corpo', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.dev', password: 'x', role: 'SUPER_ADMIN' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('sessão e CSRF', () => {
  it('rotas protegidas exigem sessão', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await env.app.inject({ method: 'GET', url: '/api/clients', headers: { cookie: '__Host-aimos_session=forjado' } })).statusCode).toBe(401);
  });

  it('requisição que altera estado sem token CSRF → 403', async () => {
    const u = await seedUser(env.admin, { globalRole: 'ADMIN' });
    const agent = await login(env.app, u.email);
    const res = await agent.request('POST', '/api/users', { body: { name: 'X', email: 'x@y.dev' }, csrf: false });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf');
    const res2 = await agent.request('POST', '/api/users', { body: { name: 'X', email: 'x@y.dev' }, csrf: false, headers: { 'x-csrf-token': 'invalido' } });
    expect(res2.statusCode).toBe(403);
  });

  it('origem cruzada é recusada', async () => {
    const u = await seedUser(env.admin, { globalRole: 'ADMIN' });
    const agent = await login(env.app, u.email);
    const res = await agent.post('/api/users', { name: 'X', email: 'x2@y.dev' }, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
  });

  it('logout revoga a sessão no servidor', async () => {
    const u = await seedUser(env.admin);
    const agent = await login(env.app, u.email);
    expect((await agent.get('/api/auth/me')).statusCode).toBe(200);
    expect((await agent.post('/api/auth/logout')).statusCode).toBe(204);
    expect((await agent.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('desativar o usuário derruba as sessões abertas', async () => {
    const adm = await login(env.app, (await seedUser(env.admin, { globalRole: 'ADMIN' })).email);
    const u = await seedUser(env.admin);
    const agent = await login(env.app, u.email);
    expect((await adm.patch(`/api/users/${u.id}`, { status: 'disabled' })).statusCode).toBe(200);
    expect((await agent.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('sessão expirada por ociosidade é rejeitada', async () => {
    const u = await seedUser(env.admin);
    const agent = await login(env.app, u.email);
    await env.admin.query(`UPDATE sessions SET last_seen_at = now() - interval '1 day' WHERE user_id = $1`, [u.id]);
    expect((await agent.get('/api/auth/me')).statusCode).toBe(401);
  });
});

describe('recuperação de senha', () => {
  it('resposta idêntica para e-mail existente e inexistente; link é de uso único', async () => {
    const u = await seedUser(env.admin);
    env.mailer.sent.length = 0;
    const a = await env.app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: u.email } });
    const b = await env.app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'nao-existe@teste.dev' } });
    expect(a.statusCode).toBe(202);
    expect(a.body).toBe(b.body);

    await drainOutbox(env);
    const mail = env.mailer.sent.find((m) => m.to === u.email)!;
    expect(mail).toBeDefined();
    expect(env.mailer.sent.some((m) => m.to === 'nao-existe@teste.dev')).toBe(false);

    const token = tokenFromEmail(mail.text);
    const newPassword = 'nova-senha-bem-comprida';
    const set = (t: string) => env.app.inject({ method: 'POST', url: '/api/auth/password/set', payload: { token: t, password: newPassword } });
    expect((await set(token)).statusCode).toBe(204);
    expect((await set(token)).statusCode).toBe(400);
    expect((await doLogin(u.email, newPassword)).statusCode).toBe(200);
    expect((await doLogin(u.email, PASSWORD)).statusCode).toBe(401);
  });

  it('rejeita senha curta', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/auth/password/set', payload: { token: 'x'.repeat(43), password: 'curta' } });
    expect(res.statusCode).toBe(400);
  });

  it('cookie de sessão antigo deixa de valer após troca de senha', async () => {
    const u = await seedUser(env.admin);
    const res = await doLogin(u.email, PASSWORD);
    const cookie = cookieHeader(res);
    env.mailer.sent.length = 0;
    await env.app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: u.email } });
    await drainOutbox(env);
    const token = tokenFromEmail(env.mailer.sent.find((m) => m.to === u.email)!.text);
    await env.app.inject({ method: 'POST', url: '/api/auth/password/set', payload: { token, password: 'outra-senha-bem-longa' } });
    expect((await env.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('rate limit', () => {
  it('limita tentativas de login por IP', async () => {
    const limited = await createTestEnv({ AUTH_RATE_PER_MINUTE: '3' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        codes.push((await limited.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.dev', password: 'x' } })).statusCode);
      }
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes[4]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
