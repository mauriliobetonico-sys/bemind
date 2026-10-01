import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import type { AppContext } from '../../context';
import type { Tx } from '../../db/pool';
import { enqueue } from '../../outbox/outbox';
import { detectFile } from '../../storage/classify';
import { recordActivity } from '../../modules/work/common';
import { defineTool, type ConnectionInfo, type ConnectorDef, type ToolExecContext } from '../registry';
import { httpFailure, IntegrationHttpError, safeRequest, type HttpResult } from '../http';

/**
 * Adobe Firefly Services — SOMENTE as interfaces oficiais e documentadas:
 *  - autenticação OAuth Server-to-Server (IMS, POST /ims/token/v3,
 *    grant_type=client_credentials), igual ao SDK oficial @adobe/firefly-services-common-apis;
 *  - Firefly API v3 (POST /v3/images/generate, /v3/images/expand) e upload
 *    (POST /v2/storage/image), conforme a especificação OpenAPI publicada
 *    pela Adobe no pacote @adobe/firefly-apis.
 * Cabeçalhos exigidos: Authorization: Bearer <token> e x-api-key: <client id>.
 *
 * As imagens geradas são baixadas das URLs pré-assinadas (expiram em 1 h) e
 * guardadas como arquivos INTERNOS do cliente — o cliente só vê depois que a
 * equipe anexar a um entregável e enviar para aprovação.
 */

export const ADOBE_DEFAULT_SCOPES = 'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis';

/** Capacidades por produto Adobe e o motivo de cada uma estar (ou não) disponível. */
export const ADOBE_CAPABILITIES: { name: string; status: 'available' | 'unavailable'; note: string }[] = [
  { name: 'Firefly — gerar imagens a partir de texto', status: 'available', note: 'Firefly API v3 /images/generate.' },
  { name: 'Firefly — expandir imagem (mudar formato/proporção)', status: 'available', note: 'Firefly API v3 /images/expand com upload oficial.' },
  {
    name: 'Photoshop API — remover fundo, máscaras, ações em PSD',
    status: 'unavailable',
    note: 'A API oficial lê e grava arquivos em armazenamento de nuvem (S3, Azure, Dropbox) por URLs pré-assinadas; o storage atual é local. Entra junto com o storage em nuvem.',
  },
  { name: 'InDesign API — documentos e merge de dados', status: 'unavailable', note: 'Mesma exigência de armazenamento em nuvem da Photoshop API.' },
  { name: 'Illustrator', status: 'unavailable', note: 'Sem API REST pública oficial para automação no servidor.' },
  { name: 'Premiere Pro e After Effects', status: 'unavailable', note: 'Sem API REST pública oficial para automação no servidor.' },
];

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const OUTPUT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const ADOBE_SIZES = {
  square: { width: 2048, height: 2048 },
  landscape: { width: 2304, height: 1792 },
  portrait: { width: 1792, height: 2304 },
  widescreen: { width: 2688, height: 1536 },
} as const;
export type AdobeSize = keyof typeof ADOBE_SIZES;
const sizeEnum = z.enum(Object.keys(ADOBE_SIZES) as [AdobeSize, ...AdobeSize[]]);

// ------------------------------------------------------------------ autenticação

/** Cache de tokens por conexão (vale ~24 h; renovamos 5 min antes). */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function credentialKey(conn: ConnectionInfo) {
  return `${conn.id}:${createHash('sha256').update(`${conn.config.clientId}\n${conn.secrets.clientSecret}\n${conn.config.scopes ?? ''}`).digest('hex')}`;
}

async function accessToken(app: AppContext, conn: ConnectionInfo, force = false): Promise<string> {
  const clientId = conn.config.clientId?.trim();
  const clientSecret = conn.secrets.clientSecret?.trim();
  if (!clientId || !clientSecret) throw new IntegrationHttpError('Adobe sem Client ID ou Client Secret');
  const key = credentialKey(conn);
  const cached = tokenCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: conn.config.scopes?.trim() || ADOBE_DEFAULT_SCOPES,
  }).toString();
  const r = await safeRequest('POST', `${app.env.ADOBE_IMS_URL.replace(/\/+$/, '')}/ims/token/v3`, {
    allowPrivate: app.env.MCP_ALLOW_PRIVATE_HOSTS,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  if (r.status !== 200) throw imsFailure(r);
  const t = r.json<{ access_token?: string; expires_in?: number | string }>();
  if (!t.access_token) throw new IntegrationHttpError('Adobe IMS não devolveu token');
  const ttl = Math.max(60, Number(t.expires_in) || 3600) * 1000;
  tokenCache.set(key, { token: t.access_token, expiresAt: Date.now() + ttl - Math.min(5 * 60_000, ttl / 2) });
  return t.access_token;
}

function imsFailure(r: HttpResult) {
  let detail = '';
  try {
    const j = r.json<{ error?: string; error_description?: string }>();
    detail = j.error_description || j.error || '';
  } catch {
    /* corpo não-JSON */
  }
  const hint = r.status === 400 || r.status === 401 ? ' — confira Client ID, Client Secret e escopos na Adobe Developer Console' : '';
  return new IntegrationHttpError(`Adobe IMS respondeu HTTP ${r.status}${detail ? `: ${detail.slice(0, 200)}` : ''}${hint}`, r.status, r.status >= 500 || r.status === 429);
}

/** Chamada à Firefly API com renovação automática do token em caso de 401. */
async function firefly(app: AppContext, conn: ConnectionInfo, path: string, body: string | Buffer, contentType: string): Promise<HttpResult> {
  const send = async (token: string) =>
    safeRequest('POST', `${app.env.ADOBE_FIREFLY_URL.replace(/\/+$/, '')}${path}`, {
      allowPrivate: app.env.MCP_ALLOW_PRIVATE_HOSTS,
      timeoutMs: 120_000,
      headers: { authorization: `Bearer ${token}`, 'x-api-key': conn.config.clientId!.trim(), 'content-type': contentType, accept: 'application/json' },
      body,
    });
  let r = await send(await accessToken(app, conn));
  if (r.status === 401) r = await send(await accessToken(app, conn, true));
  if (r.status !== 200) throw fireflyFailure(r);
  return r;
}

function fireflyFailure(r: HttpResult) {
  let detail = '';
  try {
    const j = r.json<{ message?: string; error_code?: string; reason?: string }>();
    detail = j.message || j.reason || j.error_code || '';
  } catch {
    /* corpo não-JSON */
  }
  if (!detail) return httpFailure('Adobe Firefly', r);
  const hint = r.status === 403 ? ' — a credencial precisa do produto Firefly Services habilitado no projeto da Adobe Developer Console' : '';
  return new IntegrationHttpError(`Adobe Firefly respondeu HTTP ${r.status}: ${detail.slice(0, 200)}${hint}`, r.status, r.status >= 500 || r.status === 429 || r.status === 408);
}

export const adobeConnector: ConnectorDef = {
  key: 'adobe',
  name: 'Adobe Firefly Services',
  description: 'Geração e expansão de imagens com o Adobe Firefly (API oficial). Os resultados entram nos arquivos internos do cliente.',
  availability: 'available',
  requirements:
    'Na Adobe Developer Console: crie um projeto, adicione a API "Firefly Services" com credencial "OAuth Server-to-Server" e copie o Client ID e o Client Secret. Cada imagem consome créditos generativos do contrato Adobe da agência.',
  capabilities: ADOBE_CAPABILITIES,
  fields: [
    { name: 'clientId', label: 'Client ID (API key)', type: 'text', secret: false, required: true },
    { name: 'clientSecret', label: 'Client Secret', type: 'password', secret: true, required: true },
    { name: 'scopes', label: 'Escopos', type: 'text', secret: false, required: false, help: `Deixe vazio para usar o padrão: ${ADOBE_DEFAULT_SCOPES}` },
  ],
  async test(app, conn) {
    // Só emite um token: valida as credenciais sem gastar créditos.
    await accessToken(app, conn, true);
    return 'Credenciais válidas: token emitido pela Adobe IMS';
  },
};

// ------------------------------------------------------------------ arquivos

interface Downloaded {
  buffer: Buffer;
  seed: number | null;
}

/** Baixa as saídas (URL pré-assinada da Adobe) — HTTPS público, tamanho limitado. */
async function downloadOutputs(app: AppContext, outputs: { seed?: number; image?: { url?: string } }[]): Promise<Downloaded[]> {
  const out: Downloaded[] = [];
  for (const o of outputs) {
    if (!o.image?.url) throw new Error('Adobe Firefly devolveu uma saída sem URL');
    const r = await safeRequest('GET', o.image.url, { allowPrivate: app.env.MCP_ALLOW_PRIVATE_HOSTS, timeoutMs: 60_000, maxBytes: MAX_IMAGE_BYTES });
    if (r.status !== 200) throw new Error(`Falha ao baixar a imagem gerada (HTTP ${r.status})`);
    out.push({ buffer: r.raw, seed: typeof o.seed === 'number' ? o.seed : null });
  }
  return out;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Grava as imagens no storage do tenant e registra em `files` (visibilidade
 * interna) numa única transação. O tipo é conferido pelo conteúdo; se algo
 * falhar, os objetos já gravados são removidos.
 */
async function saveImages(ctx: ToolExecContext, images: Downloaded[], baseName: string, demandId: string | null) {
  const { app, tenantId } = ctx;
  const scanStatus = app.env.CLAMAV_HOST ? 'pending' : 'skipped';
  const stored: { id: string; name: string; mime: string; sizeBytes: number; sha256: string; seed: number | null }[] = [];
  try {
    for (const [i, img] of images.entries()) {
      const id = randomUUID();
      const obj = await app.storage.put(tenantId, id, Readable.from(img.buffer), MAX_IMAGE_BYTES);
      stored.push({ id, name: '', mime: '', ...obj, seed: img.seed });
      const det = await detectFile(app.storage.localPath(tenantId, id), 'imagem');
      if (!OUTPUT_MIMES.has(det.mime)) throw new Error(`Adobe Firefly devolveu um tipo inesperado (${det.mime})`);
      stored[stored.length - 1]!.mime = det.mime;
      stored[stored.length - 1]!.name = `${baseName}${images.length > 1 ? `-${i + 1}` : ''}.${EXT[det.mime]}`;
    }
    await ctx.withTenant(async (tx) => {
      for (const s of stored) {
        await tx.query(
          `INSERT INTO files (id, tenant_id, demand_id, name, mime, size_bytes, sha256, category, scan_status, visibility)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'image', $8, 'internal')`,
          [s.id, tenantId, demandId, s.name, s.mime, s.sizeBytes, s.sha256, scanStatus],
        );
        if (scanStatus === 'pending') await enqueue(tx, { type: 'file.uploaded', tenantId, payload: { fileId: s.id } });
      }
      // Linha do tempo interna (eventos mcp.* nunca aparecem para o cliente).
      await recordActivity(tx, { tenantId, actorUserId: null, type: 'mcp.adobe_images', data: { count: stored.length, callId: ctx.callId, demandId } });
    });
  } catch (err) {
    await Promise.all(stored.map((s) => app.storage.remove(tenantId, s.id)));
    throw err;
  }
  return stored.map((s) => ({ id: s.id, name: s.name, seed: s.seed }));
}

/**
 * Depois que a Adobe gerou (e cobrou) as imagens, uma falha local não deve
 * virar nova tentativa automática — isso geraria e cobraria de novo.
 */
async function afterCharge<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(`Imagens geradas pela Adobe, mas não foi possível salvá-las: ${(err as Error).message}`);
  }
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

async function demandExists(tx: Tx, demandId: string) {
  return (await tx.query('SELECT 1 FROM demands WHERE id = $1', [demandId])).rowCount === 1;
}

// ------------------------------------------------------------------ ferramentas

const generateParams = z.strictObject({
  prompt: z.string().trim().min(3).max(1024),
  negativePrompt: z.string().trim().max(1024).optional(),
  numVariations: z.number().int().min(1).max(4).default(1),
  size: sizeEnum.default('square'),
  contentClass: z.enum(['photo', 'art']).optional(),
  demandId: z.uuid().optional(),
});

export const adobeGenerateImageTool = defineTool({
  name: 'adobe.generate_image',
  connector: 'adobe',
  title: 'Gerar imagem (Adobe Firefly)',
  description: 'Gera de 1 a 4 imagens a partir de um texto com o Adobe Firefly e salva nos arquivos internos do cliente. Consome créditos Adobe.',
  risk: 'MEDIUM',
  allowedAgents: ['designer'],
  permission: 'mcp:use',
  rateLimitPerMinute: 5,
  timeoutMs: 180_000,
  params: generateParams,
  async validate(tx, _t, p) {
    if (p.demandId && !(await demandExists(tx, p.demandId))) throw new Error('Demanda não encontrada neste cliente');
  },
  async execute(ctx, p) {
    if (!ctx.connection) throw new Error('Adobe não conectada');
    const body = {
      prompt: p.prompt,
      numVariations: p.numVariations,
      size: ADOBE_SIZES[p.size],
      ...(p.negativePrompt ? { negativePrompt: p.negativePrompt } : {}),
      ...(p.contentClass ? { contentClass: p.contentClass } : {}),
    };
    const r = await firefly(ctx.app, ctx.connection, '/v3/images/generate', JSON.stringify(body), 'application/json');
    const res = r.json<{ outputs?: { seed?: number; image?: { url?: string } }[]; promptHasDeniedWords?: boolean; promptHasBlockedArtists?: boolean }>();
    if (!res.outputs?.length) throw new Error('Adobe Firefly não devolveu imagens');
    const files = await afterCharge(async () => saveImages(ctx, await downloadOutputs(ctx.app, res.outputs!), `firefly-${stamp()}`, p.demandId ?? null));
    const warn = res.promptHasDeniedWords || res.promptHasBlockedArtists ? ' (a Adobe ignorou parte do texto por política de conteúdo)' : '';
    return {
      summary: `${files.length} imagem(ns) gerada(s) pelo Adobe Firefly e salva(s) nos arquivos internos${warn}`,
      data: { fileIds: files.map((f) => f.id), files, promptHasDeniedWords: !!res.promptHasDeniedWords, promptHasBlockedArtists: !!res.promptHasBlockedArtists },
    };
  },
});

const expandParams = z.strictObject({
  fileId: z.uuid(),
  size: sizeEnum,
  prompt: z.string().trim().min(3).max(1024).optional(),
  numVariations: z.number().int().min(1).max(4).default(1),
});

async function loadSourceImage(tx: Tx, fileId: string) {
  return (
    await tx.query<{ id: string; name: string; mime: string; size_bytes: string; scan_status: string; demand_id: string | null }>(
      'SELECT id, name, mime, size_bytes, scan_status, demand_id FROM files WHERE id = $1 AND deleted_at IS NULL',
      [fileId],
    )
  ).rows[0];
}

function assertUsableSource(f: Awaited<ReturnType<typeof loadSourceImage>>) {
  if (!f) throw new Error('Arquivo não encontrado neste cliente');
  if (!OUTPUT_MIMES.has(f.mime)) throw new Error('A Adobe aceita somente imagens JPEG, PNG ou WEBP');
  if (Number(f.size_bytes) > MAX_IMAGE_BYTES) throw new Error('Imagem grande demais para a Adobe Firefly');
  if (f.scan_status !== 'clean' && f.scan_status !== 'skipped') throw new Error('Arquivo ainda não liberado pela verificação de segurança');
  return f;
}

export const adobeExpandImageTool = defineTool({
  name: 'adobe.expand_image',
  connector: 'adobe',
  title: 'Expandir imagem (Adobe Firefly)',
  description: 'Muda o formato de uma imagem do cliente (ex.: quadrado → 16:9) preenchendo as bordas com o Adobe Firefly. O original não é alterado. Consome créditos Adobe.',
  risk: 'MEDIUM',
  allowedAgents: ['designer'],
  permission: 'mcp:use',
  rateLimitPerMinute: 5,
  timeoutMs: 180_000,
  params: expandParams,
  async validate(tx, _t, p) {
    assertUsableSource(await loadSourceImage(tx, p.fileId));
  },
  async execute(ctx, p) {
    if (!ctx.connection) throw new Error('Adobe não conectada');
    const src = assertUsableSource(await ctx.withTenant((tx) => loadSourceImage(tx, p.fileId)));
    const chunks: Buffer[] = [];
    for await (const c of ctx.app.storage.open(ctx.tenantId, src.id)) chunks.push(c as Buffer);
    const up = await firefly(ctx.app, ctx.connection, '/v2/storage/image', Buffer.concat(chunks), src.mime);
    const uploadId = up.json<{ images?: { id?: string }[] }>().images?.[0]?.id;
    if (!uploadId) throw new Error('Adobe não devolveu o identificador do upload');
    const body = {
      image: { source: { uploadId } },
      size: ADOBE_SIZES[p.size],
      numVariations: p.numVariations,
      ...(p.prompt ? { prompt: p.prompt } : {}),
    };
    const r = await firefly(ctx.app, ctx.connection, '/v3/images/expand', JSON.stringify(body), 'application/json');
    const res = r.json<{ outputs?: { seed?: number; image?: { url?: string } }[] }>();
    if (!res.outputs?.length) throw new Error('Adobe Firefly não devolveu imagens');
    const base = `${src.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 180)}-expandida-${p.size}`;
    const files = await afterCharge(async () => saveImages(ctx, await downloadOutputs(ctx.app, res.outputs!), base, src.demand_id));
    return {
      summary: `${files.length} versão(ões) expandida(s) de "${src.name}" salva(s) nos arquivos internos`,
      data: { fileIds: files.map((f) => f.id), files, sourceFileId: src.id },
    };
  },
});
