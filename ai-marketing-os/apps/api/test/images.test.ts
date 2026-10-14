/**
 * Gerador de imagens (OpenAI Images API) pelo MCP Hub. A OpenAI é um servidor
 * HTTP local que confere o contrato oficial (Bearer, /images/generations em
 * JSON, /images/edits em multipart com `image[]`, resposta em b64_json).
 * Nenhuma chamada sai da máquina e nada é cobrado.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { friendlyAnthropicError, modelFeatures } from '../src/ai/provider';
import { buildWorld, createTestEnv, drainOutbox, type TestEnv, type World } from './helpers';

const KEY = 'sk-test-local';
// PNG 1x1 real (o tipo é conferido pelo conteúdo ao salvar).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

interface Hit {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}
const hits: Hit[] = [];
const forced: { status: number; code?: string; message?: string }[] = [];
let returnGarbage = false;
let server: http.Server;
let env: TestEnv;
let noKey: TestEnv;
let w: World;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      hits.push({ url: req.url!, headers: req.headers, body });
      const json = (status: number, data: unknown) => void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
      if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } });
      const f = forced.shift();
      if (f) return json(f.status, { error: { message: f.message ?? 'erro', code: f.code ?? null } });
      let n = 1;
      if (req.url === '/v1/images/generations') {
        n = (JSON.parse(body.toString()) as { n?: number }).n ?? 1;
      } else if (req.url === '/v1/images/edits') {
        if (!String(req.headers['content-type']).startsWith('multipart/form-data; boundary=')) return json(400, { error: { message: 'multipart esperado' } });
        n = Number(/name="n"\r\n\r\n(\d+)/.exec(body.toString('latin1'))?.[1] ?? 1);
      } else return json(404, { error: { message: 'not found' } });
      const img = returnGarbage ? Buffer.from('<html>nada</html>') : PNG;
      json(200, { created: 1, data: Array.from({ length: n }, () => ({ b64_json: img.toString('base64') })), usage: { input_tokens: 50, output_tokens: 1000 } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  env = await createTestEnv({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: base, MCP_ALLOW_PRIVATE_HOSTS: 'true', OPENAI_IMAGE_MODEL: 'gpt-image-2', OPENAI_IMAGE_QUALITY: 'medium' });
  w = await buildWorld(env);
  noKey = await createTestEnv({ OPENAI_BASE_URL: base, MCP_ALLOW_PRIVATE_HOSTS: 'true' });
});
afterAll(async () => {
  await env.close();
  await noKey.close();
  await new Promise((r) => server.close(r));
});

const hA = () => ({ 'x-tenant-id': w.clientA.tenantId });
const call = (id: string) => env.admin.query('SELECT * FROM mcp_tool_calls WHERE id = $1', [id]).then((r) => r.rows[0]);
const ageCalls = () => env.admin.query(`UPDATE mcp_tool_calls SET started_at = started_at - interval '5 minutes' WHERE started_at IS NOT NULL`);
const filesOf = (ids: string[]) => env.admin.query('SELECT * FROM files WHERE id = ANY($1::uuid[]) ORDER BY name', [ids]).then((r) => r.rows);
const countFiles = async () => Number((await env.admin.query('SELECT count(*) FROM files WHERE tenant_id = $1', [w.clientA.tenantId])).rows[0].count);

async function run(tool: string, params: Record<string, unknown>) {
  await ageCalls();
  const r = await w.operadorA.post('/api/mcp/tool-calls', { tool, params, reason: 'Peça da campanha' }, hA());
  expect(r.statusCode, r.body).toBe(202);
  await drainOutbox(env);
  return call(r.json().id);
}

async function seedImage(tenantId: string, opts: { mime?: string; scan?: string; name?: string } = {}) {
  const id = randomUUID();
  const obj = await env.ctx.storage.put(tenantId, id, Readable.from(PNG), 1_000_000);
  await env.admin.query(
    `INSERT INTO files (id, tenant_id, name, mime, size_bytes, sha256, category, scan_status, visibility) VALUES ($1, $2, $3, $4, $5, $6, 'image', $7, 'client')`,
    [id, tenantId, opts.name ?? 'produto.png', opts.mime ?? 'image/png', obj.sizeBytes, obj.sha256, opts.scan ?? 'skipped'],
  );
  return id;
}

describe('Modelo dos agentes', () => {
  it('Haiku não recebe effort nem fallback do servidor (evita erro 400); Opus 5.5 recebe', () => {
    expect(modelFeatures('claude-haiku-4-5')).toEqual({ effort: false, serverFallback: false });
    expect(modelFeatures('claude-haiku-4-5-20251001')).toEqual({ effort: false, serverFallback: false });
    expect(modelFeatures('claude-sonnet-5-5')).toEqual({ effort: true, serverFallback: true });
    expect(modelFeatures('claude-opus-5-5')).toEqual({ effort: true, serverFallback: true });
    expect(modelFeatures('claude-opus-4-8')).toEqual({ effort: true, serverFallback: false });
  });

  it('sem créditos: mensagem clara em vez do JSON da API', () => {
    const raw = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
    expect(friendlyAnthropicError(400, raw)).toMatch(/^Sem créditos na conta Anthropic/);
    expect(friendlyAnthropicError(401, 'invalid x-api-key')).toContain('ANTHROPIC_API_KEY');
  });

  it('modelo padrão é o Haiku 4.5', () => {
    expect(noKey.ctx.env.AI_MODEL).toBe('claude-haiku-4-5');
  });
});

describe('Gerador de imagens (OpenAI)', () => {
  it('a Adobe saiu do catálogo; o gerador aparece pronto com a chave e "pendente" sem ela', async () => {
    const cat = (await w.gestorA.get('/api/mcp/catalog')).json();
    expect(cat.connectors.find((c: { key: string }) => c.key === 'adobe')).toBeUndefined();
    expect(cat.tools.some((t: { name: string }) => t.name.startsWith('adobe.'))).toBe(false);
    expect(cat.connectors.find((c: { key: string }) => c.key === 'images')).toMatchObject({ availability: 'available', builtIn: true });
    expect(cat.tools.find((t: { name: string }) => t.name === 'images.generate')).toMatchObject({ risk: 'MEDIUM', approval: 'when_agent' });

    const w2 = await buildWorld(noKey);
    const cat2 = (await w2.gestorA.get('/api/mcp/catalog')).json();
    expect(cat2.connectors.find((c: { key: string }) => c.key === 'images')).toMatchObject({ availability: 'integration_pending' });
    const r = await w2.operadorA.post('/api/mcp/tool-calls', { tool: 'images.generate', params: { prompt: 'Banner de café' }, reason: 'Peça da campanha' }, { 'x-tenant-id': w2.clientA.tenantId });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toContain('OPENAI_API_KEY');
  });

  it('parâmetros fora do contrato e cliente sem permissão são recusados antes da OpenAI', async () => {
    hits.length = 0;
    for (const params of [{ prompt: 'x'.repeat(4001) }, { prompt: 'Banner', n: 5 }, { prompt: 'Banner', size: '4k' }, { prompt: 'Banner', extra: 1 }]) {
      expect((await w.operadorA.post('/api/mcp/tool-calls', { tool: 'images.generate', params, reason: 'Teste de contrato' }, hA())).json().error).toBe('invalid_params');
    }
    expect((await w.userA.post('/api/mcp/tool-calls', { tool: 'images.generate', params: { prompt: 'Banner' }, reason: 'Teste de contrato' })).statusCode).toBe(403);
    expect(hits).toHaveLength(0);
  });

  let generated: string[] = [];
  it('gera com o contexto de marca do cliente; salva como arquivos INTERNOS do cliente certo', async () => {
    await env.admin.query(`UPDATE clients SET segment = 'Cafeteria' WHERE tenant_id = $1`, [w.clientA.tenantId]);
    await env.admin.query(`INSERT INTO brand_assets (tenant_id, kind, title, value) VALUES ($1, 'color', 'Marrom café', '#5A3825'), ($1, 'font', 'Títulos', 'Montserrat')`, [w.clientA.tenantId]);
    await env.admin.query(`INSERT INTO brand_assets (tenant_id, kind, title, value) VALUES ($1, 'color', 'Vermelho do cliente B', '#FF0000')`, [w.clientB.tenantId]);
    const d = await w.userA.post('/api/demands', { type: 'post', title: 'Campanha de café', description: 'Peças para Instagram', priority: 'normal' });
    const demandId = d.json().id as string;
    hits.length = 0;
    const c = await run('images.generate', { prompt: 'Xícara de café fumegante, luz da manhã', n: 2, size: 'portrait', demandId });
    expect(c.status, c.error).toBe('succeeded');
    const req = JSON.parse(hits.find((h) => h.url === '/v1/images/generations')!.body.toString());
    expect(req).toMatchObject({ model: 'gpt-image-2', n: 2, size: '1024x1536', quality: 'medium' });
    expect(req.prompt).toContain('Xícara de café fumegante');
    expect(req.prompt).toContain('#5A3825');
    expect(req.prompt).toContain('Montserrat');
    expect(req.prompt).toContain('Cafeteria');
    expect(req.prompt).not.toContain('#FF0000'); // nada da marca de outro cliente
    generated = c.result.data.fileIds;
    const files = await filesOf(generated);
    expect(files.map((f) => ({ t: f.tenant_id, v: f.visibility, m: f.mime, d: f.demand_id }))).toEqual([
      { t: w.clientA.tenantId, v: 'internal', m: 'image/png', d: demandId },
      { t: w.clientA.tenantId, v: 'internal', m: 'image/png', d: demandId },
    ]);
    expect(files[0].name).toMatch(/^xicara-de-cafe-fumegante-luz-da-manha-\d{12}-1\.png$/);
  });

  it('sem "usar marca", o pedido vai só com o texto da pessoa', async () => {
    hits.length = 0;
    expect((await run('images.generate', { prompt: 'Grãos de café em close', useBrand: false, quality: 'low' })).status).toBe('succeeded');
    const req = JSON.parse(hits.find((h) => h.url === '/v1/images/generations')!.body.toString());
    expect(req.prompt).not.toContain('#5A3825');
    expect(req.quality).toBe('low');
  });

  it('o cliente não vê as imagens internas nem o evento da ferramenta; a equipe baixa', async () => {
    const mine = (await w.userA.get('/api/files')).json().items.map((f: { id: string }) => f.id);
    expect(mine).not.toContain(generated[0]);
    expect((await w.userA.get(`/api/files/${generated[0]}/download`)).statusCode).toBe(404);
    const dl = await w.gestorA.get(`/api/files/${generated[0]}/download`, hA());
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(PNG)).toBe(true);
    expect((await w.userA.get(`/api/clients/${w.clientA.id}/events`)).body).not.toContain('mcp.images_generated');
  });

  it('com imagens de referência do cliente: multipart em /images/edits com image[]', async () => {
    const logo = await seedImage(w.clientA.tenantId, { name: 'logo.png' });
    const produto = await seedImage(w.clientA.tenantId, { name: 'produto.png' });
    hits.length = 0;
    const c = await run('images.generate', { prompt: 'Post com o pacote de café sobre a mesa', referenceFileIds: [logo, produto], size: 'square' });
    expect(c.status, c.error).toBe('succeeded');
    const h = hits.find((x) => x.url === '/v1/images/edits')!;
    const text = h.body.toString('utf8');
    expect(text.match(/name="image\[\]"; filename=/g)).toHaveLength(2);
    expect(text).toContain('name="model"\r\n\r\ngpt-image-2');
    expect(text).toContain('name="size"\r\n\r\n1024x1024');
    expect(text).toContain('referência fiel');
    expect(c.result.data.references).toBe(2);
  });

  it('ajustar imagem: nova versão, original intacto', async () => {
    const src = await seedImage(w.clientA.tenantId, { name: 'vitrine.png' });
    hits.length = 0;
    const c = await run('images.edit', { fileId: src, instruction: 'Troque o fundo por um balcão de madeira', size: 'landscape' });
    expect(c.status, c.error).toBe('succeeded');
    const text = hits.find((x) => x.url === '/v1/images/edits')!.body.toString('utf8');
    expect(text).toContain('Troque o fundo por um balcão de madeira');
    expect(text).toContain('name="size"\r\n\r\n1536x1024');
    const [out] = await filesOf(c.result.data.fileIds);
    expect(out).toMatchObject({ tenant_id: w.clientA.tenantId, visibility: 'internal' });
    expect(out.name).toMatch(/^vitrine-ajustada-\d{12}\.png$/);
    expect((await filesOf([src]))[0].deleted_at).toBeNull();
  });

  it('isolamento: referência de outro cliente, não verificada ou de tipo não aceito é recusada', async () => {
    const other = await seedImage(w.clientB.tenantId);
    const scanning = await seedImage(w.clientA.tenantId, { scan: 'pending' });
    const gif = await seedImage(w.clientA.tenantId, { mime: 'image/gif' });
    for (const id of [other, scanning, gif]) {
      for (const [tool, params] of [['images.generate', { prompt: 'Banner', referenceFileIds: [id] }], ['images.edit', { fileId: id, instruction: 'Ajuste' }]] as const) {
        const r = await w.operadorA.post('/api/mcp/tool-calls', { tool, params, reason: 'Teste de contrato' }, hA());
        expect(r.statusCode, `${tool} ${id}`).toBe(400);
        expect(r.json().message).toMatch(/não encontrada|verificação de segurança|JPEG, PNG ou WEBP/);
      }
    }
  });

  it('sem créditos na OpenAI: falha com orientação, sem nova tentativa', async () => {
    forced.push({ status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota' });
    const c = await run('images.generate', { prompt: 'Banner de lançamento' });
    expect(c.status).toBe('failed');
    expect(c.error).toContain('sem créditos na OpenAI');
  });

  it('bloqueio de conteúdo: falha com orientação para reformular', async () => {
    forced.push({ status: 400, code: 'moderation_blocked', message: 'Your request was rejected by the safety system' });
    const c = await run('images.generate', { prompt: 'Banner de lançamento' });
    expect(c.status).toBe('failed');
    expect(c.error).toContain('reformule');
  });

  it('OpenAI instável (503): volta para a fila com backoff', async () => {
    forced.push({ status: 503, message: 'Service unavailable' });
    const c = await run('images.generate', { prompt: 'Banner de lançamento' });
    expect(c.status).toBe('queued');
    await env.admin.query(`UPDATE mcp_tool_calls SET status = 'cancelled' WHERE id = $1`, [c.id]);
    await env.admin.query(`UPDATE outbox_events SET status = 'done' WHERE type = 'mcp.call' AND status = 'pending'`);
  });

  it('depois da cobrança, falha ao salvar NÃO gera de novo e não deixa arquivo órfão', async () => {
    returnGarbage = true;
    const before = await countFiles();
    hits.length = 0;
    const c = await run('images.generate', { prompt: 'Mesa posta', n: 2 });
    returnGarbage = false;
    expect(c.status).toBe('failed');
    expect(c.error).toContain('não foi possível salvá-las');
    expect(hits.filter((h) => h.url === '/v1/images/generations')).toHaveLength(1);
    expect(await countFiles()).toBe(before);
  });
});

describe('Arquivo com falha na verificação', () => {
  it('a equipe pede nova verificação; sem antivírus configurado o arquivo é liberado como "não verificado"', async () => {
    const id = await seedImage(w.clientA.tenantId, { scan: 'error', name: 'logo-falhou.png' });
    expect((await w.gestorA.get(`/api/files/${id}/download`, hA())).statusCode).toBe(409);
    const ok = await seedImage(w.clientA.tenantId);
    expect((await w.gestorA.post(`/api/files/${ok}/rescan`, {}, hA())).statusCode).toBe(409);
    const r = await w.gestorA.post(`/api/files/${id}/rescan`, {}, hA());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().scanStatus).toBe('skipped');
    expect((await w.gestorA.get(`/api/files/${id}/download`, hA())).statusCode).toBe(200);
    const audit = (await env.admin.query(`SELECT 1 FROM audit_logs WHERE action = 'file.rescan' AND resource_id = $1`, [id])).rowCount;
    expect(audit).toBe(1);
    const other = await seedImage(w.clientB.tenantId, { scan: 'error' });
    expect((await w.gestorA.post(`/api/files/${other}/rescan`, {}, hA())).statusCode).toBe(404);
  });
});
