/**
 * Fase 7 — Adobe Firefly Services pelo MCP Hub. A Adobe (IMS + Firefly API +
 * URLs pré-assinadas) é um servidor HTTP local que confere exatamente o
 * contrato oficial (OAuth client_credentials, Bearer + x-api-key, corpo v3).
 * Nenhuma chamada sai da máquina e nenhum crédito Adobe é consumido.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADOBE_DEFAULT_SCOPES } from '../src/mcp/connectors/adobe';
import { buildWorld, createTestEnv, drainOutbox, type TestEnv, type World } from './helpers';

const KEY = 'b'.repeat(64);
const CLIENT_ID = 'cliente-adobe-123';
const SECRET = 'p8e-segredo-adobe';
// PNG 1x1 real (o tipo é conferido pelo conteúdo ao salvar).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

interface Hit {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}
const hits: Hit[] = [];
let tokenSeq = 0;
let validToken = '';
/** Próximas respostas forçadas da Firefly (status), consumidas em ordem. */
const fireflyFailures: number[] = [];
let outputMode: 'png' | 'html' | 'missing' = 'png';
let server: http.Server;
let base = '';
let env: TestEnv;
let w: World;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      hits.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const json = (status: number, data: unknown) => void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));

      if (req.url === '/ims/token/v3' && req.method === 'POST') {
        const f = new URLSearchParams(body.toString());
        if (req.headers['content-type'] !== 'application/x-www-form-urlencoded' || f.get('grant_type') !== 'client_credentials') return json(400, { error: 'invalid_request' });
        if (f.get('client_id') !== CLIENT_ID || f.get('client_secret') !== SECRET) return json(401, { error: 'invalid_client', error_description: 'invalid client_secret parameter' });
        validToken = `tok-${++tokenSeq}`;
        return json(200, { access_token: validToken, token_type: 'bearer', expires_in: 86399 });
      }
      if (req.url!.startsWith('/out/')) {
        if (outputMode === 'missing') return void res.writeHead(403).end('expired');
        if (outputMode === 'html') return void res.writeHead(200, { 'content-type': 'image/png' }).end('<html>not an image</html>');
        return void res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
      }
      // Firefly API
      if (req.headers.authorization !== `Bearer ${validToken}`) return json(401, { error_code: 'unauthorized', message: 'Oauth token is not valid' });
      if (req.headers['x-api-key'] !== CLIENT_ID) return json(403, { error_code: 'forbidden', message: 'Api Key is invalid' });
      const forced = fireflyFailures.shift();
      if (forced) return json(forced, { error_code: 'x', message: forced === 403 ? 'User is not entitled to Firefly' : 'Service unavailable' });
      if (req.url === '/v2/storage/image') {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(req.headers['content-type'])) || !body.equals(PNG)) return json(415, { message: 'bad upload' });
        return json(200, { images: [{ id: '0b1f5d2e-9c3a-4d6e-8f7a-1b2c3d4e5f60' }] });
      }
      if (req.url === '/v3/images/generate' || req.url === '/v3/images/expand') {
        const b = JSON.parse(body.toString()) as { numVariations?: number; size: { width: number; height: number } };
        const n = b.numVariations ?? 1;
        return json(200, {
          size: b.size,
          outputs: Array.from({ length: n }, (_, i) => ({ seed: 1000 + i, image: { url: `${base}/out/${i}.png?X-Amz-Signature=abc` } })),
          promptHasDeniedWords: false,
          promptHasBlockedArtists: false,
        });
      }
      json(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  env = await createTestEnv({ CREDENTIALS_KEY: KEY, MCP_ALLOW_PRIVATE_HOSTS: 'true', ADOBE_IMS_URL: base, ADOBE_FIREFLY_URL: base });
  w = await buildWorld(env);
});
afterAll(async () => {
  await env.close();
  await new Promise((r) => server.close(r));
});

const hA = () => ({ 'x-tenant-id': w.clientA.tenantId });
const call = (id: string) => env.admin.query('SELECT * FROM mcp_tool_calls WHERE id = $1', [id]).then((r) => r.rows[0]);
/** O limite por minuto é real; os testes "envelhecem" as execuções anteriores. */
const ageCalls = () => env.admin.query(`UPDATE mcp_tool_calls SET started_at = started_at - interval '5 minutes' WHERE started_at IS NOT NULL`);
const filesOf = (ids: string[]) => env.admin.query('SELECT * FROM files WHERE id = ANY($1::uuid[]) ORDER BY name', [ids]).then((r) => r.rows);

async function run(tool: string, params: Record<string, unknown>) {
  await ageCalls();
  const r = await w.operadorA.post('/api/mcp/tool-calls', { tool, params, reason: 'Peça da campanha' }, hA());
  expect(r.statusCode, r.body).toBe(202);
  await drainOutbox(env);
  return call(r.json().id);
}

async function seedImage(tenantId: string, opts: { mime?: string; scan?: string } = {}) {
  const id = randomUUID();
  const obj = await env.ctx.storage.put(tenantId, id, Readable.from(PNG), 1_000_000);
  await env.admin.query(
    `INSERT INTO files (id, tenant_id, name, mime, size_bytes, sha256, category, scan_status, visibility) VALUES ($1, $2, 'produto.png', $3, $4, $5, 'image', $6, 'client')`,
    [id, tenantId, opts.mime ?? 'image/png', obj.sizeBytes, obj.sha256, opts.scan ?? 'skipped'],
  );
  return id;
}

describe('Fase 7 — Adobe Firefly Services', () => {
  let connId = '';

  it('catálogo: Firefly disponível; Photoshop/InDesign/Illustrator/Premiere marcados como indisponíveis com o motivo', async () => {
    const cat = (await w.gestorA.get('/api/mcp/catalog')).json();
    const adobe = cat.connectors.find((c: { key: string }) => c.key === 'adobe');
    expect(adobe).toMatchObject({ availability: 'available', testable: true });
    expect(adobe.fields.find((f: { name: string }) => f.name === 'clientSecret')).toMatchObject({ secret: true });
    const caps = adobe.capabilities as { name: string; status: string; note: string }[];
    expect(caps.filter((c) => c.status === 'available').map((c) => c.name).join()).toContain('Firefly');
    for (const p of ['Photoshop', 'InDesign', 'Illustrator', 'Premiere']) {
      const c = caps.find((x) => x.name.includes(p));
      expect(c?.status, p).toBe('unavailable');
      expect(c?.note.length).toBeGreaterThan(10);
    }
    expect(cat.tools.find((t: { name: string }) => t.name === 'adobe.generate_image')).toMatchObject({ risk: 'MEDIUM', approval: 'when_agent', allowedAgents: ['designer'] });
  });

  it('sem conexão a ferramenta não executa', async () => {
    const r = await w.operadorA.post('/api/mcp/tool-calls', { tool: 'adobe.generate_image', params: { prompt: 'Café sobre mesa de madeira' }, reason: 'Peça da campanha' }, hA());
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('not_connected');
    expect(hits.filter((h) => h.url.startsWith('/v3'))).toHaveLength(0);
  });

  it('conecta com segredo cifrado; o teste só emite token (OAuth client_credentials, escopos padrão)', async () => {
    const res = await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/adobe`, { config: { clientId: CLIENT_ID }, secrets: { clientSecret: SECRET } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(SECRET);
    connId = res.json().id;
    const row = (await env.admin.query('SELECT secret_ciphertext, config FROM mcp_connections WHERE id = $1', [connId])).rows[0];
    expect(row.secret_ciphertext).not.toContain('segredo');
    hits.length = 0;
    const t = (await w.admin.post(`/api/mcp/connections/${connId}/test`, {})).json();
    expect(t.ok).toBe(true);
    expect(hits).toHaveLength(1);
    const form = new URLSearchParams(hits[0]!.body.toString());
    expect(Object.fromEntries(form)).toEqual({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: SECRET, scope: ADOBE_DEFAULT_SCOPES });
  });

  it('credencial errada: diagnóstico claro, sem ecoar o segredo', async () => {
    await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/adobe`, { config: { clientId: CLIENT_ID }, secrets: { clientSecret: 'errado' } });
    const t = (await w.admin.post(`/api/mcp/connections/${connId}/test`, {})).json();
    expect(t.ok).toBe(false);
    expect(t.message).toContain('Adobe IMS respondeu HTTP 401');
    expect(t.message).toContain('Developer Console');
    expect(t.message).not.toContain('errado');
    await w.admin.put(`/api/mcp/connections/${w.clientA.tenantId}/adobe`, { config: { clientId: CLIENT_ID }, secrets: { clientSecret: SECRET } });
    expect((await w.admin.post(`/api/mcp/connections/${connId}/test`, {})).json().ok).toBe(true);
  });

  it('parâmetros fora do contrato oficial são recusados antes de chegar à Adobe', async () => {
    const bad = [{ prompt: 'x'.repeat(1025) }, { prompt: 'Banner', numVariations: 5 }, { prompt: 'Banner', size: '4k' }, { prompt: 'Banner', extra: 1 }];
    for (const params of bad) {
      expect((await w.operadorA.post('/api/mcp/tool-calls', { tool: 'adobe.generate_image', params, reason: 'Teste de contrato' }, hA())).json().error).toBe('invalid_params');
    }
    expect((await w.userA.post('/api/mcp/tool-calls', { tool: 'adobe.generate_image', params: { prompt: 'Banner' }, reason: 'Teste de contrato' })).statusCode).toBe(403);
  });

  let generated: string[] = [];
  it('gera imagens: contrato v3 (Bearer + x-api-key), salva como arquivos INTERNOS do cliente certo', async () => {
    const d = await w.userA.post('/api/demands', { type: 'post', title: 'Campanha de café', description: 'Peças para Instagram', priority: 'normal' });
    const demandId = d.json().id as string;
    hits.length = 0;
    const c = await run('adobe.generate_image', { prompt: 'Xícara de café fumegante, luz da manhã', numVariations: 2, size: 'portrait', contentClass: 'photo', demandId });
    expect(c.status, c.error).toBe('succeeded');
    const gen = hits.find((h) => h.url === '/v3/images/generate')!;
    expect(gen.headers['x-api-key']).toBe(CLIENT_ID);
    expect(gen.headers.authorization).toMatch(/^Bearer tok-\d+$/);
    expect(JSON.parse(gen.body.toString())).toEqual({ prompt: 'Xícara de café fumegante, luz da manhã', numVariations: 2, size: { width: 1792, height: 2304 }, contentClass: 'photo' });
    generated = c.result.data.fileIds;
    expect(generated).toHaveLength(2);
    const files = await filesOf(generated);
    expect(files.map((f) => ({ t: f.tenant_id, v: f.visibility, m: f.mime, c: f.category, d: f.demand_id }))).toEqual([
      { t: w.clientA.tenantId, v: 'internal', m: 'image/png', c: 'image', d: demandId },
      { t: w.clientA.tenantId, v: 'internal', m: 'image/png', c: 'image', d: demandId },
    ]);
    expect(files[0].name).toMatch(/^firefly-\d{12}-1\.png$/);
    expect(await env.ctx.storage.exists(w.clientA.tenantId, generated[0]!)).toBe(true);
  });

  it('o cliente não vê as imagens internas nem o evento da ferramenta; a equipe vê e baixa', async () => {
    const mine = (await w.userA.get('/api/files')).json().items.map((f: { id: string }) => f.id);
    expect(mine).not.toContain(generated[0]);
    expect((await w.userA.get(`/api/files/${generated[0]}/download`)).statusCode).toBe(404);
    const dl = await w.gestorA.get(`/api/files/${generated[0]}/download`, hA());
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(PNG)).toBe(true);
    const tl = (await w.userA.get(`/api/clients/${w.clientA.id}/events`)).body;
    expect(tl).not.toContain('mcp.adobe_images');
  });

  it('token em cache entre chamadas; 401 da Firefly renova o token uma vez', async () => {
    hits.length = 0;
    expect((await run('adobe.generate_image', { prompt: 'Grãos de café em close' })).status).toBe('succeeded');
    expect(hits.filter((h) => h.url === '/ims/token/v3')).toHaveLength(0);
    validToken = 'token-girado-pela-adobe';
    hits.length = 0;
    const c = await run('adobe.generate_image', { prompt: 'Grãos de café em close' });
    expect(c.status, c.error).toBe('succeeded');
    expect(hits.filter((h) => h.url === '/ims/token/v3')).toHaveLength(1);
    expect(hits.filter((h) => h.url === '/v3/images/generate')).toHaveLength(2);
  });

  it('sem direito ao Firefly (403): falha com orientação, sem nova tentativa', async () => {
    fireflyFailures.push(403);
    const c = await run('adobe.generate_image', { prompt: 'Banner de lançamento' });
    expect(c.status).toBe('failed');
    expect(c.error).toContain('Firefly Services');
  });

  it('Adobe instável (503): volta para a fila com backoff', async () => {
    fireflyFailures.push(503);
    const c = await run('adobe.generate_image', { prompt: 'Banner de lançamento' });
    expect(c.status).toBe('queued');
    expect(c.error).toContain('503');
    await env.admin.query(`UPDATE mcp_tool_calls SET status = 'cancelled' WHERE id = $1`, [c.id]);
    await env.admin.query(`UPDATE outbox_events SET status = 'done' WHERE type = 'mcp.call' AND status = 'pending'`);
    await env.admin.query(`UPDATE mcp_connections SET consecutive_failures = 0, circuit_open_until = NULL, status = 'active' WHERE id = $1`, [connId]);
  });

  it('depois da cobrança, falha ao salvar NÃO gera de novo e não deixa arquivo órfão', async () => {
    for (const mode of ['html', 'missing'] as const) {
      outputMode = mode;
      const before = Number((await env.admin.query('SELECT count(*) FROM files WHERE tenant_id = $1', [w.clientA.tenantId])).rows[0].count);
      hits.length = 0;
      const c = await run('adobe.generate_image', { prompt: 'Mesa posta', numVariations: 2 });
      expect(c.status, mode).toBe('failed');
      expect(c.error).toContain('não foi possível salvá-las');
      expect(hits.filter((h) => h.url === '/v3/images/generate')).toHaveLength(1);
      expect(Number((await env.admin.query('SELECT count(*) FROM files WHERE tenant_id = $1', [w.clientA.tenantId])).rows[0].count)).toBe(before);
    }
    outputMode = 'png';
  });

  it('expande uma imagem do cliente: upload oficial + /v3/images/expand; o original fica intacto', async () => {
    const src = await seedImage(w.clientA.tenantId);
    hits.length = 0;
    const c = await run('adobe.expand_image', { fileId: src, size: 'widescreen', prompt: 'Continuação da mesa de madeira' });
    expect(c.status, c.error).toBe('succeeded');
    const up = hits.find((h) => h.url === '/v2/storage/image')!;
    expect(up.headers['content-type']).toBe('image/png');
    expect(up.body.equals(PNG)).toBe(true);
    const ex = JSON.parse(hits.find((h) => h.url === '/v3/images/expand')!.body.toString());
    expect(ex).toEqual({ image: { source: { uploadId: '0b1f5d2e-9c3a-4d6e-8f7a-1b2c3d4e5f60' } }, size: { width: 2688, height: 1536 }, numVariations: 1, prompt: 'Continuação da mesa de madeira' });
    const [out] = await filesOf(c.result.data.fileIds);
    expect(out).toMatchObject({ tenant_id: w.clientA.tenantId, visibility: 'internal', name: 'produto-expandida-widescreen.png' });
    expect((await filesOf([src]))[0].deleted_at).toBeNull();
  });

  it('isolamento: imagem de outro cliente, não liberada pelo antivírus ou de tipo não aceito é recusada', async () => {
    const other = await seedImage(w.clientB.tenantId);
    const scanning = await seedImage(w.clientA.tenantId, { scan: 'pending' });
    const gif = await seedImage(w.clientA.tenantId, { mime: 'image/gif' });
    for (const fileId of [other, scanning, gif]) {
      const r = await w.operadorA.post('/api/mcp/tool-calls', { tool: 'adobe.expand_image', params: { fileId, size: 'square' }, reason: 'Teste de contrato' }, hA());
      expect(r.statusCode, fileId).toBe(400);
      expect(r.json().message).toMatch(/não encontrado|verificação de segurança|JPEG, PNG ou WEBP/);
    }
    expect((await env.admin.query(`SELECT count(*) FROM mcp_tool_calls WHERE params->>'fileId' = ANY($1)`, [[other, scanning, gif]])).rows[0].count).toBe('0');
  });
});
