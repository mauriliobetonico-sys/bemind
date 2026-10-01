/**
 * Fase 3 — comercial: propostas, aceite público, contratos, cobrança,
 * pagamentos, onboarding no primeiro pagamento, HITL, despesas,
 * rentabilidade e isolamento entre tenants.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { withContext } from '../src/db/pool';
import { billingTick } from '../src/jobs/billing-tick';
import { addDays, isoDate } from '../src/modules/commercial/billing';
import { buildWorld, clientPayload, createTestEnv, drainOutbox, login, seedUser, type Agent, type TestEnv, type World } from './helpers';

let env: TestEnv;
let w: World;
let fin: Agent;
const today = isoDate(new Date());

beforeAll(async () => {
  env = await createTestEnv();
  w = await buildWorld(env);
  fin = await login(env.app, (await seedUser(env.admin, { name: 'Financeiro', globalRole: 'FINANCEIRO' })).email);
});
afterAll(() => env.close());

const proposalBody = (extra: Record<string, unknown> = {}) => ({
  title: 'Gestão de redes sociais',
  validUntil: addDays(today, 15),
  discountType: 'percent',
  discountValue: 10,
  notes: 'Inclui relatório mensal.',
  internalNotes: 'Margem alvo 40% — não mostrar ao cliente',
  items: [
    { name: 'Social media', quantity: 1, unitPriceCents: 300000, recurrence: 'recurring' },
    { name: 'Posts extras', quantity: 2, unitPriceCents: 50000, recurrence: 'recurring' },
    { name: 'Setup e diagnóstico', quantity: 1, unitPriceCents: 150000, recurrence: 'one_time' },
  ],
  ...extra,
});

const pub = (method: 'GET' | 'POST', url: string, body?: unknown) => env.app.inject({ method, url, payload: body as never });
const linkToken = (link: string) => link.split('/p/')[1]!;

describe('proposta → aceite → contrato → cobrança', () => {
  let proposalId: string;
  let token: string;
  let contractId: string;

  it('calcula totais no servidor (desconto sobre o recorrente)', async () => {
    const res = await w.gestorA.post('/api/proposals', proposalBody());
    expect(res.statusCode).toBe(201);
    const p = res.json();
    proposalId = p.id;
    expect(p.number).toMatch(/^PROP-\d{4}-\d{6}$/);
    expect(p.recurringSubtotalCents).toBe(400000);
    expect(p.discountCents).toBe(40000);
    expect(p.recurringTotalCents).toBe(360000);
    expect(p.oneTimeTotalCents).toBe(150000);
  });

  it('gestor não cria proposta para cliente fora da sua carteira', async () => {
    expect((await w.gestorA.post('/api/proposals', proposalBody(), { 'x-tenant-id': w.clientB.tenantId })).statusCode).toBe(403);
    expect((await w.operadorA.get('/api/proposals')).statusCode).toBe(403);
  });

  it('envio gera link assinado e e-mail ao contato do cliente', async () => {
    env.mailer.sent.length = 0;
    const res = await w.gestorA.post(`/api/proposals/${proposalId}/send`);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('sent');
    token = linkToken(res.json().link);
    await drainOutbox(env);
    const mail = env.mailer.sent.find((m) => m.subject.includes('Proposta'));
    expect(mail?.text).toContain(`/p/${token}`);
    const stored = await env.admin.query(`SELECT public_token_hash IS NOT NULL AS h, encode(public_token_hash, 'hex') AS hex FROM proposals WHERE id = $1`, [proposalId]);
    expect(stored.rows[0].h).toBe(true);
    expect(stored.rows[0].hex).not.toContain(token);
  });

  it('link público: mostra a proposta sem dados internos e marca como visualizada', async () => {
    const res = await pub('GET', `/api/public/proposals/${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('viewed');
    expect(body.recurringTotalCents).toBe(360000);
    expect(JSON.stringify(body)).not.toContain('Margem alvo');
    expect(JSON.stringify(body)).not.toContain(w.clientA.tenantId);
    expect((await pub('GET', `/api/public/proposals/${'x'.repeat(43)}`)).statusCode).toBe(404);
    expect((await pub('GET', `/api/public/proposals/curto`)).statusCode).toBe(400);
  });

  it('PDF da proposta', async () => {
    const res = await pub('GET', `/api/public/proposals/${token}/pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await w.gestorA.get(`/api/proposals/${proposalId}/pdf`)).statusCode).toBe(200);
  });

  it('proposta enviada não pode ser editada', async () => {
    expect((await w.gestorA.patch(`/api/proposals/${proposalId}`, { title: 'Outro' })).statusCode).toBe(400);
  });

  it('aceite online exige nome e concordância; cria contrato, setup e inicia cobrança', async () => {
    expect((await pub('POST', `/api/public/proposals/${token}/accept`, { name: 'Ana' })).statusCode).toBe(400);
    env.mailer.sent.length = 0;
    const res = await pub('POST', `/api/public/proposals/${token}/accept`, { name: 'Ana Souza', agree: true });
    expect(res.statusCode).toBe(200);
    expect((await pub('POST', `/api/public/proposals/${token}/accept`, { name: 'Ana Souza', agree: true })).statusCode).toBe(409);

    const p = (await w.gestorA.get(`/api/proposals/${proposalId}`)).json();
    expect(p.status).toBe('accepted');
    expect(p.acceptedVia).toBe('online');
    contractId = p.contractId;
    const contract = (await fin.get(`/api/contracts/${contractId}`)).json();
    expect(contract.status).toBe('active');
    expect(contract.recurringAmountCents).toBe(360000);
    expect(contract.signatureStatus).toBe('accepted_online');
    const setup = contract.invoices.find((i: { kind: string }) => i.kind === 'setup');
    expect(setup.amountCents).toBe(150000);
    expect(setup.dueDate).toBe(addDays(today, 3));

    await drainOutbox(env);
    const subjects = env.mailer.sent.map((m) => m.subject);
    expect(subjects.some((s) => s.includes('Proposta aceita'))).toBe(true);
    expect(subjects.some((s) => s.includes('Contrato'))).toBe(true);
    expect(subjects.some((s) => s.includes('Fatura'))).toBe(true);
  });

  it('rotina de cobrança é idempotente e lembra vencidas uma única vez', async () => {
    const before = Number((await env.admin.query(`SELECT count(*) FROM invoices WHERE contract_id = $1`, [contractId])).rows[0].count);
    const future = addDays(today, 70);
    const t1 = await billingTick(env.ctx.pool, future);
    expect(t1.ran).toBe(true);
    expect(t1.invoicesCreated).toBeGreaterThan(0);
    const t2 = await billingTick(env.ctx.pool, future);
    expect(t2.invoicesCreated).toBe(0);
    const after = Number((await env.admin.query(`SELECT count(*) FROM invoices WHERE contract_id = $1`, [contractId])).rows[0].count);
    expect(after).toBe(before + t1.invoicesCreated);
    // Numeração sem buracos nas faturas do contrato.
    const nums = (await env.admin.query(`SELECT number FROM invoices ORDER BY number`)).rows.map((r) => Number(r.number.split('-')[2]));
    expect(new Set(nums).size).toBe(nums.length);

    expect(t1.overdueReminders).toBeGreaterThan(0); // o setup (vence em 3 dias) já está vencido em +70 dias
    expect(t2.overdueReminders).toBe(0);
    await env.admin.query(`UPDATE invoices SET reminded_at = NULL WHERE contract_id = $1`, [contractId]);
  });

  it('pagamento parcial e quitação; valor acima do saldo é recusado', async () => {
    const setup = (await fin.get(`/api/invoices?contractId=${contractId}`)).json().items.find((i: { kind: string }) => i.kind === 'setup');
    expect((await fin.post(`/api/invoices/${setup.id}/payments`, { amountCents: 200000, paidAt: today, method: 'pix' })).statusCode).toBe(400);
    const part = await fin.post(`/api/invoices/${setup.id}/payments`, { amountCents: 50000, paidAt: today, method: 'pix' });
    expect(part.json().paid).toBe(false);
    const rest = await fin.post(`/api/invoices/${setup.id}/payments`, { amountCents: 100000, paidAt: today, method: 'pix', reference: 'E2E123' });
    expect(rest.json().paid).toBe(true);
    expect(rest.json().invoice.status).toBe('paid');
  });

  it('portal do cliente: vê contrato, faturas e a proposta (com link), sem notas internas', async () => {
    const res = await w.userA.get('/api/portal/billing');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.contracts.map((c: { id: string }) => c.id)).toContain(contractId);
    expect(b.invoices.length).toBeGreaterThan(0);
    expect(b.proposals[0].link).toMatch(/^\/p\//);
    expect(JSON.stringify(b)).not.toContain('Margem alvo');
  });
});

describe('prospect: pagamento confirmado libera o acesso (onboarding)', () => {
  it('cliente prospect sem usuário → aceite manual → 1º pagamento cria o acesso e envia boas-vindas', async () => {
    const payload = clientPayload('Prospect', { status: 'prospect', inviteUser: false });
    const client = (await w.admin.post('/api/clients', payload)).json();
    expect((await env.admin.query(`SELECT count(*)::int AS n FROM tenant_users WHERE tenant_id = $1`, [client.tenantId])).rows[0].n).toBe(0);

    const p = (await w.admin.post('/api/proposals', proposalBody(), { 'x-tenant-id': client.tenantId })).json();
    const acc = await w.admin.post(`/api/proposals/${p.id}/accept-manual`, { acceptedByName: 'Diretor do prospect' });
    expect(acc.statusCode).toBe(200);
    const setup = (await fin.get(`/api/invoices?contractId=${acc.json().contractId}`)).json().items.find((i: { kind: string }) => i.kind === 'setup');

    env.mailer.sent.length = 0;
    const paid = await fin.post(`/api/invoices/${setup.id}/payments`, { amountCents: setup.amountCents, paidAt: today, method: 'boleto' });
    expect(paid.json().onboardingStarted).toBe(true);
    const status = (await env.admin.query(`SELECT status FROM clients WHERE tenant_id = $1`, [client.tenantId])).rows[0].status;
    expect(status).toBe('onboarding');
    await drainOutbox(env);
    expect(env.mailer.sent.some((m) => m.to === payload.email && m.subject.startsWith('Bem-vinda'))).toBe(true);
  });
});

describe('HITL: ações financeiras críticas', () => {
  let invoiceId: string;
  let contractId: string;

  beforeAll(async () => {
    const c = (await fin.post('/api/contracts', { title: 'Tráfego pago', recurringAmountCents: 200000, startDate: today, billingDay: 28 }, { 'x-tenant-id': w.clientB.tenantId })).json();
    contractId = c.id;
    invoiceId = (await fin.post('/api/invoices', { description: 'Serviço avulso', amountCents: 50000, dueDate: addDays(today, 5) }, { 'x-tenant-id': w.clientB.tenantId })).json().id;
  });

  it('cancelar fatura vira pedido pendente; financeiro não aprova; admin aprova e executa', async () => {
    const req = await fin.post(`/api/invoices/${invoiceId}/cancel`, { reason: 'Serviço não realizado' });
    expect(req.statusCode).toBe(202);
    expect((await fin.post(`/api/invoices/${invoiceId}/cancel`, { reason: 'De novo' })).statusCode).toBe(409);
    const still = (await env.admin.query(`SELECT status FROM invoices WHERE id = $1`, [invoiceId])).rows[0].status;
    expect(still).toBe('open');
    const actionId = req.json().actionId;
    expect((await fin.post(`/api/actions/${actionId}/decide`, { decision: 'approve' })).statusCode).toBe(403);
    const ok = await w.admin.post(`/api/actions/${actionId}/decide`, { decision: 'approve', note: 'Confirmado com o cliente' });
    expect(ok.json().status).toBe('executed');
    expect((await env.admin.query(`SELECT status FROM invoices WHERE id = $1`, [invoiceId])).rows[0].status).toBe('cancelled');
    const audit = await env.admin.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action IN ('invoice.cancel.requested', 'invoice.cancel.approved')`);
    expect(audit.rows[0].n).toBe(2);
  });

  it('alterar valor do contrato só vale após aprovação; faturas futuras acompanham', async () => {
    const req = await fin.post(`/api/contracts/${contractId}/change-value`, { recurringAmountCents: 250000, reason: 'Reajuste anual' });
    expect(req.statusCode).toBe(202);
    expect((await fin.get(`/api/contracts/${contractId}`)).json().recurringAmountCents).toBe(200000);
    await w.admin.post(`/api/actions/${req.json().actionId}/decide`, { decision: 'approve' });
    expect((await fin.get(`/api/contracts/${contractId}`)).json().recurringAmountCents).toBe(250000);
  });

  it('rejeitar não executa nada', async () => {
    const req = await fin.post(`/api/contracts/${contractId}/cancel`, { reason: 'Cliente pediu para sair' });
    const res = await w.admin.post(`/api/actions/${req.json().actionId}/decide`, { decision: 'reject', note: 'Vamos negociar' });
    expect(res.json().status).toBe('rejected');
    expect((await fin.get(`/api/contracts/${contractId}`)).json().status).toBe('active');
  });

  it('política sem autoaprovação exige outra pessoa; só SUPER_ADMIN muda políticas', async () => {
    expect((await w.admin.put('/api/action-policies/contract.cancel', { requiresApproval: true, allowSelfApproval: false })).statusCode).toBe(403);
    expect((await w.superAdmin.put('/api/action-policies/contract.cancel', { requiresApproval: true, allowSelfApproval: false })).statusCode).toBe(200);
    const req = await w.admin.post(`/api/contracts/${contractId}/cancel`, { reason: 'Encerramento combinado' });
    expect((await w.admin.post(`/api/actions/${req.json().actionId}/decide`, { decision: 'approve' })).statusCode).toBe(403);
    expect((await w.superAdmin.post(`/api/actions/${req.json().actionId}/decide`, { decision: 'approve' })).json().status).toBe('executed');
    expect((await fin.get(`/api/contracts/${contractId}`)).json().status).toBe('cancelled');
  });

  it('ação sem exigência de aprovação executa direto (e é auditada)', async () => {
    await w.superAdmin.put('/api/action-policies/expense.delete', { requiresApproval: false, allowSelfApproval: true });
    const e = (await fin.post('/api/expenses', { category: 'software', description: 'Licença duplicada', amountCents: 9900, incurredOn: today })).json();
    const res = await env.app.inject({ method: 'DELETE', url: `/api/expenses/${e.id}`, headers: { cookie: fin.cookie, 'x-csrf-token': fin.csrf }, payload: { reason: 'Lançamento duplicado' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('executed');
  });
});

describe('despesas, rentabilidade e painel financeiro', () => {
  it('despesas ficam na agência; rateio só para clientes', async () => {
    const ok = await fin.post('/api/expenses', { category: 'freelancer', description: 'Designer freelancer — cliente A', amountCents: 80000, incurredOn: today, clientTenantId: w.clientA.tenantId });
    expect(ok.statusCode).toBe(201);
    await fin.post('/api/expenses', { category: 'infrastructure', description: 'Servidor', amountCents: 40000, incurredOn: today });
    const agency = (await env.admin.query(`SELECT id FROM tenants WHERE kind = 'agency'`)).rows[0].id;
    expect((await fin.post('/api/expenses', { category: 'other', description: 'Inválida', amountCents: 100, incurredOn: today, clientTenantId: agency })).statusCode).toBe(400);
  });

  it('rentabilidade por cliente com método explícito e alerta de margem', async () => {
    const r = (await fin.get('/api/finance/profitability')).json();
    expect(r.method.length).toBeGreaterThan(3);
    expect(r.aiCost.status).toBe('measured');
    const a = r.clients.find((c: { tenantId: string }) => c.tenantId === w.clientA.tenantId);
    expect(a.revenueCents).toBe(150000); // setup pago no mês
    expect(a.directCostCents).toBe(80000);
    expect(a.infraCostCents).toBeGreaterThan(0);
    expect(a.marginCents).toBe(a.revenueCents - a.totalCostCents);
    expect(typeof a.belowThreshold).toBe('boolean');
  });

  it('resumo financeiro: MRR, recebido, inadimplência e gateway sinalizado como pendente', async () => {
    const s = (await fin.get('/api/finance/summary')).json();
    expect(s.mrrCents).toBeGreaterThan(0);
    expect(s.receivedCents).toBeGreaterThanOrEqual(150000);
    expect(s.paymentGateway).toBe('integration_pending');
    expect(s.series).toHaveLength(6);
  });
});

describe('isolamento comercial e financeiro', () => {
  it('cliente não acessa rotas financeiras da agência', async () => {
    for (const url of ['/api/invoices', '/api/expenses', '/api/proposals', '/api/contracts', '/api/finance/summary', '/api/finance/profitability', '/api/actions', '/api/settings/agency']) {
      expect((await w.userA.get(url)).statusCode, url).toBe(403);
    }
  });

  it('portal do cliente B não mostra nada de A', async () => {
    const b = (await w.userB.get('/api/portal/billing')).json();
    const json = JSON.stringify(b);
    expect(json).not.toContain(w.clientA.tenantId);
    expect(b.proposals.every((p: { title: string }) => p.title !== 'Gestão de redes sociais')).toBe(true);
    expect((await w.userB.get('/api/portal/billing', { 'x-tenant-id': w.clientA.tenantId })).statusCode).toBe(403);
  });

  it('gestor de A vê só contratos de A e não vê faturas/despesas', async () => {
    const items = (await w.gestorA.get('/api/contracts')).json().items;
    expect(items.every((c: { tenantId: string }) => c.tenantId === w.clientA.tenantId)).toBe(true);
    expect((await w.gestorA.get('/api/invoices')).statusCode).toBe(403);
    expect((await w.gestorA.get('/api/expenses')).statusCode).toBe(403);
  });

  it('financeiro não acessa operação nem gestão de usuários', async () => {
    expect((await fin.get('/api/demands')).statusCode).toBe(403);
    expect((await fin.get('/api/users')).statusCode).toBe(403);
    expect((await fin.get('/api/audit')).statusCode).toBe(403);
  });

  it('RLS: escopo de cliente nunca enxerga despesas (nem as rateadas a ele)', async () => {
    const pool = new pg.Pool({ connectionString: inject('appUrl'), max: 1 });
    try {
      const n = await withContext(pool, { scope: 'tenant', tenantIds: [w.clientA.tenantId] }, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM expenses`)).rows[0].n);
      expect(n).toBe(0);
      for (const t of ['proposals', 'proposal_items', 'contracts', 'invoices', 'payments', 'expenses', 'pending_actions', 'agency_settings', 'action_policies']) {
        expect((await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, t).toBe(0);
      }
      const propB = (await env.admin.query(`SELECT id FROM proposals WHERE tenant_id <> $1 LIMIT 1`, [w.clientA.tenantId])).rows[0].id;
      await expect(
        withContext(pool, { scope: 'global' }, (tx) =>
          tx.query(`INSERT INTO proposal_items (tenant_id, proposal_id, position, name, quantity, unit_price_cents, recurrence, total_cents) VALUES ($1, $2, 0, 'x', 1, 1, 'recurring', 1)`, [w.clientA.tenantId, propB]),
        ),
      ).rejects.toThrow(/foreign key/);
    } finally {
      await pool.end();
    }
  });
});
