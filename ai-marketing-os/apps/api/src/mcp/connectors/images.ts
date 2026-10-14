import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import type { Env } from '../../config/env';
import type { Tx } from '../../db/pool';
import { enqueue } from '../../outbox/outbox';
import { detectFile } from '../../storage/classify';
import { recordActivity } from '../../modules/work/common';
import { defineTool, type ConnectorDef, type ToolExecContext } from '../registry';
import { IntegrationHttpError, safeRequest, type HttpResult } from '../http';

/**
 * Geração de imagens pela OpenAI Images API (modelos GPT Image), com a chave
 * da agência (OPENAI_API_KEY no servidor — nunca no navegador).
 *  - POST /v1/images/generations  — imagem a partir do texto;
 *  - POST /v1/images/edits        — imagem a partir do texto + imagens de
 *    referência do cliente (logo, produto, foto) ou ajuste de uma imagem.
 * Os modelos GPT Image sempre devolvem a imagem em base64 (`b64_json`).
 *
 * O texto enviado é enriquecido com o contexto do cliente (segmento, cores e
 * fontes do Brand Vault) para a imagem sair "na marca". Os resultados viram
 * arquivos INTERNOS do cliente — ele só vê depois de enviado para aprovação.
 */

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Tamanhos-padrão aceitos por todos os modelos GPT Image. */
export const IMAGE_SIZES = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' } as const;
export type ImageSize = keyof typeof IMAGE_SIZES;
const sizeEnum = z.enum(Object.keys(IMAGE_SIZES) as [ImageSize, ...ImageSize[]]);
const qualityEnum = z.enum(['low', 'medium', 'high']);

export const imagesConnector: ConnectorDef = {
  key: 'images',
  name: 'Gerador de imagens (OpenAI)',
  description: 'Cria imagens a partir de um texto, usando a identidade do cliente e imagens de referência (logo, produto). Os resultados entram nos arquivos internos do cliente.',
  availability: 'available',
  builtIn: true,
  requirements: 'Usa a chave da agência: OPENAI_API_KEY no .env do servidor (platform.openai.com → API keys). Cada imagem é cobrada pela OpenAI na conta da agência.',
  fields: [],
  ready: (env) => (env.OPENAI_API_KEY ? null : 'OPENAI_API_KEY não configurada no servidor'),
};

// ------------------------------------------------------------------ HTTP

function openaiUrl(env: Env, path: string) {
  return `${env.OPENAI_BASE_URL.replace(/\/+$/, '')}${path}`;
}

function openaiFailure(r: HttpResult) {
  let detail = '';
  let code = '';
  try {
    const j = r.json<{ error?: { message?: string; code?: string } }>();
    detail = j.error?.message ?? '';
    code = j.error?.code ?? '';
  } catch {
    /* corpo não-JSON */
  }
  const hint =
    r.status === 401
      ? ' — confira OPENAI_API_KEY no .env'
      : code === 'insufficient_quota' || /quota|billing/i.test(detail)
        ? ' — sem créditos na OpenAI (platform.openai.com → Billing)'
        : /verif/i.test(detail)
          ? ' — a OpenAI exige verificar a organização para este modelo (platform.openai.com → Settings → Organization)'
          : code === 'moderation_blocked' || /safety|moderation/i.test(detail)
            ? ' — o pedido foi bloqueado pela política de conteúdo da OpenAI; reformule o texto'
            : '';
  // 429 por cota esgotada não adianta repetir; 429 por excesso de pedidos sim.
  const retryable = r.status >= 500 || r.status === 408 || (r.status === 429 && code !== 'insufficient_quota');
  return new IntegrationHttpError(`OpenAI respondeu HTTP ${r.status}${detail ? `: ${detail.slice(0, 240)}` : ''}${hint}`, r.status, retryable);
}

async function callOpenAI(env: Env, path: string, body: string | Buffer, contentType: string): Promise<HttpResult> {
  if (!env.OPENAI_API_KEY) throw new Error('integration_pending: OPENAI_API_KEY não configurada no servidor');
  const r = await safeRequest('POST', openaiUrl(env, path), {
    // Endpoint fixo da OpenAI (não vem de quem pede); privados só nos testes.
    allowPrivate: env.MCP_ALLOW_PRIVATE_HOSTS,
    timeoutMs: 200_000,
    maxBytes: 80 * 1024 * 1024,
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': contentType, accept: 'application/json' },
    body,
  });
  if (r.status !== 200) throw openaiFailure(r);
  return r;
}

/** multipart/form-data para /images/edits (várias imagens vão como `image[]`). */
function multipart(fields: Record<string, string>, files: { name: string; filename: string; mime: string; data: Buffer }[]) {
  const boundary = `----aimos${randomUUID().replace(/-/g, '')}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.mime}\r\n\r\n`));
    parts.push(f.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ------------------------------------------------------------------ contexto do cliente

/** Contexto de marca do cliente (do banco, com RLS do tenant) para orientar a imagem. */
async function brandContext(tx: Tx): Promise<string> {
  const c = (await tx.query<{ trade_name: string; segment: string | null; niche: string | null }>('SELECT trade_name, segment, niche FROM clients LIMIT 1')).rows[0];
  const assets = (
    await tx.query<{ kind: string; title: string; value: string | null; notes: string | null }>(
      `SELECT kind, title, value, notes FROM brand_assets WHERE kind IN ('color', 'font', 'campaign', 'reference') ORDER BY created_at LIMIT 30`,
    )
  ).rows;
  const lines: string[] = [];
  if (c) lines.push(`Marca: ${c.trade_name}${c.segment ? ` — segmento: ${c.segment}` : ''}${c.niche ? `, nicho: ${c.niche}` : ''}.`);
  const colors = assets.filter((a) => a.kind === 'color' && a.value).map((a) => `${a.title} ${a.value}`);
  if (colors.length) lines.push(`Paleta da marca (use como cores predominantes): ${colors.join(', ')}.`);
  const fonts = assets.filter((a) => a.kind === 'font').map((a) => a.value || a.title);
  if (fonts.length) lines.push(`Tipografia da marca (se houver texto na imagem): ${fonts.join(', ')}.`);
  const notes = assets.filter((a) => (a.kind === 'campaign' || a.kind === 'reference') && (a.notes || a.value)).map((a) => `${a.title}: ${(a.notes || a.value)!.slice(0, 200)}`);
  if (notes.length) lines.push(`Referências de estilo: ${notes.slice(0, 5).join(' | ')}.`);
  return lines.join('\n');
}

function buildPrompt(userPrompt: string, brand: string, opts: { hasReferences: boolean; avoid?: string }) {
  return [
    userPrompt.trim(),
    opts.hasReferences ? 'Use as imagens anexadas como referência fiel (logotipo, produto ou pessoas): preserve formas, cores e proporções delas.' : '',
    opts.avoid ? `Evite: ${opts.avoid}.` : '',
    brand ? `\nContexto do cliente:\n${brand}` : '',
    'Qualidade profissional para marketing digital. Qualquer texto na imagem deve estar escrito corretamente em português do Brasil.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ------------------------------------------------------------------ arquivos

interface SourceFile {
  id: string;
  name: string;
  mime: string;
  size_bytes: string;
  scan_status: string;
  demand_id: string | null;
}

async function loadImageFile(tx: Tx, fileId: string) {
  return (await tx.query<SourceFile>('SELECT id, name, mime, size_bytes, scan_status, demand_id FROM files WHERE id = $1 AND deleted_at IS NULL', [fileId])).rows[0];
}

function assertUsable(f: SourceFile | undefined): SourceFile {
  if (!f) throw new Error('Imagem não encontrada neste cliente');
  if (!IMAGE_MIMES.has(f.mime)) throw new Error(`"${f.name}": use imagens JPEG, PNG ou WEBP`);
  if (Number(f.size_bytes) > MAX_REFERENCE_BYTES) throw new Error(`"${f.name}" é grande demais (máx. 20 MB)`);
  if (f.scan_status !== 'clean' && f.scan_status !== 'skipped') throw new Error(`"${f.name}" ainda não foi liberada pela verificação de segurança`);
  return f;
}

async function readFile(ctx: ToolExecContext, f: SourceFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of ctx.app.storage.open(ctx.tenantId, f.id)) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Grava as imagens no storage do tenant e registra em `files` (visibilidade
 * interna) numa transação. O tipo é conferido pelo conteúdo; se algo falhar,
 * os objetos gravados são removidos.
 */
async function saveImages(ctx: ToolExecContext, images: Buffer[], baseName: string, demandId: string | null, toolName: string) {
  const { app, tenantId } = ctx;
  const scanStatus = app.env.CLAMAV_HOST ? 'pending' : 'skipped';
  const stored: { id: string; name: string; mime: string; sizeBytes: number; sha256: string }[] = [];
  try {
    for (const [i, buf] of images.entries()) {
      const id = randomUUID();
      const obj = await app.storage.put(tenantId, id, Readable.from(buf), MAX_IMAGE_BYTES);
      stored.push({ id, name: '', mime: '', ...obj });
      const det = await detectFile(app.storage.localPath(tenantId, id), 'imagem');
      if (!IMAGE_MIMES.has(det.mime)) throw new Error(`a OpenAI devolveu um tipo inesperado (${det.mime})`);
      const s = stored[stored.length - 1]!;
      s.mime = det.mime;
      s.name = `${baseName}${images.length > 1 ? `-${i + 1}` : ''}.${EXT[det.mime]}`;
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
      await recordActivity(tx, { tenantId, actorUserId: null, type: 'mcp.images_generated', data: { count: stored.length, callId: ctx.callId, demandId, tool: toolName } });
    });
  } catch (err) {
    await Promise.all(stored.map((s) => app.storage.remove(tenantId, s.id)));
    throw err;
  }
  return stored.map((s) => ({ id: s.id, name: s.name }));
}

/**
 * Depois que a OpenAI gerou (e cobrou) as imagens, uma falha local não deve
 * virar nova tentativa automática — isso geraria e cobraria de novo.
 */
async function afterCharge<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(`Imagens geradas pela OpenAI, mas não foi possível salvá-las: ${(err as Error).message}`);
  }
}

function decodeOutputs(r: HttpResult): { images: Buffer[]; usage: unknown } {
  const res = r.json<{ data?: { b64_json?: string }[]; usage?: unknown }>();
  const images: Buffer[] = [];
  for (const d of res.data ?? []) {
    const b = d.b64_json ? Buffer.from(d.b64_json, 'base64') : null;
    if (b?.length) images.push(b);
  }
  if (!images.length) throw new Error('A OpenAI não devolveu imagens');
  return { images, usage: res.usage ?? null };
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'imagem';

// ------------------------------------------------------------------ ferramentas

const generateParams = z.strictObject({
  prompt: z.string().trim().min(3).max(4000),
  avoid: z.string().trim().max(500).optional(),
  size: sizeEnum.default('square'),
  n: z.number().int().min(1).max(4).default(1),
  quality: qualityEnum.optional(),
  /** Inclui segmento, cores e fontes do Brand Vault no pedido. */
  useBrand: z.boolean().default(true),
  /** Imagens do próprio cliente usadas como referência (logo, produto…). */
  referenceFileIds: z.array(z.uuid()).max(4).default([]),
  demandId: z.uuid().optional(),
});

async function demandExists(tx: Tx, demandId: string) {
  return (await tx.query('SELECT 1 FROM demands WHERE id = $1', [demandId])).rowCount === 1;
}

export const generateImageTool = defineTool({
  name: 'images.generate',
  connector: 'images',
  title: 'Gerar imagem',
  description:
    'Gera de 1 a 4 imagens a partir de uma descrição, na identidade visual do cliente (cores, fontes, segmento) e, se informado, usando imagens do cliente como referência (logo, produto). Salva nos arquivos internos do cliente. Tem custo na OpenAI.',
  risk: 'MEDIUM',
  allowedAgents: ['designer', 'social_media'],
  permission: 'mcp:use',
  rateLimitPerMinute: 5,
  timeoutMs: 240_000,
  params: generateParams,
  async validate(tx, _t, p) {
    if (p.demandId && !(await demandExists(tx, p.demandId))) throw new Error('Demanda não encontrada neste cliente');
    if (new Set(p.referenceFileIds).size !== p.referenceFileIds.length) throw new Error('Imagem de referência repetida');
    for (const id of p.referenceFileIds) assertUsable(await loadImageFile(tx, id));
  },
  async execute(ctx, p) {
    const env = ctx.app.env;
    const { brand, refs } = await ctx.withTenant(async (tx) => ({
      brand: p.useBrand ? await brandContext(tx) : '',
      refs: await Promise.all(p.referenceFileIds.map(async (id) => assertUsable(await loadImageFile(tx, id)))),
    }));
    const prompt = buildPrompt(p.prompt, brand, { hasReferences: refs.length > 0, avoid: p.avoid });
    const quality = p.quality ?? (env.OPENAI_IMAGE_QUALITY === 'auto' ? undefined : env.OPENAI_IMAGE_QUALITY);
    const common = { model: env.OPENAI_IMAGE_MODEL, prompt, n: p.n, size: IMAGE_SIZES[p.size], ...(quality ? { quality } : {}) };

    let r: HttpResult;
    if (refs.length) {
      const files = await Promise.all(refs.map(async (f) => ({ name: 'image[]', filename: `ref.${EXT[f.mime]}`, mime: f.mime, data: await readFile(ctx, f) })));
      const fields = Object.fromEntries(Object.entries(common).map(([k, v]) => [k, String(v)]));
      const form = multipart(fields, files);
      r = await callOpenAI(env, '/images/edits', form.body, form.contentType);
    } else {
      r = await callOpenAI(env, '/images/generations', JSON.stringify(common), 'application/json');
    }
    const out = decodeOutputs(r);
    const files = await afterCharge(() => saveImages(ctx, out.images, `${slug(p.prompt)}-${stamp()}`, p.demandId ?? null, 'images.generate'));
    return {
      summary: `${files.length} imagem(ns) gerada(s) e salva(s) nos arquivos internos${p.useBrand && brand ? ' (na identidade do cliente)' : ''}`,
      data: { fileIds: files.map((f) => f.id), files, model: env.OPENAI_IMAGE_MODEL, usage: out.usage, references: refs.length },
    };
  },
});

const editParams = z.strictObject({
  fileId: z.uuid(),
  instruction: z.string().trim().min(3).max(4000),
  size: sizeEnum.optional(),
  quality: qualityEnum.optional(),
});

export const editImageTool = defineTool({
  name: 'images.edit',
  connector: 'images',
  title: 'Ajustar imagem',
  description:
    'Cria uma nova versão de uma imagem do cliente seguindo uma instrução (trocar fundo, mudar formato, adicionar elementos, aplicar estilo). O original não é alterado. Tem custo na OpenAI.',
  risk: 'MEDIUM',
  allowedAgents: ['designer'],
  permission: 'mcp:use',
  rateLimitPerMinute: 5,
  timeoutMs: 240_000,
  params: editParams,
  async validate(tx, _t, p) {
    assertUsable(await loadImageFile(tx, p.fileId));
  },
  async execute(ctx, p) {
    const env = ctx.app.env;
    const src = assertUsable(await ctx.withTenant((tx) => loadImageFile(tx, p.fileId)));
    const quality = p.quality ?? (env.OPENAI_IMAGE_QUALITY === 'auto' ? undefined : env.OPENAI_IMAGE_QUALITY);
    const fields: Record<string, string> = {
      model: env.OPENAI_IMAGE_MODEL,
      prompt: `${p.instruction}\nMantenha a identidade da imagem original (marca, produto, pessoas) exceto pelo que foi pedido.`,
      n: '1',
      ...(p.size ? { size: IMAGE_SIZES[p.size] } : {}),
      ...(quality ? { quality } : {}),
    };
    const form = multipart(fields, [{ name: 'image[]', filename: `original.${EXT[src.mime]}`, mime: src.mime, data: await readFile(ctx, src) }]);
    const out = decodeOutputs(await callOpenAI(env, '/images/edits', form.body, form.contentType));
    const base = `${src.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 160)}-ajustada-${stamp()}`;
    const files = await afterCharge(() => saveImages(ctx, out.images, base, src.demand_id, 'images.edit'));
    return {
      summary: `Nova versão de "${src.name}" salva nos arquivos internos`,
      data: { fileIds: files.map((f) => f.id), files, sourceFileId: src.id, model: env.OPENAI_IMAGE_MODEL, usage: out.usage },
    };
  },
});
