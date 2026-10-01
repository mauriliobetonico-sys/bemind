/**
 * Fase 2 — fluxo operacional completo e isolamento dos novos recursos:
 * demandas, briefings, tarefas, arquivos, entregáveis, QA, aprovações,
 * Brand Vault e calendário.
 */
import { createServer, type Server } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { withContext } from '../src/db/pool';
import { buildWorld, createTestEnv, drainOutbox, login, multipart, PNG_1PX, seedUser, type TestEnv, type World } from './helpers';

let env: TestEnv;
let w: World;

beforeAll(async () => {
  env = await createTestEnv({ MAX_UPLOAD_MB: '1' });
  w = await buildWorld(env);
});
afterAll(() => env.close());

const today = new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function upload(agent: World['userA'], files: { name: string; content: Buffer }[], query = '', headers: Record<string, string> = {}) {
  const body = multipart(files);
  return agent.request('POST', `/api/files${query}`, { body: body.payload, headers: { ...body.headers, ...headers } });
}

describe('fluxo: demanda → briefing → produção → QA → aprovação → entrega', () => {
  let demandId: string;
  let deliverableId: string;
  let fileId: string;

  it('cliente abre demanda; equipe é notificada', async () => {
    env.mailer.sent.length = 0;
    const res = await w.userA.post('/api/demands', {
      type: 'campaign',
      title: 'Campanha de Black Friday',
      description: 'Quero uma campanha para redes sociais com 3 posts e 1 reel.',
      priority: 'high',
      dueDate: addDays(10),
    });
    expect(res.statusCode).toBe(201);
    const d = res.json();
    expect(d.status).toBe('submitted');
    expect(d.tenantId).toBe(w.clientA.tenantId);
    demandId = d.id;
    await drainOutbox(env);
    expect(env.mailer.sent.some((m) => m.subject.includes('Nova demanda'))).toBe(true);
    // O e-mail de nova demanda nunca vai para usuários do cliente B.
    const bEmails = (await env.admin.query(`SELECT u.email FROM users u JOIN tenant_users tu ON tu.user_id = u.id WHERE tu.tenant_id = $1`, [w.clientB.tenantId])).rows.map((r) => r.email);
    expect(env.mailer.sent.some((m) => bEmails.includes(m.to))).toBe(false);
  });

  it('cliente não pode criar demanda vinculada a projeto de outro cliente', async () => {
    const proj = await w.admin.post('/api/projects', { name: 'Projeto B' }, { 'x-tenant-id': w.clientB.tenantId });
    expect(proj.statusCode).toBe(201);
    const res = await w.userA.post('/api/demands', { type: 'post', title: 'Post', description: 'descrição longa', projectId: proj.json().id });
    expect(res.statusCode).toBe(400);
  });

  it('gestor registra briefing (demanda vai para planejamento)', async () => {
    const res = await w.gestorA.put(`/api/demands/${demandId}/briefing`, { objective: 'Aumentar vendas na Black Friday', audience: 'Clientes recorrentes' });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(1);
    const d = (await w.gestorA.get(`/api/demands/${demandId}`)).json();
    expect(d.status).toBe('planning');
    expect(d.briefing.objective).toContain('Black Friday');
  });

  it('tarefas: responsável precisa ser da equipe do cliente', async () => {
    const ok = await w.gestorA.post('/api/tasks', { title: 'Roteiro do reel', demandId, assigneeId: w.operadorA.userId, dueDate: addDays(-1) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().overdue).toBe(true);
    const asClient = await w.gestorA.post('/api/tasks', { title: 'Inválida', assigneeId: w.userA.userId });
    expect(asClient.statusCode).toBe(400);
    const done = await w.operadorA.patch(`/api/tasks/${ok.json().id}`, { status: 'done' });
    expect(done.json().completedAt).not.toBeNull();
  });

  it('upload interno: rascunho invisível para o cliente', async () => {
    const res = await upload(w.gestorA, [{ name: 'arte-v1.png', content: PNG_1PX }], `?visibility=internal&demandId=${demandId}`);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.summary).toBe('Identifiquei: 1 imagem.');
    fileId = body.files[0].id;
    expect(body.files[0].visibility).toBe('internal');
    const list = (await w.userA.get('/api/files')).json();
    expect(list.items.some((f: { id: string }) => f.id === fileId)).toBe(false);
    expect((await w.userA.get(`/api/files/${fileId}/download`)).statusCode).toBe(404);
  });

  it('entregável → QA reprova com motivo → corrige → QA aprova e envia ao cliente', async () => {
    const created = await w.gestorA.post(`/api/demands/${demandId}/deliverables`, { title: 'Post 1 — feed', fileId });
    expect(created.statusCode).toBe(201);
    deliverableId = created.json().id;

    // Cliente ainda não vê entregáveis em produção.
    expect((await w.userA.get(`/api/demands/${demandId}`)).json().deliverables).toHaveLength(0);
    // Não dá para pular o QA.
    expect((await w.gestorA.post(`/api/deliverables/${deliverableId}/request-approval`, {})).statusCode).toBe(400);

    expect((await w.gestorA.patch(`/api/deliverables/${deliverableId}`, { action: 'submit_for_qa' })).json().status).toBe('internal_review');
    expect((await w.gestorA.patch(`/api/deliverables/${deliverableId}`, { action: 'qa_reject' })).statusCode).toBe(400);
    const rejected = await w.gestorA.patch(`/api/deliverables/${deliverableId}`, { action: 'qa_reject', qaNotes: 'Logo fora da área de respiro' });
    expect(rejected.json().status).toBe('draft');
    expect(rejected.json().qaNotes).toContain('Logo');
    await w.gestorA.patch(`/api/deliverables/${deliverableId}`, { action: 'submit_for_qa' });

    env.mailer.sent.length = 0;
    const req = await w.operadorA.post(`/api/deliverables/${deliverableId}/request-approval`, { message: 'Primeira versão do post.' });
    expect(req.statusCode).toBe(201);
    expect((await w.operadorA.post(`/api/deliverables/${deliverableId}/request-approval`, {})).statusCode).toBe(400);
    await drainOutbox(env);
    const userAEmail = (await env.admin.query(`SELECT email FROM users WHERE id = $1`, [w.userA.userId])).rows[0].email;
    expect(env.mailer.sent.map((m) => m.to)).toEqual([userAEmail]);

    const d = (await w.userA.get(`/api/demands/${demandId}`)).json();
    expect(d.status).toBe('awaiting_approval');
    expect(d.deliverables).toHaveLength(1);
    expect(d.deliverables[0].qaNotes).toBeNull(); // notas internas de QA não vão para o cliente
    expect(d.activity.some((a: { type: string }) => a.type === 'deliverable.qa_rejected')).toBe(false);
    // Arquivo liberado para o cliente após o QA.
    expect((await w.userA.get(`/api/files/${fileId}/download`)).statusCode).toBe(200);
  });

  it('equipe não decide aprovação pelo cliente; cliente precisa justificar alteração', async () => {
    const pending = (await w.userA.get('/api/approvals?status=pending')).json().items;
    expect(pending).toHaveLength(1);
    const approvalId = pending[0].id;
    expect((await w.gestorA.post(`/api/approvals/${approvalId}/decide`, { decision: 'approved' })).statusCode).toBe(403);
    expect((await w.admin.post(`/api/approvals/${approvalId}/decide`, { decision: 'approved' })).statusCode).toBe(403);
    expect((await w.userA.post(`/api/approvals/${approvalId}/decide`, { decision: 'changes_requested' })).statusCode).toBe(400);

    env.mailer.sent.length = 0;
    const res = await w.userA.post(`/api/approvals/${approvalId}/decide`, { decision: 'changes_requested', reason: 'Gostei, mas quero trocar a foto.' });
    expect(res.statusCode).toBe(200);
    expect((await w.userA.post(`/api/approvals/${approvalId}/decide`, { decision: 'approved' })).statusCode).toBe(409);
    await drainOutbox(env);
    expect(env.mailer.sent.some((m) => m.text.includes('trocar a foto'))).toBe(true);
    expect((await w.gestorA.get(`/api/demands/${demandId}`)).json().status).toBe('changes_requested');
  });

  it('nova versão → QA → aprovação → demanda aprovada → entregue', async () => {
    const v2 = await w.gestorA.patch(`/api/deliverables/${deliverableId}`, { action: 'new_version' });
    expect(v2.json().version).toBe(2);
    await w.gestorA.patch(`/api/deliverables/${deliverableId}`, { action: 'submit_for_qa' });
    await w.gestorA.post(`/api/deliverables/${deliverableId}/request-approval`, {});
    const approvalId = (await w.userA.get('/api/approvals?status=pending')).json().items[0].id;
    expect((await w.userA.post(`/api/approvals/${approvalId}/decide`, { decision: 'approved' })).statusCode).toBe(200);
    expect((await w.gestorA.get(`/api/demands/${demandId}`)).json().status).toBe('approved');
    // Transições manuais inválidas são recusadas.
    expect((await w.gestorA.patch(`/api/demands/${demandId}`, { status: 'submitted' })).statusCode).toBe(400);
    expect((await w.gestorA.patch(`/api/demands/${demandId}`, { status: 'delivered' })).json().status).toBe('delivered');
  });

  it('painéis refletem a operação', async () => {
    const admin = (await w.admin.get('/api/dashboard/admin')).json();
    expect(admin.operations).toBeDefined();
    expect(admin.operations.overdueTasks).toBeGreaterThanOrEqual(0);
    const portal = (await w.userA.get('/api/portal/overview')).json();
    expect(portal.work.completed).toBeGreaterThanOrEqual(1);
  });
});

describe('isolamento dos recursos operacionais (Cliente B → dados de A)', () => {
  let demandA: string;
  let fileA: string;
  let approvalA: string;
  let taskA: string;

  beforeAll(async () => {
    demandA = (await w.userA.post('/api/demands', { type: 'post', title: 'Post de A', description: 'Somente do cliente A', dueDate: today })).json().id;
    fileA = (await upload(w.userA, [{ name: 'logo-a.png', content: PNG_1PX }])).json().files[0].id;
    taskA = (await w.gestorA.post('/api/tasks', { title: 'Tarefa interna A', demandId: demandA, dueDate: today })).json().id;
    const del = (await w.gestorA.post(`/api/demands/${demandA}/deliverables`, { title: 'Peça A', description: 'texto' })).json().id;
    await w.gestorA.patch(`/api/deliverables/${del}`, { action: 'submit_for_qa' });
    approvalA = (await w.gestorA.post(`/api/deliverables/${del}/request-approval`, {})).json().id;
    await w.userA.post('/api/brand-assets', { kind: 'color', title: 'Verde A', value: '#00AA55' });
  });

  it('demanda de A: B recebe 404 e não a vê na lista', async () => {
    expect((await w.userB.get(`/api/demands/${demandA}`)).statusCode).toBe(404);
    const ids = (await w.userB.get('/api/demands')).json().items.map((d: { id: string }) => d.id);
    expect(ids).not.toContain(demandA);
  });

  it('arquivo de A: B não lista nem baixa', async () => {
    expect((await w.userB.get(`/api/files/${fileA}/download`)).statusCode).toBe(404);
    const ids = (await w.userB.get('/api/files')).json().items.map((f: { id: string }) => f.id);
    expect(ids).not.toContain(fileA);
  });

  it('aprovação de A: B não lista nem decide', async () => {
    expect((await w.userB.post(`/api/approvals/${approvalA}/decide`, { decision: 'approved' })).statusCode).toBe(404);
    const ids = (await w.userB.get('/api/approvals')).json().items.map((a: { id: string }) => a.id);
    expect(ids).not.toContain(approvalA);
    const st = await env.admin.query(`SELECT status FROM approvals WHERE id = $1`, [approvalA]);
    expect(st.rows[0].status).toBe('pending');
  });

  it('B não envia arquivo nem abre demanda no tenant de A forçando o header', async () => {
    expect((await upload(w.userB, [{ name: 'x.png', content: PNG_1PX }], '', { 'x-tenant-id': w.clientA.tenantId })).statusCode).toBe(403);
    expect((await w.userB.post('/api/demands', { type: 'post', title: 'Invasão', description: 'tentativa de B' }, { 'x-tenant-id': w.clientA.tenantId })).statusCode).toBe(403);
  });

  it('Brand Vault e calendário de B não mostram nada de A', async () => {
    const brand = (await w.userB.get('/api/brand-assets')).json().items;
    expect(brand.some((b: { tenantId: string }) => b.tenantId === w.clientA.tenantId)).toBe(false);
    const cal = (await w.userB.get(`/api/calendar?from=${addDays(-30)}&to=${addDays(30)}`)).json().items;
    expect(cal.some((e: { tenantId: string }) => e.tenantId === w.clientA.tenantId)).toBe(false);
  });

  it('cliente não vê tarefas internas (nem no calendário)', async () => {
    expect((await w.userA.get('/api/tasks')).statusCode).toBe(403);
    const cal = (await w.userA.get(`/api/calendar?from=${addDays(-30)}&to=${addDays(30)}`)).json().items;
    expect(cal.some((e: { source: string }) => e.source === 'task')).toBe(false);
    expect(cal.some((e: { id: string }) => e.id === demandA)).toBe(true);
    const staffCal = (await w.gestorA.get(`/api/calendar?from=${addDays(-30)}&to=${addDays(30)}`)).json().items;
    expect(staffCal.some((e: { id: string }) => e.id === taskA)).toBe(true);
  });

  it('cliente não executa ações da equipe', async () => {
    expect((await w.userA.post(`/api/demands/${demandA}/deliverables`, { title: 'Eu mesmo' })).statusCode).toBe(403);
    expect((await w.userA.patch(`/api/demands/${demandA}`, { status: 'delivered' })).statusCode).toBe(403);
    expect((await w.userA.delete(`/api/files/${fileA}`)).statusCode).toBe(403);
  });

  it('gestor de A não alcança B nem vincula recursos de B', async () => {
    const demandB = (await w.userB.post('/api/demands', { type: 'post', title: 'Post de B', description: 'Somente do cliente B' })).json().id;
    expect((await w.gestorA.get(`/api/demands/${demandB}`)).statusCode).toBe(404);
    expect((await w.gestorA.post(`/api/demands/${demandB}/deliverables`, { title: 'Invasão' })).statusCode).toBe(404);
    // Tarefa no tenant A apontando para demanda de B: FK composta recusa.
    expect((await w.gestorA.post('/api/tasks', { title: 'Cruzada', demandId: demandB })).statusCode).toBe(400);
    const tasksB = (await w.gestorA.get('/api/tasks')).json().items;
    expect(tasksB.every((t: { tenantId: string }) => t.tenantId === w.clientA.tenantId)).toBe(true);
  });

  it('admin sem escolher cliente não consegue criar recurso ambíguo', async () => {
    expect((await w.admin.post('/api/demands', { type: 'post', title: 'Sem cliente', description: 'qual tenant?' })).statusCode).toBe(400);
  });
});

describe('upload: validação de conteúdo, tamanho e entrega segura', () => {
  it('extensão falsa é rejeitada pelo conteúdo', async () => {
    const res = await upload(w.userA, [{ name: 'foto.png', content: Buffer.from('<?php echo "x"; ?>') }]);
    expect(res.statusCode).toBe(422);
    expect(res.json().rejected[0].reason).toContain('não permitido');
  });

  it('executável é rejeitado mesmo com nome inocente', async () => {
    const res = await upload(w.userA, [{ name: 'contrato.pdf', content: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]) }]);
    expect(res.statusCode).toBe(422);
  });

  it('arquivo acima do limite é rejeitado e não fica no disco', async () => {
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(1024 * 1024 + 10)]);
    const res = await upload(w.userA, [{ name: 'grande.png', content: big }]);
    expect(res.statusCode).toBe(422);
    expect(res.json().rejected[0].reason).toContain('MB');
  });

  it('lote misto: aceita os válidos, lista os recusados, resume por categoria', async () => {
    const res = await upload(w.userA, [
      { name: 'Logo_Principal.png', content: PNG_1PX },
      { name: 'foto-loja.png', content: PNG_1PX },
      { name: 'virus.exe', content: Buffer.from('MZ\x90\x00') },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().files).toHaveLength(2);
    expect(res.json().rejected).toHaveLength(1);
    expect(res.json().summary).toBe('Identifiquei: 1 imagem e 1 logo.');
  });

  it('nome com path traversal é saneado; SVG é sempre baixado como anexo e em sandbox', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await upload(w.userA, [{ name: '../../etc/passwd/../desenho.svg', content: svg }]);
    expect(res.statusCode).toBe(201);
    const f = res.json().files[0];
    expect(f.name).toBe('desenho.svg');
    const dl = await w.userA.get(`/api/files/${f.id}/download?inline=1`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/octet-stream');
    expect(String(dl.headers['content-disposition'])).toMatch(/^attachment/);
    expect(String(dl.headers['content-security-policy'])).toContain('sandbox');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
  });

  it('download é auditado', async () => {
    const r = await env.admin.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'file.download' AND actor_user_id = $1`, [w.userA.userId]);
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
});

describe('antivírus (protocolo clamd INSTREAM)', () => {
  let server: Server;
  let reply = 'stream: OK';

  beforeAll(async () => {
    server = createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        // Fim do stream: bloco de tamanho zero.
        if (buf.subarray(-4).equals(Buffer.alloc(4))) socket.end(`${reply}\0`);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  async function scanEnv() {
    const port = (server.address() as { port: number }).port;
    return createTestEnv({ CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(port) });
  }

  it('arquivo fica bloqueado até a varredura; limpo libera o download', async () => {
    const e = await scanEnv();
    try {
      const u = await seedUser(e.admin, { memberships: [{ tenantId: w.clientA.tenantId, roleKey: 'GESTOR' }] });
      const g = await login(e.app, u.email);
      reply = 'stream: OK';
      const up = (await upload(g, [{ name: 'img.png', content: PNG_1PX }])).json().files[0];
      expect(up.scanStatus).toBe('pending');
      expect((await g.get(`/api/files/${up.id}/download`)).statusCode).toBe(409);
      await drainOutbox(e);
      expect((await g.get(`/api/files/${up.id}/download`)).statusCode).toBe(200);

      reply = 'stream: Eicar-Test-Signature FOUND';
      const bad = (await upload(g, [{ name: 'eicar.png', content: PNG_1PX }])).json().files[0];
      await drainOutbox(e);
      const dl = await g.get(`/api/files/${bad.id}/download`);
      expect(dl.statusCode).toBe(403);
      const audit = await e.admin.query(`SELECT metadata->>'signature' AS s FROM audit_logs WHERE action = 'file.infected' AND resource_id = $1`, [bad.id]);
      expect(audit.rows[0].s).toBe('Eicar-Test-Signature');
    } finally {
      await e.close();
    }
  });
});

describe('RLS nas tabelas da fase 2', () => {
  it('sem contexto nada é visível; FK composta impede entregável cruzado', async () => {
    const pool = new pg.Pool({ connectionString: inject('appUrl'), max: 1 });
    try {
      for (const t of ['projects', 'demands', 'briefings', 'tasks', 'folders', 'files', 'brand_assets', 'deliverables', 'approvals', 'calendar_events']) {
        const r = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
        expect(r.rows[0].n, t).toBe(0);
      }
      const demandB = (await env.admin.query(`SELECT id FROM demands WHERE tenant_id = $1 LIMIT 1`, [w.clientB.tenantId])).rows[0].id;
      await expect(
        withContext(pool, { scope: 'global' }, (tx) =>
          tx.query(`INSERT INTO deliverables (tenant_id, demand_id, title) VALUES ($1, $2, 'cruzado')`, [w.clientA.tenantId, demandB]),
        ),
      ).rejects.toThrow(/foreign key/);
      await expect(
        withContext(pool, { scope: 'tenant', tenantIds: [w.clientA.tenantId] }, (tx) =>
          tx.query(`INSERT INTO demands (tenant_id, type, title, description) VALUES ($1, 'post', 'invasão', 'x')`, [w.clientB.tenantId]),
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await pool.end();
    }
  });
});
