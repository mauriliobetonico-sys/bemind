/**
 * Fase 6 — automação: notificações (internas + e-mail com preferência),
 * relatório diário (cada cliente recebe SOMENTE o próprio), lembretes,
 * workflows (sempre pelo MCP Hub) e publicação agendada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../src/db/pool';
import { automationTick, runReminders } from '../src/automation/jobs';
import { localNow } from '../src/automation/daily-report';
import { renderParams, runWorkflows } from '../src/automation/workflows';
import { buildWorld, createTestEnv, drainOutbox, login, seedUser, uid, type TestEnv, type World } from './helpers';
import { FakeProvider } from './fake-ai';

let env: TestEnv;
let w: World;
const fake = new FakeProvider();
const TAG_A = `ALFA-${uid()}`;
const TAG_B = `BETA-${uid()}`;
const hA = () => ({ 'x-tenant-id': w.clientA.tenantId });

beforeAll(async () => {
  env = await createTestEnv({ APP_TIMEZONE: 'America/Sao_Paulo', DAILY_REPORT_HOUR: '18', REMINDERS_HOUR: '8' }, { aiProvider: fake });
  w = await buildWorld(env);
  await drainOutbox(env);
});
afterAll(() => env.close());

const notifs = (userId: string) => env.admin.query('SELECT category, title, link, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at', [userId]).then((r) => r.rows);
const emailOf = async (userId: string) => (await env.admin.query('SELECT email FROM users WHERE id = $1', [userId])).rows[0].email as string;

async function demand(agent: World['userA'], title: string, extra: Record<string, unknown> = {}) {
  const r = await agent.post('/api/demands', { type: 'post', title, description: `Pedido ${title}`, priority: 'normal', ...extra });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

/** Entregável no fluxo real até o pedido de aprovação ao cliente. */
async function deliverableAwaitingClient(staff: World['gestorA'], demandId: string, title: string) {
  const v = await staff.post(`/api/demands/${demandId}/deliverables`, { title, description: 'Conteúdo do post' });
  expect(v.statusCode).toBe(201);
  const id = v.json().id as string;
  await staff.patch(`/api/deliverables/${id}`, { action: 'submit_for_qa' });
  const r = await staff.post(`/api/deliverables/${id}/request-approval`, { message: 'Para aprovar' });
  expect(r.statusCode).toBe(201);
  return { deliverableId: id, approvalId: r.json().id as string };
}

// ------------------------------------------------------------- notificações
describe('notificações', () => {
  it('nova demanda: equipe do cliente notifica (interna + e-mail); outro cliente não', async () => {
    env.mailer.sent.length = 0;
    await demand(w.userA, `Post ${TAG_A}`);
    await drainOutbox(env);
    const g = await notifs(w.gestorA.userId);
    expect(g.some((n) => n.category === 'demand' && n.title.startsWith('Nova demanda'))).toBe(true);
    expect((await notifs(w.userB.userId)).some((n) => n.category === 'demand')).toBe(false);
    expect(env.mailer.sent.map((m) => m.to)).toContain(await emailOf(w.gestorA.userId));
  });

  it('cada pessoa só vê as próprias notificações (API e RLS restritivo, até para admin global)', async () => {
    const mine = (await w.gestorA.get('/api/notifications')).json().items as { title: string }[];
    expect(mine.length).toBeGreaterThan(0);
    const adminView = await withContext(env.ctx.pool, { scope: 'global', userId: w.admin.userId }, async (tx) =>
      (await tx.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1', [w.gestorA.userId])).rows[0].n,
    );
    expect(adminView).toBe(0);
    const count = (await w.gestorA.get('/api/notifications/unread-count')).json().count;
    expect(count).toBeGreaterThan(0);
    await w.gestorA.post('/api/notifications/read', { all: true });
    expect((await w.gestorA.get('/api/notifications/unread-count')).json().count).toBe(0);
  });

  it('preferência desliga o e-mail da categoria, mas a notificação interna continua', async () => {
    expect((await w.gestorA.put('/api/notifications/preferences', { email: { demand: false } })).statusCode).toBe(200);
    expect((await w.gestorA.get('/api/notifications/preferences')).json().email).toMatchObject({ demand: false, approval: true });
    env.mailer.sent.length = 0;
    await demand(w.userA, `Outro ${TAG_A}`);
    await drainOutbox(env);
    expect(env.mailer.sent.map((m) => m.to)).not.toContain(await emailOf(w.gestorA.userId));
    expect((await notifs(w.gestorA.userId)).filter((n) => n.title.startsWith('Nova demanda')).length).toBe(2);
    await w.gestorA.put('/api/notifications/preferences', { email: { demand: true } });
  });

  it('SMTP falhando: só o e-mail é repetido; a notificação interna não duplica', async () => {
    env.mailer.failNext = 50;
    await demand(w.userA, `Falha SMTP ${TAG_A}`);
    await drainOutbox(env);
    const title = `Nova demanda — ${(await env.admin.query('SELECT name FROM tenants WHERE id = $1', [w.clientA.tenantId])).rows[0].name}`;
    const before = (await env.admin.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND body = $2`, [w.gestorA.userId, `Falha SMTP ${TAG_A}`])).rows[0].n;
    expect(before).toBe(1);
    // O e-mail volta para a fila com backoff (não some e não reprocessa o evento de domínio).
    const pendingMail = (await env.admin.query(`SELECT count(*)::int AS n FROM outbox_events WHERE type = 'mail.send' AND status = 'pending' AND attempts >= 1`)).rows[0].n;
    expect(pendingMail).toBeGreaterThan(0);
    env.mailer.failNext = 0;
    await env.admin.query(`UPDATE outbox_events SET available_at = now() WHERE type = 'mail.send' AND status = 'pending'`);
    await drainOutbox(env);
    expect((await env.admin.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND body = $2`, [w.gestorA.userId, `Falha SMTP ${TAG_A}`])).rows[0].n).toBe(1);
    expect(env.mailer.sent.some((m) => m.subject.startsWith(title) || m.text.includes(`Falha SMTP ${TAG_A}`))).toBe(true);
  });

  it('trabalho iniciado: o cliente é avisado quando a demanda entra em produção', async () => {
    const id = await demand(w.userA, `Inicio ${TAG_A}`);
    await drainOutbox(env);
    await w.gestorA.patch(`/api/demands/${id}`, { status: 'planning' });
    await w.gestorA.patch(`/api/demands/${id}`, { status: 'in_production' });
    await drainOutbox(env);
    expect((await notifs(w.userA.userId)).some((n) => n.title === `Trabalho iniciado: Inicio ${TAG_A}`)).toBe(true);
    expect((await notifs(w.userB.userId)).some((n) => n.title.includes(TAG_A))).toBe(false);
  });

  it('reunião agendada no calendário avisa o cliente e a equipe', async () => {
    const r = await w.gestorA.post('/api/calendar/events', { kind: 'meeting', title: `Alinhamento ${TAG_A}`, startsAt: '2030-03-10T13:00:00Z', visibility: 'client' }, hA());
    expect(r.statusCode).toBe(201);
    await drainOutbox(env);
    expect((await notifs(w.userA.userId)).some((n) => n.category === 'meeting' && n.title.includes(TAG_A))).toBe(true);
  });
});

// ------------------------------------------------------------- relatório diário
describe('relatório diário — cada cliente recebe SOMENTE o próprio', () => {
  // 21h UTC = 18h em São Paulo, numa quarta-feira.
  const evening = new Date('2030-01-16T21:30:00Z');
  const today = () => localNow('America/Sao_Paulo').date;

  beforeAll(async () => {
    // Atividade de hoje nos dois clientes + dado interno que nunca pode aparecer.
    const dA = await demand(w.userA, `Relatório ${TAG_A}`);
    await deliverableAwaitingClient(w.gestorA, dA, `Arte ${TAG_A}`);
    const dB = await demand(w.userB, `Relatório ${TAG_B}`);
    void dB;
    await env.admin.query(`INSERT INTO tasks (tenant_id, title) VALUES ($1, $2)`, [w.clientA.tenantId, `SEGREDO-INTERNO-${TAG_A}`]);
    await drainOutbox(env);
  });

  it('a rotina gera um relatório por cliente elegível, uma vez por dia', async () => {
    env.mailer.sent.length = 0;
    // A rotina usa a data local de "agora"; para este teste a hora vem do relógio fixo.
    const r = await automationTick(env.ctx, evening);
    expect(r.reports).toBeGreaterThanOrEqual(2);
    expect((await automationTick(env.ctx, evening)).reports).toBe(0); // idempotente no dia
    await drainOutbox(env);
    const date = localNow('America/Sao_Paulo', evening).date;
    const rows = (await env.admin.query(`SELECT tenant_id, sections, generator FROM daily_reports WHERE report_date = $1 AND tenant_id = ANY($2)`, [date, [w.clientA.tenantId, w.clientB.tenantId]])).rows;
    expect(rows).toHaveLength(2);
  });

  it('gerado para hoje: conteúdo do A só com dados do A, sem nada interno; IA escreve a abertura', async () => {
    await w.gestorA.post('/api/reports/generate', { send: true }, hA());
    await w.admin.post('/api/reports/generate', { send: true }, { 'x-tenant-id': w.clientB.tenantId });
    env.mailer.sent.length = 0;
    await drainOutbox(env);
    const [a] = (await env.admin.query(`SELECT * FROM daily_reports WHERE tenant_id = $1 AND report_date = $2`, [w.clientA.tenantId, today()])).rows;
    const textA = JSON.stringify(a.sections) + a.intro;
    expect(textA).toContain(TAG_A);
    expect(textA).not.toContain(TAG_B);
    expect(textA).not.toContain('SEGREDO-INTERNO');
    expect(a.sections.needsApproval.join(' ')).toContain(`Arte ${TAG_A}`);
    expect(a.generator).toBe('ai');
    expect(a.sections.notes).toEqual(['Vale revisar os itens aguardando aprovação.']);

    // E-mails: cada usuário do cliente recebe só o relatório do próprio cliente.
    const mailA = env.mailer.sent.filter((m) => m.to === '' || m.subject.startsWith('Relatório do dia')).filter((m) => m.text.includes(TAG_A));
    const mailB = env.mailer.sent.filter((m) => m.subject.startsWith('Relatório do dia') && m.text.includes(TAG_B));
    expect(mailA.map((m) => m.to)).toEqual([await emailOf(w.userA.userId)]);
    expect(mailB.map((m) => m.to)).toEqual([await emailOf(w.userB.userId)]);
    expect(mailA[0]!.text).not.toContain(TAG_B);
    expect(mailA[0]!.text).not.toContain('SEGREDO-INTERNO');
  });

  it('portal: o cliente lista só os próprios relatórios e não abre o do outro', async () => {
    const listA = (await w.userA.get('/api/reports')).json().items as { tenantId: string; id: string }[];
    expect(listA.length).toBeGreaterThan(0);
    expect(listA.every((r) => r.tenantId === w.clientA.tenantId)).toBe(true);
    const idB = (await env.admin.query(`SELECT id FROM daily_reports WHERE tenant_id = $1 LIMIT 1`, [w.clientB.tenantId])).rows[0].id;
    expect((await w.userA.get(`/api/reports/${idB}`)).statusCode).toBe(404);
    const own = (await w.userA.get(`/api/reports/${listA[0]!.id}`)).json();
    expect(own.sections).toBeDefined();
    const rls = await withContext(env.ctx.pool, { scope: 'tenant', tenantIds: [w.clientA.tenantId] }, async (tx) => (await tx.query('SELECT count(*)::int AS n FROM daily_reports WHERE tenant_id = $1', [w.clientB.tenantId])).rows[0].n);
    expect(rls).toBe(0);
  });

  it('configuração por cliente: fim de semana pulado quando "só dias úteis"; cliente não configura', async () => {
    expect((await w.userA.put(`/api/reports/settings/${w.clientA.tenantId}`, { dailyReportEnabled: false, dailyReportWeekdaysOnly: true })).statusCode).toBe(403);
    await w.admin.put(`/api/reports/settings/${w.clientB.tenantId}`, { dailyReportEnabled: true, dailyReportWeekdaysOnly: false });
    const saturday = new Date('2030-01-19T21:30:00Z');
    await automationTick(env.ctx, saturday);
    const queued = (await env.admin.query(`SELECT tenant_id FROM outbox_events WHERE type = 'report.generate' AND status = 'pending' AND payload->>'date' = $1`, [localNow('America/Sao_Paulo', saturday).date])).rows.map((r) => r.tenant_id);
    expect(queued).toContain(w.clientB.tenantId);
    expect(queued).not.toContain(w.clientA.tenantId);
  });
});

// ------------------------------------------------------------- lembretes
describe('lembretes diários', () => {
  it('tarefa atrasada avisa o responsável; aprovação parada avisa só o cliente dono', async () => {
    await env.admin.query(`INSERT INTO tasks (tenant_id, title, due_date, assignee_id) VALUES ($1, 'Revisar roteiro', current_date - 3, $2)`, [w.clientA.tenantId, w.operadorA.userId]);
    await env.admin.query(`UPDATE approvals SET created_at = now() - interval '3 days' WHERE tenant_id = $1 AND status = 'pending'`, [w.clientA.tenantId]);
    await runReminders(env.ctx, localNow('America/Sao_Paulo').date);
    expect((await notifs(w.operadorA.userId)).some((n) => n.category === 'deadline' && n.title.includes('tarefa atrasada'))).toBe(true);
    expect((await notifs(w.userA.userId)).some((n) => n.category === 'approval' && n.title.includes('aprovação'))).toBe(true);
    expect((await notifs(w.userB.userId)).some((n) => n.category === 'approval' && n.title.includes('aguarda'))).toBe(false);
  });
});

// ------------------------------------------------------------- workflows
describe('workflows: sempre pelo MCP Hub', () => {
  it('marcadores só do gatilho; ferramenta pendente recusada; gestor não cria', async () => {
    expect(renderParams({ t: 'Publicar {{deliverableTitle}}', x: '{{nada}}' }, { deliverableTitle: 'Arte' }, ['deliverableTitle'])).toEqual({ t: 'Publicar Arte', x: '{{nada}}' });
    const base = { name: 'Teste', trigger: 'demand.created', tool: 'internal.create_task', params: { title: 'Triagem {{deliverableTitle}}' } };
    expect((await w.admin.post('/api/workflows', base, hA())).statusCode).toBe(400);
    expect((await w.gestorA.post('/api/workflows', { ...base, params: { title: 'x {{demandTitle}}' } }, hA())).statusCode).toBe(403);
  });

  it('cliente aprovou → tarefa (baixo risco, executa) e e-mail (alto risco, espera aprovação humana)', async () => {
    await w.admin.post('/api/workflows', { name: 'Pós-aprovação', trigger: 'approval.approved', tool: 'internal.create_task', params: { title: 'Programar {{deliverableTitle}}', demandId: '{{demandId}}' } }, hA());
    await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/email`, { config: {} });
    await w.admin.post('/api/workflows', { name: 'Avisar cliente', trigger: 'approval.approved', tool: 'email.send_to_client', params: { subject: 'Aprovado!', message: 'Recebemos sua aprovação de {{deliverableTitle}}. Obrigado!' } }, hA());
    const dA = await demand(w.userA, `Fluxo ${TAG_A}`);
    const { approvalId } = await deliverableAwaitingClient(w.gestorA, dA, `Peça ${TAG_A}`);
    await drainOutbox(env);
    expect((await w.userA.post(`/api/approvals/${approvalId}/decide`, { decision: 'approved' })).statusCode).toBe(200);
    env.mailer.sent.length = 0;
    await drainOutbox(env);
    const calls = (await env.admin.query(`SELECT tool, status, requested_by_workflow FROM mcp_tool_calls WHERE tenant_id = $1 AND requested_by_workflow IS NOT NULL ORDER BY created_at`, [w.clientA.tenantId])).rows;
    expect(calls.map((c) => `${c.tool}:${c.status}`)).toEqual(['internal.create_task:succeeded', 'email.send_to_client:pending_approval']);
    expect((await env.admin.query(`SELECT 1 FROM tasks WHERE tenant_id = $1 AND title = $2`, [w.clientA.tenantId, `Programar Peça ${TAG_A}`])).rowCount).toBe(1);
    expect(env.mailer.sent.some((m) => m.subject.startsWith('Aprovado!'))).toBe(false); // nada sai sem decisão humana
  });

  it('o mesmo evento não dispara a regra duas vezes; regra do A não roda para o B', async () => {
    const before = Number((await env.admin.query(`SELECT count(*) FROM workflow_runs WHERE tenant_id = $1`, [w.clientA.tenantId])).rows[0].count);
    const ev = (await env.admin.query(`SELECT event_key FROM workflow_runs WHERE tenant_id = $1 LIMIT 1`, [w.clientA.tenantId])).rows[0].event_key;
    await withContext(env.ctx.pool, { scope: 'system' }, (tx) => runWorkflows(tx, env.ctx, w.clientA.tenantId, 'approval.approved', ev, { demandId: '', deliverableTitle: 'x' }));
    expect(Number((await env.admin.query(`SELECT count(*) FROM workflow_runs WHERE tenant_id = $1`, [w.clientA.tenantId])).rows[0].count)).toBe(before);
    expect(Number((await env.admin.query(`SELECT count(*) FROM workflow_runs WHERE tenant_id = $1`, [w.clientB.tenantId])).rows[0].count)).toBe(0);
  });

  it('parâmetros de regra não alcançam dados de outro cliente (RLS durante o disparo)', async () => {
    const dB = await demand(w.userB, `Alvo ${TAG_B}`);
    await w.admin.post('/api/workflows', { name: 'Cruzada', trigger: 'demand.created', tool: 'internal.create_task', params: { title: 'Cruzada', demandId: dB } }, hA());
    await demand(w.userA, `Gatilho ${TAG_A}`);
    await drainOutbox(env);
    const run = (await env.admin.query(`SELECT r.status, r.error FROM workflow_runs r JOIN workflow_rules w ON w.id = r.rule_id WHERE w.name = 'Cruzada'`)).rows[0];
    expect(run).toMatchObject({ status: 'rejected' });
    expect(run.error).toMatch(/Demanda não encontrada neste cliente/);
  });
});

// ------------------------------------------------------------- publicação agendada
describe('agendamento', () => {
  it('só ferramentas agendáveis, com horário válido; aprovado fica na fila até a hora', async () => {
    const later = new Date(Date.now() + 2 * 3600_000).toISOString();
    expect((await w.gestorA.post('/api/mcp/tool-calls', { tool: 'internal.create_task', params: { title: 'Agendada' }, reason: 'teste', scheduledFor: later }, hA())).json().error).toBe('invalid_request');
    expect((await w.gestorA.post('/api/mcp/tool-calls', { tool: 'email.send_to_client', params: { subject: 'Oi', message: 'Mensagem agendada do teste.' }, reason: 'teste', scheduledFor: new Date(Date.now() - 60_000).toISOString() }, hA())).json().error).toBe('invalid_request');
    const r = await w.gestorA.post('/api/mcp/tool-calls', { tool: 'email.send_to_client', params: { subject: 'Agendado', message: 'Mensagem agendada do teste.' }, reason: 'Campanha', scheduledFor: later }, hA());
    expect(r.json().status).toBe('pending_approval');
    const other = await seedUser(env.admin, { globalRole: 'ADMIN' });
    const approver = await login(env.app, other.email);
    expect((await approver.post(`/api/mcp/tool-calls/${r.json().id}/decide`, { decision: 'approve' })).json().status).toBe('queued');
    env.mailer.sent.length = 0;
    await drainOutbox(env);
    expect(env.mailer.sent.some((m) => m.subject.startsWith('Agendado'))).toBe(false);
    const c = (await env.admin.query('SELECT status, scheduled_for FROM mcp_tool_calls WHERE id = $1', [r.json().id])).rows[0];
    expect(c.status).toBe('queued');
    expect(new Date(c.scheduled_for).toISOString()).toBe(new Date(later).toISOString());
    const ev = (await env.admin.query(`SELECT available_at FROM outbox_events WHERE type = 'mcp.call' AND payload->>'callId' = $1`, [r.json().id])).rows[0];
    expect(new Date(ev.available_at).getTime()).toBeGreaterThan(Date.now() + 3600_000);
  });
});
