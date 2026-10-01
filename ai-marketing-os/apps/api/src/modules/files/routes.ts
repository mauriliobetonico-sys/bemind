import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createBrandAssetInput, listFilesQuery, summarizeCategories, uuidParam, type FileCategory } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, type Tx } from '../../db/pool';
import { AppError, badRequest, notFound, parse } from '../../lib/errors';
import type { Access } from '../../security/access';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { enqueue } from '../../outbox/outbox';
import { detectFile, INLINE_SAFE, UnsupportedFileError } from '../../storage/classify';
import { FileTooLargeError } from '../../storage/storage';
import { recordActivity, singleTenantContext } from '../work/common';

const FILE_SELECT = `
  SELECT f.id, f.tenant_id AS "tenantId", f.folder_id AS "folderId", f.demand_id AS "demandId", f.name, f.mime,
         f.size_bytes::float8 AS "sizeBytes", f.category, f.scan_status AS "scanStatus", f.visibility,
         f.created_at AS "createdAt", u.name AS "uploadedByName"
    FROM files f LEFT JOIN users u ON u.id = f.uploaded_by`;

const uploadQuery = z.strictObject({
  demandId: z.uuid().optional(),
  visibility: z.enum(['client', 'internal']).default('client'),
});
const downloadQuery = z.strictObject({ inline: z.enum(['1', '0']).optional() });

/** Remove caminhos, caracteres de controle e limita o tamanho do nome exibido. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|]/g, '').trim().slice(0, 255);
  return clean.length ? clean : 'arquivo';
}

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Arquivos internos (rascunhos) existem só para a equipe; para o cliente, 404. */
async function findVisibleFile(tx: Tx, access: Access, id: string) {
  const file = (await tx.query(`${FILE_SELECT} WHERE f.id = $1 AND f.deleted_at IS NULL`, [id])).rows[0];
  if (!file) return null;
  if (file.visibility === 'internal' && !access.can('work:manage', file.tenantId)) return null;
  return file;
}

export async function fileRoutes(app: FastifyInstance, ctx: AppContext) {
  const maxBytes = ctx.env.MAX_UPLOAD_MB * 1024 * 1024;

  app.get('/files', { config: { permission: 'files:read' } }, async (req) => {
    const access = requireAccess(req);
    const q = parse(listFilesQuery, req.query);
    const dbCtx = access.context('files:read', requestedTenant(req));
    return withContext(ctx.pool, dbCtx, async (tx) => {
      const where = ['f.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (q.category) where.push(`f.category = $${params.push(q.category)}`);
      if (q.demandId) where.push(`f.demand_id = $${params.push(q.demandId)}`);
      if (q.q) where.push(`f.name ILIKE $${params.push(`%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)}`);
      // Visibilidade interna: só tenants onde o usuário é da equipe.
      const staffTenants = access.hasGlobal('work:manage') ? null : access.tenantIdsWith('work:manage');
      if (staffTenants) where.push(`(f.visibility = 'client' OR f.tenant_id = ANY($${params.push(staffTenants)}::uuid[]))`);
      const items = (await tx.query(`${FILE_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC LIMIT 500`, params)).rows;
      return { items };
    });
  });

  /**
   * Upload múltiplo (multipart). Cada arquivo é gravado em tenants/{tenant}/{id},
   * identificado pelo conteúdo, classificado e — com ClamAV configurado —
   * enviado para varredura antes de poder ser baixado.
   */
  app.post('/files', { config: { permission: 'files:write' }, bodyLimit: maxBytes * 20 }, async (req, reply) => {
    const access = requireAccess(req);
    const q = parse(uploadQuery, req.query);
    const dbCtx = singleTenantContext(access, 'files:write', req);
    if (q.visibility === 'internal' && !access.can('work:manage', dbCtx.tenantId)) throw badRequest('Visibilidade inválida');
    if (!req.isMultipart()) throw badRequest('Envie os arquivos como multipart/form-data');

    const scanStatus = ctx.env.CLAMAV_HOST ? 'pending' : 'skipped';
    const stored: { id: string; name: string; mime: string; category: FileCategory; sizeBytes: number; sha256: string }[] = [];
    const rejected: { name: string; reason: string }[] = [];

    try {
      for await (const part of req.files({ limits: { fileSize: maxBytes, files: 20 }, throwFileSizeLimit: false })) {
        const name = sanitizeFileName(part.filename || 'arquivo');
        const id = randomUUID();
        try {
          const obj = await ctx.storage.put(dbCtx.tenantId, id, part.file, maxBytes);
          if (obj.sizeBytes === 0) throw new UnsupportedFileError(name);
          const detection = await detectFile(ctx.storage.localPath(dbCtx.tenantId, id), name);
          stored.push({ id, name, ...detection, ...obj });
        } catch (err) {
          await ctx.storage.remove(dbCtx.tenantId, id);
          part.file.resume();
          if (err instanceof FileTooLargeError) rejected.push({ name, reason: `maior que ${ctx.env.MAX_UPLOAD_MB} MB` });
          else if (err instanceof UnsupportedFileError) rejected.push({ name, reason: 'tipo de arquivo não permitido' });
          else throw err;
        }
      }
    } catch (err) {
      for (const s of stored) await ctx.storage.remove(dbCtx.tenantId, s.id);
      if ((err as { code?: string }).code === 'FST_FILES_LIMIT') throw badRequest('Envie no máximo 20 arquivos por vez');
      throw err;
    }

    if (stored.length === 0) {
      return reply.code(rejected.length ? 422 : 400).send({ error: 'no_files', message: rejected.length ? 'Nenhum arquivo aceito' : 'Nenhum arquivo enviado', rejected });
    }

    try {
      const files = await withContext(ctx.pool, dbCtx, async (tx) => {
        for (const s of stored) {
          await tx.query(
            `INSERT INTO files (id, tenant_id, demand_id, name, mime, size_bytes, sha256, category, scan_status, visibility, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [s.id, dbCtx.tenantId, q.demandId ?? null, s.name, s.mime, s.sizeBytes, s.sha256, s.category, scanStatus, q.visibility, access.principal.userId],
          );
          if (scanStatus === 'pending') await enqueue(tx, { type: 'file.uploaded', tenantId: dbCtx.tenantId, payload: { fileId: s.id } });
        }
        const counts: Partial<Record<FileCategory, number>> = {};
        for (const s of stored) counts[s.category] = (counts[s.category] ?? 0) + 1;
        await recordActivity(tx, { tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, type: 'files.uploaded', data: { count: stored.length, demandId: q.demandId, counts } });
        await ctx.audit.recordIn(tx, {
          action: 'file.upload',
          result: 'success',
          tenantId: dbCtx.tenantId,
          actorUserId: access.principal.userId,
          resourceType: 'file',
          resourceId: stored.map((s) => s.id).join(',').slice(0, 500),
          ...requestMeta(req),
          metadata: { count: stored.length, rejected: rejected.length, bytes: stored.reduce((a, s) => a + s.sizeBytes, 0) },
        });
        return (await tx.query(`${FILE_SELECT} WHERE f.id = ANY($1::uuid[]) ORDER BY f.name`, [stored.map((s) => s.id)])).rows;
      });
      const counts: Partial<Record<FileCategory, number>> = {};
      for (const f of files) counts[f.category as FileCategory] = (counts[f.category as FileCategory] ?? 0) + 1;
      return reply.code(201).send({ files, rejected, summary: summarizeCategories(counts) });
    } catch (err) {
      for (const s of stored) await ctx.storage.remove(dbCtx.tenantId, s.id);
      if ((err as { code?: string }).code === '23503') throw badRequest('Demanda não encontrada neste cliente');
      throw err;
    }
  });

  app.get('/files/:id/download', { config: { permission: 'files:read' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const { inline } = parse(downloadQuery, req.query);
    const file = await withContext(ctx.pool, access.context('files:read', requestedTenant(req)), (tx) => findVisibleFile(tx, access, id));
    if (!file) throw notFound();
    if (file.scanStatus === 'infected') throw new AppError(403, 'infected', 'Arquivo bloqueado: ameaça detectada pelo antivírus');
    if (file.scanStatus === 'pending') throw new AppError(409, 'scanning', 'Arquivo em verificação de segurança. Tente em instantes.');
    if (file.scanStatus === 'error') throw new AppError(409, 'scan_error', 'Falha na verificação de segurança. A equipe foi notificada.');

    await ctx.audit.record({ action: 'file.download', result: 'success', tenantId: file.tenantId, actorUserId: access.principal.userId, resourceType: 'file', resourceId: id, ...requestMeta(req) });
    const showInline = inline === '1' && INLINE_SAFE.has(file.mime);
    return reply
      .header('Content-Type', showInline ? file.mime : 'application/octet-stream')
      .header('Content-Disposition', contentDisposition(showInline ? 'inline' : 'attachment', file.name))
      .header('Content-Length', String(file.sizeBytes))
      .header('Cache-Control', 'private, no-store')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('X-Content-Type-Options', 'nosniff')
      .send(ctx.storage.open(file.tenantId, id));
  });

  /** Exclusão: some da listagem e do storage; o registro fica para auditoria. */
  app.delete('/files/:id', { config: { permission: 'files:delete' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const file = await withContext(ctx.pool, access.context('files:delete', requestedTenant(req)), async (tx) => {
      const f = (await tx.query(`SELECT id, tenant_id AS "tenantId", name FROM files WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
      if (!f) throw notFound();
      await tx.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [id]);
      await tx.query(`DELETE FROM brand_assets WHERE file_id = $1`, [id]);
      await tx.query(`UPDATE deliverables SET file_id = NULL WHERE file_id = $1 AND status IN ('draft', 'changes_requested')`, [id]);
      await ctx.audit.recordIn(tx, { action: 'file.delete', result: 'success', tenantId: f.tenantId, actorUserId: access.principal.userId, resourceType: 'file', resourceId: id, ...requestMeta(req), metadata: { name: f.name } });
      return f;
    });
    await ctx.storage.remove(file.tenantId, id);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ Brand Vault
  app.get('/brand-assets', { config: { permission: 'files:read' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('files:read', requestedTenant(req)), async (tx) => ({
      items: (
        await tx.query(
          `SELECT b.id, b.tenant_id AS "tenantId", b.kind, b.title, b.value, b.notes, b.file_id AS "fileId",
                  f.name AS "fileName", f.mime AS "fileMime", b.created_at AS "createdAt"
             FROM brand_assets b LEFT JOIN files f ON f.tenant_id = b.tenant_id AND f.id = b.file_id AND f.deleted_at IS NULL
            ORDER BY array_position(ARRAY['logo','color','font','manual'], b.kind), b.created_at`,
        )
      ).rows,
    }));
  });

  app.post('/brand-assets', { config: { permission: 'files:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createBrandAssetInput, req.body);
    const dbCtx = singleTenantContext(access, 'files:write', req);
    const asset = await withContext(ctx.pool, dbCtx, async (tx) => {
      if (input.fileId) {
        const ok = (await tx.query(`SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND visibility = 'client'`, [input.fileId, dbCtx.tenantId])).rowCount;
        if (!ok) throw badRequest('Arquivo não encontrado neste cliente');
      }
      const row = (
        await tx.query(
          `INSERT INTO brand_assets (tenant_id, kind, title, value, file_id, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, kind, title, value, notes, file_id AS "fileId"`,
          [dbCtx.tenantId, input.kind, input.title, input.value, input.fileId ?? null, input.notes, access.principal.userId],
        )
      ).rows[0];
      await recordActivity(tx, { tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, type: 'brand.asset_added', data: { kind: input.kind, title: input.title } });
      return row;
    });
    return reply.code(201).send(asset);
  });

  app.delete('/brand-assets/:id', { config: { permission: 'files:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    await withContext(ctx.pool, access.context('files:write', requestedTenant(req)), async (tx) => {
      const removed = await tx.query(`DELETE FROM brand_assets WHERE id = $1 RETURNING tenant_id`, [id]);
      if (removed.rowCount === 0) throw notFound();
      await ctx.audit.recordIn(tx, { action: 'brand.asset_remove', result: 'success', tenantId: removed.rows[0].tenant_id, actorUserId: access.principal.userId, resourceType: 'brand_asset', resourceId: id, ...requestMeta(req) });
    });
    return reply.code(204).send();
  });
}
