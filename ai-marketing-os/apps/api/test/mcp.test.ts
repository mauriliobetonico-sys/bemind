/**
 * Fase 5 — MCP Hub: conexões cifradas, política de ferramentas, aprovação
 * humana obrigatória para risco alto, agentes propondo ações, circuit
 * breaker, SSRF e isolamento entre clientes. Serviços externos são
 * servidores HTTP locais (WordPress e webhook) — nenhuma chamada sai da máquina.
 */
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../src/db/pool';
import { CredentialVault } from '../src/mcp/crypto';
import { assertSafeUrl, isPrivateAddress, safeRequest } from '../src/mcp/http';
import { markdownToHtml } from '../src/mcp/connectors/wordpress';
import { executeToolCall, needsApproval } from '../src/mcp/hub';
import { buildWorld, createTestEnv, drainOutbox, login, seedUser, type TestEnv, type World } from './helpers';
import { FakeProvider } from './fake-ai';

const KEY = 'a'.repeat(64);
let env: TestEnv;
let w: World;
const fake = new FakeProvider();

// ------------------------------------------------------------- serviços locais
interface Hit {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}
const wpHits: Hit[] = [];
const hookHits: Hit[] = [];
let hookFail = false;
let nextPostId = 100;
const WP_USER = 'editor';
const WP_PASS = 'abcd efgh ijkl mnop';
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const hit = { method: req.method!, url: req.url!, headers: req.headers, body };
      if (req.url!.startsWith('/hook')) {
        hookHits.push(hit);
        res.writeHead(hookFail ? 500 : 200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      }
      wpHits.push(hit);
      const auth = `Basic ${Buffer.from(`${WP_USER}:${WP_PASS.replace(/\s+/g, '')}`).toString('base64')}`;
      if (req.headers.authorization !== auth) return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"message":"Senha inválida"}');
      if (req.url === '/wp-json/wp/v2/users/me?context=edit') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"name":"Editor Cliente","roles":["editor"]}');
      const m = req.url!.match(/^\/wp-json\/wp\/v2\/posts(?:\/(\d+))?$/);
      if (m && req.method === 'POST') {
        const id = m[1] ? Number(m[1]) : nextPostId++;
        const b = JSON.parse(body) as { status: string };
        return void res.writeHead(m[1] ? 200 : 201, { 'content-type': 'application/json' }).end(JSON.stringify({ id, status: b.status, link: `https://cliente.test/?p=${id}` }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  env = await createTestEnv({ CREDENTIALS_KEY: KEY, MCP_ALLOW_PRIVATE_HOSTS: 'true' }, { aiProvider: fake });
  w = await buildWorld(env);
});
afterAll(async () => {
  await env.close();
  await new Promise((r) => server.close(r));
});

const hA = () => ({ 'x-tenant-id': w.clientA.tenantId });
const call = (id: string) => env.admin.query('SELECT * FROM mcp_tool_calls WHERE id = $1', [id]).then((r) => r.rows[0]);

async function newDeliverable(status = 'draft') {
  const d = await w.userA.post('/api/demands', { type: 'post', title: 'Post do blog', description: 'Artigo sobre lançamento', priority: 'normal' });
  const demandId = d.json().id;
  const r = await env.admin.query(
    `INSERT INTO deliverables (tenant_id, demand_id, title, description, status) VALUES ($1, $2, 'Lançamento de verão', $3, $4) RETURNING id`,
    [w.clientA.tenantId, demandId, '# Novidade\n\nTexto com **destaque** e <script>alert(1)</script>.\n\n- item 1\n- item 2\n\n---\nObservações do agente (Copywriter): interno', status],
  );
  return { demandId, deliverableId: r.rows[0].id as string };
}

// ------------------------------------------------------------- unidades
describe('blocos de segurança', () => {
  it('cofre de credenciais: AES-GCM com AAD por tenant e conexão', () => {
    const v = new CredentialVault(KEY);
    const ct = v.encrypt({ appPassword: 'segredo' }, 't1', 'c1');
    expect(ct).not.toContain('segredo');
    expect(v.decrypt(ct, 't1', 'c1')).toEqual({ appPassword: 'segredo' });
    expect(() => v.decrypt(ct, 't2', 'c1')).toThrow(); // copiado para outro tenant: não decifra
    const parts = ct.split('.');
    const body = Buffer.from(parts[3]!, 'base64');
    body[0] = body[0]! ^ 0xff;
    expect(() => v.decrypt([parts[0], parts[1], parts[2], body.toString('base64')].join('.'), 't1', 'c1')).toThrow(); // adulterado
  });

  it('SSRF: endereços privados, metadados de nuvem e http sem TLS são recusados', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(() => assertSafeUrl('http://exemplo.com', false)).toThrow(/HTTPS/);
    expect(() => assertSafeUrl('https://169.254.169.254/latest', false)).toThrow(/privado/);
    expect(() => assertSafeUrl('https://user:pw@exemplo.com', false)).toThrow(/Credenciais/);
    expect(() => assertSafeUrl('file:///etc/passwd', false)).toThrow();
    // Nome que resolve para loopback: barrado no momento da conexão (DNS validado no lookup).
    await expect(safeRequest('GET', 'https://localhost:1/', { allowPrivate: false })).rejects.toThrow(/privado/);
  });

  it('risco alto sempre exige aprovação; médio só quando um agente pede', () => {
    expect(needsApproval('HIGH', 'user')).toBe(true);
    expect(needsApproval('HIGH', 'agent')).toBe(true);
    expect(needsApproval('MEDIUM', 'agent')).toBe(true);
    expect(needsApproval('MEDIUM', 'user')).toBe(false);
    expect(needsApproval('LOW', 'agent')).toBe(false);
  });

  it('markdown publicado é escapado (sem HTML injetado)', () => {
    const html = markdownToHtml('# T\n\n<img src=x onerror=alert(1)> **b**\n\n- a');
    expect(html).toContain('<h2>T</h2>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('<ul><li>a</li></ul>');
  });
});

// ------------------------------------------------------------- conexões
describe('conexões por cliente', () => {
  let connId: string;

  it('catálogo: equipe vê; cliente não; integrações sem app oficial aparecem como pendentes', async () => {
    expect((await w.userA.get('/api/mcp/catalog')).statusCode).toBe(403);
    const cat = (await w.gestorA.get('/api/mcp/catalog')).json();
    expect(cat.credentialsKey).toBe('configured');
    expect(cat.connectors.find((c: { key: string }) => c.key === 'meta').availability).toBe('integration_pending');
    expect(cat.connectors.find((c: { key: string }) => c.key === 'wordpress').availability).toBe('available');
    expect(cat.tools.find((t: { name: string }) => t.name === 'wordpress.publish_post')).toMatchObject({ risk: 'HIGH', approval: 'always' });
  });

  it('só papéis globais conectam; segredo nunca volta na resposta e fica cifrado no banco', async () => {
    const body = { config: { siteUrl: base, username: WP_USER }, secrets: { appPassword: WP_PASS } };
    expect((await w.gestorA.put(`/api/mcp/connections/${w.clientA.tenantId}/wordpress`, body)).statusCode).toBe(403);
    expect((await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/wordpress`, { ...body, config: { ...body.config, extra: 'x' } })).statusCode).toBe(400);
    expect((await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/meta`, { config: {} })).json().error).toBe('integration_pending');
    const res = await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/wordpress`, body);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(WP_PASS);
    expect(res.json()).toMatchObject({ connector: 'wordpress', status: 'active', hasSecret: true });
    connId = res.json().id;
    const row = (await env.admin.query('SELECT secret_ciphertext, config FROM mcp_connections WHERE id = $1', [connId])).rows[0];
    expect(row.secret_ciphertext).not.toContain('abcd');
    expect(JSON.stringify(row.config)).not.toContain('abcd');
    const audit = (await env.admin.query(`SELECT metadata FROM audit_logs WHERE action = 'mcp.connection_created' AND resource_id = $1`, [connId])).rows[0];
    expect(JSON.stringify(audit.metadata)).not.toContain('abcd');
    expect(audit.metadata.credentialFieldsChanged).toEqual(['appPassword']);
  });

  it('testar conexão usa as credenciais reais (sem efeito colateral)', async () => {
    const t = (await w.admin.post(`/api/mcp/connections/${connId}/test`, {})).json();
    expect(t).toEqual({ ok: true, message: 'Conectado como Editor Cliente (editor)' });
  });

  it('atualizar sem reenviar a senha mantém o segredo', async () => {
    const res = await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/wordpress`, { label: 'Site principal', config: { siteUrl: base, username: WP_USER } });
    expect(res.json()).toMatchObject({ hasSecret: true, label: 'Site principal' });
    expect((await w.admin.post(`/api/mcp/connections/${connId}/test`, {})).json().ok).toBe(true);
  });

  it('equipe do cliente B não vê nem testa a conexão do A', async () => {
    const gB = await seedUser(env.admin, { memberships: [{ tenantId: w.clientB.tenantId, roleKey: 'GESTOR' }] });
    const agentB = await login(env.app, gB.email);
    expect((await agentB.get('/api/mcp/connections')).json().items).toHaveLength(0);
    expect((await agentB.get('/api/mcp/connections', hA())).statusCode).toBe(403);
    const rls = await withContext(env.ctx.pool, { scope: 'tenant', tenantIds: [w.clientB.tenantId] }, async (tx) => (await tx.query('SELECT count(*)::int AS n FROM mcp_connections')).rows[0].n);
    expect(rls).toBe(0);
  });
});

// ------------------------------------------------------------- chamadas humanas
describe('ferramentas acionadas por pessoas', () => {
  let deliverableId: string;

  it('risco baixo executa direto (tarefa interna)', async () => {
    const r = await w.gestorA.post('/api/mcp/tool-calls', { tool: 'internal.create_task', params: { title: 'Revisar SEO do post' }, reason: 'Checklist do lançamento' }, hA());
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe('queued');
    await drainOutbox(env);
    const c = await call(r.json().id);
    expect(c.status).toBe('succeeded');
    expect((await env.admin.query('SELECT 1 FROM tasks WHERE id = $1 AND tenant_id = $2', [c.result.data.taskId, w.clientA.tenantId])).rowCount).toBe(1);
  });

  it('parâmetros inválidos e cliente sem permissão são recusados antes de qualquer execução', async () => {
    expect((await w.gestorA.post('/api/mcp/tool-calls', { tool: 'internal.create_task', params: { title: 'x', hack: 1 }, reason: 'teste' }, hA())).json().error).toBe('invalid_params');
    expect((await w.userA.post('/api/mcp/tool-calls', { tool: 'internal.create_task', params: { title: 'Tarefa' }, reason: 'teste' })).statusCode).toBe(403);
    expect((await w.gestorA.post('/api/mcp/tool-calls', { tool: 'nada.existe', params: {}, reason: 'teste' }, hA())).statusCode).toBe(400);
  });

  it('risco médio por pessoa: rascunho no WordPress sem as observações internas e com HTML escapado', async () => {
    deliverableId = (await newDeliverable()).deliverableId;
    const r = await w.operadorA.post('/api/mcp/tool-calls', { tool: 'wordpress.create_draft', params: { deliverableId }, reason: 'Rascunho para revisão' }, hA());
    expect(r.json().status).toBe('queued');
    wpHits.length = 0;
    await drainOutbox(env);
    const c = await call(r.json().id);
    expect(c.status).toBe('succeeded');
    const post = JSON.parse(wpHits.find((h) => h.method === 'POST')!.body);
    expect(post.status).toBe('draft');
    expect(post.content).toContain('<strong>destaque</strong>');
    expect(post.content).toContain('&lt;script&gt;');
    expect(post.content).not.toContain('Observações do agente');
  });

  it('risco alto: só entregável aprovado; fica aguardando decisão humana e NADA executa antes', async () => {
    expect((await w.gestorA.post('/api/mcp/tool-calls', { tool: 'wordpress.publish_post', params: { deliverableId }, reason: 'Publicar' }, hA())).json().error).toBe('invalid_request');
    await env.admin.query(`UPDATE deliverables SET status = 'approved' WHERE id = $1`, [deliverableId]);
    const r = await w.operadorA.post('/api/mcp/tool-calls', { tool: 'wordpress.publish_post', params: { deliverableId }, reason: 'Cliente aprovou' }, hA());
    expect(r.json().status).toBe('pending_approval');
    wpHits.length = 0;
    await drainOutbox(env);
    expect(wpHits).toHaveLength(0);
    expect((await call(r.json().id)).status).toBe('pending_approval');
    // Mesmo forçando a execução, o worker não roda o que não foi aprovado.
    await executeToolCall(env.ctx, w.clientA.tenantId, r.json().id, { lastAttempt: true });
    expect(wpHits).toHaveLength(0);
    expect((await w.operadorA.post(`/api/mcp/tool-calls/${r.json().id}/decide`, { decision: 'approve' })).statusCode).toBe(403);
    const ok = await w.gestorA.post(`/api/mcp/tool-calls/${r.json().id}/decide`, { decision: 'approve', note: 'ok' });
    expect(ok.json().status).toBe('queued');
    await drainOutbox(env);
    const c = await call(r.json().id);
    expect(c.status).toBe('succeeded');
    // Publica o mesmo post do rascunho (atualiza, não duplica).
    expect(wpHits.find((h) => h.method === 'POST')!.url).toBe(`/wp-json/wp/v2/posts/${100}`);
    expect(c.result.data.wpStatus).toBe('publish');
    const audit = (await env.admin.query(`SELECT action FROM audit_logs WHERE resource_id = $1 ORDER BY created_at`, [r.json().id])).rows.map((x) => x.action);
    expect(audit).toEqual(['mcp.tool_requested', 'mcp.tool_approved', 'mcp.tool_executed']);
  });

  it('o banco recusa risco alto sem aprovação e fila sem decisão humana', async () => {
    const ins = (status: string, requires: boolean) =>
      withContext(env.ctx.pool, { scope: 'tenant', tenantIds: [w.clientA.tenantId] }, (tx) =>
        tx.query(`INSERT INTO mcp_tool_calls (tenant_id, tool, connector, risk, status, requires_approval, requested_by_agent) VALUES ($1, 'wordpress.publish_post', 'wordpress', 'HIGH', $2, $3, 'social_media')`, [w.clientA.tenantId, status, requires]),
      );
    await expect(ins('queued', false)).rejects.toThrow();
    await expect(ins('queued', true)).rejects.toThrow();
  });

  it('e-mail ao cliente: precisa ativar; destinatários definidos pelo servidor; política pode exigir outra pessoa', async () => {
    expect((await w.admin.post('/api/mcp/tool-calls', { tool: 'email.send_to_client', params: { subject: 'Novidade', message: 'Seu post foi publicado hoje.' }, reason: 'Aviso' }, hA())).json().error).toBe('not_connected');
    await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/email`, { config: {} });
    expect((await w.gestorA.put('/api/mcp/policies/email.send_to_client', { enabled: true, allowSelfApproval: false })).statusCode).toBe(403);
    expect((await w.admin.put('/api/mcp/policies/email.send_to_client', { enabled: true, allowSelfApproval: false })).statusCode).toBe(200);
    const r = await w.admin.post('/api/mcp/tool-calls', { tool: 'email.send_to_client', params: { subject: 'Novidade', message: 'Seu post foi publicado hoje.' }, reason: 'Aviso' }, hA());
    expect(r.json().status).toBe('pending_approval');
    expect((await w.admin.post(`/api/mcp/tool-calls/${r.json().id}/decide`, { decision: 'approve' })).statusCode).toBe(403);
    env.mailer.sent.length = 0;
    await w.gestorA.post(`/api/mcp/tool-calls/${r.json().id}/decide`, { decision: 'approve' });
    await drainOutbox(env);
    const clientEmail = (await env.admin.query(`SELECT u.email FROM tenant_users tu JOIN users u ON u.id = tu.user_id WHERE tu.tenant_id = $1 AND tu.role_key = 'CLIENTE'`, [w.clientA.tenantId])).rows.map((x) => x.email);
    expect(env.mailer.sent.filter((m) => m.subject.startsWith('Novidade')).map((m) => m.to)).toEqual(clientEmail);
    expect((await call(r.json().id)).status).toBe('succeeded');
  });

  it('ferramenta desligada pela política não aceita pedidos', async () => {
    await w.admin.put('/api/mcp/policies/internal.schedule_event', { enabled: false, allowSelfApproval: true });
    const r = await w.gestorA.post('/api/mcp/tool-calls', { tool: 'internal.schedule_event', params: { title: 'Reunião', kind: 'meeting', startsAt: '2030-01-10T10:00:00Z' }, reason: 'Alinhamento' }, hA());
    expect(r.json().error).toBe('tool_disabled');
    await w.admin.put('/api/mcp/policies/internal.schedule_event', { enabled: true, allowSelfApproval: true });
  });

  it('entregável de outro cliente não pode ser usado (RLS na validação)', async () => {
    const d = await w.userB.post('/api/demands', { type: 'post', title: 'Post B', description: 'Artigo do cliente B', priority: 'normal' });
    const vB = (await env.admin.query(`INSERT INTO deliverables (tenant_id, demand_id, title) VALUES ($1, $2, 'Do B') RETURNING id`, [w.clientB.tenantId, d.json().id])).rows[0].id;
    const r = await w.gestorA.post('/api/mcp/tool-calls', { tool: 'wordpress.create_draft', params: { deliverableId: vB }, reason: 'Tentativa cruzada' }, hA());
    expect(r.json().error).toBe('invalid_request');
  });

  it('o cliente nunca vê eventos de ferramentas na própria linha do tempo', async () => {
    const ev = (await w.userA.get(`/api/clients/${w.clientA.id}/events`)).json().items as { type: string }[];
    expect(ev.some((e) => e.type.startsWith('mcp.'))).toBe(false);
  });
});

// ------------------------------------------------------------- agentes
describe('agentes propõem; o Hub decide', () => {
  it('copywriter propõe rascunho (vai para aprovação), tarefa (executa) e e-mail (proibido para ele)', async () => {
    fake.actions = {
      Copywriter: [
        { tool: 'wordpress.create_draft', paramsJson: JSON.stringify({ deliverableId: 'ESTE_ENTREGAVEL' }), reason: 'Levar ao site' },
        { tool: 'internal.create_task', paramsJson: JSON.stringify({ title: 'Escolher imagem destacada' }), reason: 'Falta imagem' },
        { tool: 'email.send_to_client', paramsJson: JSON.stringify({ subject: 'Oi', message: 'Mensagem longa o bastante' }), reason: 'Avisar' },
      ],
    };
    const d = await w.userA.post('/api/demands', { type: 'post', title: 'Post com IA', description: 'Artigo', priority: 'normal' });
    await w.gestorA.post(`/api/demands/${d.json().id}/ai/plan`, {});
    wpHits.length = 0;
    await drainOutbox(env);
    fake.actions = {};
    const run = (await env.admin.query(`SELECT id, output, deliverable_id FROM agent_runs WHERE demand_id = $1 AND agent_key = 'copywriter' AND revision = 0`, [d.json().id])).rows[0];
    const actions = run.output.actions as { tool: string; status: string; error?: string }[];
    expect(actions.map((a) => `${a.tool}:${a.status}`)).toEqual(['wordpress.create_draft:pending_approval', 'internal.create_task:queued', 'email.send_to_client:rejected']);
    const calls = (await env.admin.query('SELECT tool, status, requested_by_agent, deliverable_id FROM mcp_tool_calls WHERE run_id = $1 ORDER BY created_at', [run.id])).rows;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ tool: 'wordpress.create_draft', status: 'pending_approval', requested_by_agent: 'copywriter', deliverable_id: run.deliverable_id });
    expect(calls[1]).toMatchObject({ tool: 'internal.create_task', status: 'succeeded' });
    expect(wpHits).toHaveLength(0); // nada foi ao WordPress sem decisão humana
    // o prompt listou só as ferramentas permitidas ao copywriter
    const prompt = JSON.stringify(fake.requests.find((r) => r.system.startsWith('Você é Copywriter'))!.messages);
    expect(prompt).toContain('wordpress.create_draft');
    expect(prompt).not.toContain('wordpress.publish_post');
    expect(prompt).not.toContain('email.send_to_client');
  });
});

// ------------------------------------------------------------- resiliência
describe('webhook, circuit breaker e remoção', () => {
  let connId: string;

  it('evento assinado com HMAC-SHA256', async () => {
    connId = (await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/webhook`, { config: { url: `${base}/hook` }, secrets: { secret: 'segredo-do-n8n' } })).json().id;
    const r = await w.gestorA.post('/api/mcp/tool-calls', { tool: 'webhook.trigger', params: { event: 'post.publicado', data: { id: 1 } }, reason: 'Avisar n8n' }, hA());
    hookHits.length = 0;
    await drainOutbox(env);
    expect((await call(r.json().id)).status).toBe('succeeded');
    const h = hookHits[0]!;
    const expected = `sha256=${createHmac('sha256', 'segredo-do-n8n').update(`${h.headers['x-aimos-timestamp']}.${h.body}`).digest('hex')}`;
    expect(h.headers['x-aimos-signature']).toBe(expected);
    expect(JSON.parse(h.body)).toMatchObject({ event: 'post.publicado', data: { id: 1 }, tenantId: w.clientA.tenantId });
  });

  it('falhas seguidas abrem o circuito: novas chamadas não batem no serviço', async () => {
    hookFail = true;
    for (let i = 0; i < 5; i++) {
      await w.gestorA.post('/api/mcp/tool-calls', { tool: 'webhook.trigger', params: { event: 'teste', data: {} }, reason: `falha ${i}` }, hA());
    }
    hookHits.length = 0;
    const r = await drainOutbox(env);
    expect(r.failed).toBe(5); // transitórias: voltam à fila com backoff
    expect(hookHits).toHaveLength(5);
    const conn = (await env.admin.query('SELECT status, consecutive_failures, circuit_open_until > now() AS open FROM mcp_connections WHERE id = $1', [connId])).rows[0];
    expect(conn).toMatchObject({ status: 'error', consecutive_failures: 5, open: true });
    const next = await w.gestorA.post('/api/mcp/tool-calls', { tool: 'webhook.trigger', params: { event: 'teste', data: {} }, reason: 'depois' }, hA());
    hookHits.length = 0;
    await drainOutbox(env);
    expect(hookHits).toHaveLength(0);
    expect((await call(next.json().id)).status).toBe('queued');
    hookFail = false;
  });

  it('remover a integração cancela o que ainda não rodou', async () => {
    const pendente = (await env.admin.query(`SELECT id FROM mcp_tool_calls WHERE connection_id = $1 AND status = 'queued' LIMIT 1`, [connId])).rows[0].id;
    expect((await w.admin.delete(`/api/mcp/connections/${connId}`)).statusCode).toBe(204);
    expect((await call(pendente)).status).toBe('cancelled');
  });
});

describe('sem CREDENTIALS_KEY', () => {
  it('não salva segredo (nunca em texto puro)', async () => {
    const env2 = await createTestEnv({});
    try {
      const sa = await seedUser(env2.admin, { globalRole: 'SUPER_ADMIN' });
      const agent = await login(env2.app, sa.email);
      const tenant = (await env2.admin.query(`SELECT tenant_id FROM clients LIMIT 1`)).rows[0].tenant_id;
      const r = await agent.put(`/api/mcp/connections/${tenant}/webhook`, { config: { url: 'https://n8n.exemplo.com/webhook/x' }, secrets: { secret: 's' } });
      expect(r.json().error).toBe('credentials_key_missing');
    } finally {
      await env2.close();
    }
  });
});
