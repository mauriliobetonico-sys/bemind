import { z } from 'zod';
import type { Tx } from '../../db/pool';
import { defineTool, type ConnectionInfo, type ConnectorDef, type ToolExecContext } from '../registry';
import { httpFailure, IntegrationHttpError, safeRequest } from '../http';

/**
 * WordPress pela REST API oficial (wp-json/wp/v2) com "Senha de aplicativo"
 * (Usuários → Perfil → Senhas de aplicativo). O conteúdo publicado vem
 * SEMPRE do entregável no banco — nunca de texto livre de quem pede.
 */
export const wordpressConnector: ConnectorDef = {
  key: 'wordpress',
  name: 'WordPress',
  description: 'Cria rascunhos e publica posts no site do cliente a partir dos entregáveis.',
  availability: 'available',
  requirements: 'No WordPress do cliente: Usuários → Perfil → "Senhas de aplicativo" → gere uma senha para "AI Marketing OS". Use um usuário com papel Editor ou Autor.',
  fields: [
    { name: 'siteUrl', label: 'Endereço do site', type: 'url', secret: false, required: true, help: 'Ex.: https://www.cliente.com.br' },
    { name: 'username', label: 'Usuário do WordPress', type: 'text', secret: false, required: true },
    { name: 'appPassword', label: 'Senha de aplicativo', type: 'password', secret: true, required: true },
  ],
  async test(app, conn) {
    const r = await wp(app.env.MCP_ALLOW_PRIVATE_HOSTS, conn, 'GET', '/wp/v2/users/me?context=edit');
    if (r.status !== 200) throw httpFailure('WordPress', r);
    const me = r.json<{ name?: string; roles?: string[] }>();
    return `Conectado como ${me.name ?? conn.config.username}${me.roles?.length ? ` (${me.roles.join(', ')})` : ''}`;
  },
};

function wp(allowPrivate: boolean, conn: ConnectionInfo, method: 'GET' | 'POST', path: string, body?: unknown) {
  const site = conn.config.siteUrl?.replace(/\/+$/, '');
  if (!site || !conn.config.username || !conn.secrets.appPassword) throw new IntegrationHttpError('WordPress sem endereço, usuário ou senha de aplicativo');
  const auth = Buffer.from(`${conn.config.username}:${conn.secrets.appPassword.replace(/\s+/g, '')}`).toString('base64');
  return safeRequest(method, `${site}/wp-json${path}`, {
    allowPrivate,
    headers: { authorization: `Basic ${auth}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Markdown básico → HTML seguro (tudo é escapado antes; só a marcação gerada aqui vira tag). */
export function markdownToHtml(md: string): string {
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    if (list.length) out.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    para = [];
    list = [];
  };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      out.push(`<h${h[1]!.length + 1}>${inline(h[2]!)}</h${h[1]!.length + 1}>`);
    } else if (/^---+$/.test(line)) {
      flush();
      out.push('<hr>');
    } else if (li) {
      if (para.length) flush();
      list.push(li[1]!);
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('\n');
}

const deliverableParams = z.strictObject({ deliverableId: z.uuid() });

async function loadDeliverable(tx: Tx, id: string) {
  return (await tx.query<{ id: string; title: string; description: string | null; status: string }>('SELECT id, title, description, status FROM deliverables WHERE id = $1', [id])).rows[0];
}

/** Remove a assinatura "Observações do agente" (uso interno) do conteúdo publicado. */
const publicContent = (d: string | null) => (d ?? '').split(/\n---\nObservações do agente/)[0]!.trim();

async function existingPostId(ctx: ToolExecContext, deliverableId: string): Promise<number | null> {
  return ctx.withTenant(async (tx) => {
    const r = await tx.query<{ post: string | null }>(
      `SELECT result->'data'->>'postId' AS post FROM mcp_tool_calls
        WHERE deliverable_id = $1 AND connector = 'wordpress' AND status = 'succeeded' AND result->'data' ? 'postId'
        ORDER BY finished_at DESC LIMIT 1`,
      [deliverableId],
    );
    const v = Number(r.rows[0]?.post);
    return Number.isInteger(v) && v > 0 ? v : null;
  });
}

async function upsertPost(ctx: ToolExecContext, deliverableId: string, status: 'draft' | 'publish') {
  if (!ctx.connection) throw new Error('WordPress não conectado');
  const d = await ctx.withTenant((tx) => loadDeliverable(tx, deliverableId));
  if (!d) throw new Error('Entregável não encontrado');
  if (status === 'publish' && d.status !== 'approved') throw new Error('Só entregáveis aprovados pelo cliente podem ser publicados');
  const postId = await existingPostId(ctx, deliverableId);
  const body = { title: d.title, content: markdownToHtml(publicContent(d.description)), status };
  const r = await wp(ctx.app.env.MCP_ALLOW_PRIVATE_HOSTS, ctx.connection, 'POST', postId ? `/wp/v2/posts/${postId}` : '/wp/v2/posts', body);
  if (r.status !== 200 && r.status !== 201) throw httpFailure('WordPress', r);
  const post = r.json<{ id: number; link?: string; status?: string }>();
  return { postId: post.id, link: post.link ?? null, wpStatus: post.status ?? status };
}

export const wordpressDraftTool = defineTool({
  name: 'wordpress.create_draft',
  connector: 'wordpress',
  title: 'Criar rascunho no WordPress',
  description: 'Envia o entregável como RASCUNHO para o WordPress do cliente (não publica).',
  risk: 'MEDIUM',
  allowedAgents: ['copywriter', 'social_media'],
  permission: 'mcp:use',
  rateLimitPerMinute: 10,
  params: deliverableParams,
  async validate(tx, _t, p) {
    if (!(await loadDeliverable(tx, p.deliverableId))) throw new Error('Entregável não encontrado neste cliente');
    return { deliverableId: p.deliverableId };
  },
  async execute(ctx, p) {
    const r = await upsertPost(ctx, p.deliverableId, 'draft');
    return { summary: `Rascunho #${r.postId} salvo no WordPress`, data: r };
  },
});

export const wordpressPublishTool = defineTool({
  name: 'wordpress.publish_post',
  schedulable: true,
  connector: 'wordpress',
  title: 'Publicar no WordPress',
  description: 'Publica no site do cliente um entregável já aprovado por ele.',
  risk: 'HIGH',
  allowedAgents: ['social_media'],
  permission: 'mcp:use',
  rateLimitPerMinute: 5,
  params: deliverableParams,
  async validate(tx, _t, p) {
    const d = await loadDeliverable(tx, p.deliverableId);
    if (!d) throw new Error('Entregável não encontrado neste cliente');
    if (d.status !== 'approved') throw new Error('Só entregáveis aprovados pelo cliente podem ser publicados');
    return { deliverableId: p.deliverableId };
  },
  async execute(ctx, p) {
    const r = await upsertPost(ctx, p.deliverableId, 'publish');
    return { summary: `Publicado no WordPress${r.link ? `: ${r.link}` : ` (post #${r.postId})`}`, data: r };
  },
});
