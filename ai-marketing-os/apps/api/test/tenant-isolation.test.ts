/**
 * TESTES OBRIGATÓRIOS DE ISOLAMENTO ENTRE TENANTS (seção 42 da especificação).
 * Cada caso tenta acessar dados do Cliente B a partir do Cliente A — todos
 * precisam falhar, sem revelar se o recurso existe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, createTestEnv, type TestEnv, type World } from './helpers';

let env: TestEnv;
let w: World;

beforeAll(async () => {
  env = await createTestEnv();
  w = await buildWorld(env);
});
afterAll(() => env.close());

describe('Cliente A tentando acessar dados do Cliente B', () => {
  it('consultar o cadastro de B pelo ID → 404', async () => {
    const res = await w.userA.get(`/api/clients/${w.clientB.id}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(w.clientB.tenantId);
  });

  it('a resposta para recurso de outro tenant é idêntica à de recurso inexistente', async () => {
    const other = await w.userA.get(`/api/clients/${w.clientB.id}`);
    const missing = await w.userA.get('/api/clients/00000000-0000-4000-8000-000000000000');
    expect(other.statusCode).toBe(missing.statusCode);
    expect(other.json()).toEqual(missing.json());
  });

  it('consultar o histórico de B → 404', async () => {
    const res = await w.userA.get(`/api/clients/${w.clientB.id}/events`);
    expect(res.statusCode).toBe(404);
  });

  it('listar clientes retorna somente o próprio', async () => {
    const res = await w.userA.get('/api/clients');
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { items: { id: string }[] }).items.map((c) => c.id);
    expect(ids).toEqual([w.clientA.id]);
  });

  it('busca textual pelo nome de B não retorna nada', async () => {
    const b = (await w.admin.get(`/api/clients/${w.clientB.id}`)).json() as { tradeName: string };
    const res = await w.userA.get(`/api/clients?q=${encodeURIComponent(b.tradeName)}`);
    expect((res.json() as { total: number }).total).toBe(0);
  });

  it('manipular o header X-Tenant-Id com o tenant de B → 403', async () => {
    const res = await w.userA.get('/api/clients', { 'x-tenant-id': w.clientB.tenantId });
    expect(res.statusCode).toBe(403);
    const res2 = await w.userA.get(`/api/clients/${w.clientB.id}`, { 'x-tenant-id': w.clientB.tenantId });
    expect(res2.statusCode).toBe(403);
  });

  it('editar B pelo ID → bloqueado e B permanece inalterado', async () => {
    const before = (await w.admin.get(`/api/clients/${w.clientB.id}`)).json() as { tradeName: string };
    const res = await w.userA.patch(`/api/clients/${w.clientB.id}`, { tradeName: 'Invadido' });
    expect([403, 404]).toContain(res.statusCode);
    const after = (await w.admin.get(`/api/clients/${w.clientB.id}`)).json() as { tradeName: string };
    expect(after.tradeName).toBe(before.tradeName);
  });

  it('acessar o portal de B → somente dados do próprio tenant', async () => {
    const res = await w.userA.get('/api/portal/overview');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { client: { id: string }; companies: { tenantId: string }[] };
    expect(body.client.id).toBe(w.clientA.id);
    expect(body.companies.map((c) => c.tenantId)).toEqual([w.clientA.tenantId]);
    const forced = await w.userA.get('/api/portal/overview', { 'x-tenant-id': w.clientB.tenantId });
    expect(forced.statusCode).toBe(403);
  });

  it('consultar dados financeiros (painel administrativo, MRR) → 403', async () => {
    const res = await w.userA.get('/api/dashboard/admin');
    expect(res.statusCode).toBe(403);
  });

  it('consultar auditoria → 403', async () => {
    const res = await w.userA.get('/api/audit');
    expect(res.statusCode).toBe(403);
  });

  it('listar usuários (e descobrir usuários de B) → 403', async () => {
    const res = await w.userA.get('/api/users');
    expect(res.statusCode).toBe(403);
  });

  it('listar tenants → 403', async () => {
    const res = await w.userA.get('/api/tenants');
    expect(res.statusCode).toBe(403);
  });

  it('injetar tenantId no corpo da criação de cliente → rejeitado', async () => {
    const res = await w.userA.post('/api/clients', { tenantId: w.clientB.tenantId });
    expect(res.statusCode).toBe(403);
  });

  it('IDs malformados ou injeção na URL → 400, nunca 500', async () => {
    for (const bad of ["1' OR '1'='1", '..%2F..%2Fetc', w.clientB.id.toUpperCase() + 'x']) {
      const res = await w.userA.get(`/api/clients/${encodeURIComponent(bad)}`);
      expect(res.statusCode).toBe(400);
    }
  });

  it('o simétrico também vale: B não vê A', async () => {
    expect((await w.userB.get(`/api/clients/${w.clientA.id}`)).statusCode).toBe(404);
    const ids = ((await w.userB.get('/api/clients')).json() as { items: { id: string }[] }).items.map((c) => c.id);
    expect(ids).toEqual([w.clientB.id]);
  });
});

describe('Equipe interna com acesso restrito ao Cliente A', () => {
  it('gestor de A não lê nem edita B', async () => {
    expect((await w.gestorA.get(`/api/clients/${w.clientB.id}`)).statusCode).toBe(404);
    expect([403, 404]).toContain((await w.gestorA.patch(`/api/clients/${w.clientB.id}`, { notes: 'x' })).statusCode);
  });

  it('gestor de A edita A', async () => {
    const res = await w.gestorA.patch(`/api/clients/${w.clientA.id}`, { notes: 'Ajuste de cadastro' });
    expect(res.statusCode).toBe(200);
  });

  it('operador de A lê A, mas não edita', async () => {
    expect((await w.operadorA.get(`/api/clients/${w.clientA.id}`)).statusCode).toBe(200);
    expect((await w.operadorA.patch(`/api/clients/${w.clientA.id}`, { notes: 'x' })).statusCode).toBe(403);
  });

  it('painel do gestor de A agrega somente A', async () => {
    const res = await w.gestorA.get('/api/dashboard/admin');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { clients: { total: number }; timeline: { clientId: string }[] };
    expect(body.clients.total).toBe(1);
    expect(body.timeline.every((t) => t.clientId === w.clientA.id)).toBe(true);
  });

  it('gestor de A vê somente usuários associados a A', async () => {
    const res = await w.gestorA.get('/api/users');
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { id: string; memberships: { tenantId: string }[] }[] }).items;
    expect(items.some((u) => u.id === w.userB.userId)).toBe(false);
    for (const u of items) {
      for (const m of u.memberships) expect(m.tenantId).toBe(w.clientA.tenantId);
    }
  });
});

describe('Administração global', () => {
  it('ADMIN enxerga os dois clientes', async () => {
    const ids = ((await w.admin.get('/api/clients?limit=100')).json() as { items: { id: string }[] }).items.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([w.clientA.id, w.clientB.id]));
  });

  it('suspender o tenant A corta o acesso do usuário de A imediatamente', async () => {
    expect((await w.admin.patch(`/api/tenants/${w.clientA.tenantId}`, { status: 'suspended' })).statusCode).toBe(200);
    expect((await w.userA.get(`/api/clients/${w.clientA.id}`)).statusCode).toBe(403);
    expect((await w.userA.get('/api/portal/overview')).statusCode).toBe(403);
    expect((await w.admin.patch(`/api/tenants/${w.clientA.tenantId}`, { status: 'active' })).statusCode).toBe(200);
    expect((await w.userA.get(`/api/clients/${w.clientA.id}`)).statusCode).toBe(200);
  });
});
