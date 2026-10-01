import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  acceptProposalInput,
  computeProposalTotals,
  createProposalInput,
  manualAcceptInput,
  rejectProposalInput,
  updateProposalInput,
  uuidParam,
  type ProposalItemInput,
} from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, SYSTEM, type Tx } from '../../db/pool';
import { AppError, badRequest, notFound, parse } from '../../lib/errors';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { hashToken } from '../../security/tokens';
import { enqueue } from '../../outbox/outbox';
import { recordActivity, singleTenantContext } from '../work/common';
import { createContractFromProposal, isoDate, nextNumber, type ProposalForContract } from './billing';
import { renderProposalPdf } from './pdf';
import { getAgencySettings } from '../finance/settings';

/** Token do link público: HMAC(APP_SECRET, id:nonce). Só o SHA-256 dele fica no banco. */
export function proposalToken(secret: string, proposalId: string, nonce: string): string {
  return createHmac('sha256', secret).update(`proposal:${proposalId}:${nonce}`).digest('base64url');
}

const PROPOSAL_SELECT = `
  SELECT p.id, p.tenant_id AS "tenantId", c.trade_name AS "clientName", c.legal_name AS "clientLegalName", c.cnpj AS "clientDocument",
         c.email AS "clientEmail", p.number, p.title, p.status, to_char(p.valid_until, 'YYYY-MM-DD') AS "validUntil",
         p.discount_type AS "discountType", p.discount_value::float8 AS "discountValue", p.periodicity, p.notes, p.internal_notes AS "internalNotes",
         p.recurring_total_cents::float8 AS "recurringTotalCents", p.one_time_total_cents::float8 AS "oneTimeTotalCents",
         p.sent_at AS "sentAt", p.viewed_at AS "viewedAt", p.accepted_at AS "acceptedAt", p.accepted_by_name AS "acceptedByName",
         p.accepted_via AS "acceptedVia", p.rejected_at AS "rejectedAt", p.rejection_reason AS "rejectionReason",
         p.created_at AS "createdAt", p.updated_at AS "updatedAt",
         (SELECT id FROM contracts k WHERE k.proposal_id = p.id) AS "contractId"
    FROM proposals p JOIN clients c ON c.tenant_id = p.tenant_id`;

async function loadItems(tx: Tx, proposalId: string) {
  return (
    await tx.query(
      `SELECT name, description, quantity::float8 AS quantity, unit_price_cents::float8 AS "unitPriceCents", recurrence, total_cents::float8 AS "totalCents"
         FROM proposal_items WHERE proposal_id = $1 ORDER BY position`,
      [proposalId],
    )
  ).rows as (ProposalItemInput & { totalCents: number })[];
}

async function findProposal(tx: Tx, id: string, forUpdate = false) {
  const p = (await tx.query(`${PROPOSAL_SELECT} WHERE p.id = $1 ${forUpdate ? 'FOR UPDATE OF p' : ''}`, [id])).rows[0];
  if (!p) return null;
  const items = await loadItems(tx, id);
  const totals = computeProposalTotals(items, p.discountType, p.discountValue);
  return { ...p, items: totals.items, recurringSubtotalCents: totals.recurringSubtotalCents, discountCents: totals.discountCents };
}

async function writeItems(tx: Tx, tenantId: string, proposalId: string, items: ProposalItemInput[], discountType: 'none' | 'percent' | 'amount', discountValue: number) {
  const totals = computeProposalTotals(items, discountType, discountValue);
  await tx.query(`DELETE FROM proposal_items WHERE proposal_id = $1`, [proposalId]);
  let position = 0;
  for (const it of totals.items) {
    await tx.query(
      `INSERT INTO proposal_items (tenant_id, proposal_id, position, name, description, quantity, unit_price_cents, recurrence, total_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tenantId, proposalId, position++, it.name, it.description ?? null, it.quantity, it.unitPriceCents, it.recurrence, it.totalCents],
    );
  }
  await tx.query(`UPDATE proposals SET recurring_total_cents = $2, one_time_total_cents = $3 WHERE id = $1`, [proposalId, totals.recurringTotalCents, totals.oneTimeTotalCents]);
}

async function sendPdf(reply: FastifyReply, agency: Awaited<ReturnType<typeof getAgencySettings>>, proposal: NonNullable<Awaited<ReturnType<typeof findProposal>>>) {
  const pdf = await renderProposalPdf({
    agency: { name: agency.agencyName, document: agency.agencyDocument, address: agency.agencyAddress, email: agency.agencyEmail, phone: agency.agencyPhone, footer: agency.proposalFooter },
    clientName: proposal.clientLegalName,
    clientDocument: proposal.clientDocument,
    number: proposal.number,
    title: proposal.title,
    createdAt: proposal.createdAt,
    validUntil: proposal.validUntil,
    periodicity: proposal.periodicity,
    items: proposal.items,
    recurringSubtotalCents: proposal.recurringSubtotalCents,
    discountCents: proposal.discountCents,
    recurringTotalCents: proposal.recurringTotalCents,
    oneTimeTotalCents: proposal.oneTimeTotalCents,
    notes: proposal.notes,
    acceptance: proposal.acceptedAt ? { name: proposal.acceptedByName, at: proposal.acceptedAt, via: proposal.acceptedVia } : null,
  });
  return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `attachment; filename="${proposal.number}.pdf"`)
    .header('Cache-Control', 'private, no-store')
    .send(pdf);
}

const tokenParam = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const PUBLIC_RATE = { max: 60, timeWindow: '1 minute' };

/** Proposta pelo token, já atualizando "expirada" quando a validade passou. */
async function findByToken(tx: Tx, token: string) {
  const row = (await tx.query<{ id: string }>(`SELECT id FROM proposals WHERE public_token_hash = $1`, [hashToken(token)])).rows[0];
  if (!row) return null;
  await tx.query(`UPDATE proposals SET status = 'expired' WHERE id = $1 AND status IN ('sent', 'viewed') AND valid_until < current_date`, [row.id]);
  return findProposal(tx, row.id, true);
}

/** Visão pública: sem notas internas, sem e-mail do cliente, sem IDs de tenant. */
function publicView(p: NonNullable<Awaited<ReturnType<typeof findProposal>>>, agencyName: string) {
  return {
    agencyName,
    clientName: p.clientName,
    number: p.number,
    title: p.title,
    status: p.status,
    validUntil: p.validUntil,
    periodicity: p.periodicity,
    items: p.items,
    recurringSubtotalCents: p.recurringSubtotalCents,
    discountCents: p.discountCents,
    recurringTotalCents: p.recurringTotalCents,
    oneTimeTotalCents: p.oneTimeTotalCents,
    notes: p.notes,
    acceptedAt: p.acceptedAt,
    acceptedByName: p.acceptedByName,
  };
}

export async function proposalRoutes(app: FastifyInstance, ctx: AppContext) {
  const today = () => isoDate(new Date());

  app.get('/proposals', { config: { permission: 'proposals:read' } }, async (req) => {
    const access = requireAccess(req);
    return withContext(ctx.pool, access.context('proposals:read', requestedTenant(req)), async (tx) => {
      await tx.query(`UPDATE proposals SET status = 'expired' WHERE status IN ('sent', 'viewed') AND valid_until < current_date`);
      return { items: (await tx.query(`${PROPOSAL_SELECT} ORDER BY p.created_at DESC LIMIT 300`)).rows };
    });
  });

  app.get('/proposals/:id', { config: { permission: 'proposals:read' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const p = await withContext(ctx.pool, access.context('proposals:read', requestedTenant(req)), (tx) => findProposal(tx, id));
    if (!p) throw notFound();
    return p;
  });

  app.get('/proposals/:id/pdf', { config: { permission: 'proposals:read' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const p = await withContext(ctx.pool, access.context('proposals:read', requestedTenant(req)), (tx) => findProposal(tx, id));
    if (!p) throw notFound();
    // Dados públicos da agência (cabeçalho do PDF) ficam em escopo system.
    const agency = await withContext(ctx.pool, SYSTEM, (tx) => getAgencySettings(tx));
    return sendPdf(reply, agency, p);
  });

  app.post('/proposals', { config: { permission: 'proposals:write' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createProposalInput, req.body);
    const dbCtx = singleTenantContext(access, 'proposals:write', req);
    const p = await withContext(ctx.pool, dbCtx, async (tx) => {
      const number = await nextNumber(tx, 'proposal_number_seq', 'PROP');
      const { id } = (
        await tx.query<{ id: string }>(
          `INSERT INTO proposals (tenant_id, number, title, valid_until, discount_type, discount_value, periodicity, notes, internal_notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [dbCtx.tenantId, number, input.title, input.validUntil, input.discountType, input.discountValue, input.periodicity, input.notes, input.internalNotes, access.principal.userId],
        )
      ).rows[0]!;
      await writeItems(tx, dbCtx.tenantId, id, input.items, input.discountType, input.discountValue);
      await recordActivity(tx, { tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, type: 'proposal.created', data: { proposalId: id, number } });
      await ctx.audit.recordIn(tx, { action: 'proposal.create', result: 'success', tenantId: dbCtx.tenantId, actorUserId: access.principal.userId, resourceType: 'proposal', resourceId: id, ...requestMeta(req) });
      return findProposal(tx, id);
    });
    return reply.code(201).send(p);
  });

  app.patch('/proposals/:id', { config: { permission: 'proposals:write' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateProposalInput, req.body);
    return withContext(ctx.pool, access.context('proposals:write', requestedTenant(req)), async (tx) => {
      const current = await findProposal(tx, id, true);
      if (!current) throw notFound();
      if (current.status !== 'draft') throw badRequest('Só propostas em rascunho podem ser editadas. Crie uma nova proposta.');
      const map: Record<string, string> = { title: 'title', validUntil: 'valid_until', periodicity: 'periodicity', discountType: 'discount_type', discountValue: 'discount_value', notes: 'notes', internalNotes: 'internal_notes' };
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [k, col] of Object.entries(map)) {
        const v = (input as Record<string, unknown>)[k];
        if (v !== undefined) sets.push(`${col} = $${params.push(v)}`);
      }
      if (sets.length) await tx.query(`UPDATE proposals SET ${sets.join(', ')} WHERE id = $1`, params);
      const discountType = input.discountType ?? current.discountType;
      const discountValue = input.discountValue ?? current.discountValue;
      await writeItems(tx, current.tenantId, id, input.items ?? current.items, discountType, discountValue);
      return findProposal(tx, id);
    });
  });

  /** Envia (ou reenvia) por e-mail e devolve o link público para copiar. */
  app.post('/proposals/:id/send', { config: { permission: 'proposals:write' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('proposals:write', requestedTenant(req)), async (tx) => {
      const p = await findProposal(tx, id, true);
      if (!p) throw notFound();
      if (!['draft', 'sent', 'viewed'].includes(p.status)) throw badRequest('Esta proposta não pode mais ser enviada');
      if (p.validUntil < today()) throw badRequest('A validade já passou. Ajuste a data antes de enviar.');
      if (p.recurringTotalCents + p.oneTimeTotalCents <= 0) throw badRequest('A proposta está sem valor');
      let nonce = (await tx.query<{ n: string | null }>(`SELECT public_token_nonce AS n FROM proposals WHERE id = $1`, [id])).rows[0]!.n;
      if (!nonce) nonce = randomBytes(16).toString('hex');
      const token = proposalToken(ctx.env.APP_SECRET, id, nonce);
      await tx.query(
        `UPDATE proposals SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = now(),
                public_token_nonce = $2, public_token_hash = $3 WHERE id = $1`,
        [id, nonce, hashToken(token)],
      );
      await enqueue(tx, { type: 'proposal.sent', tenantId: p.tenantId, payload: { proposalId: id } });
      await recordActivity(tx, { tenantId: p.tenantId, actorUserId: access.principal.userId, type: 'proposal.sent', data: { proposalId: id, number: p.number } });
      await ctx.audit.recordIn(tx, { action: 'proposal.send', result: 'success', tenantId: p.tenantId, actorUserId: access.principal.userId, resourceType: 'proposal', resourceId: id, ...requestMeta(req) });
      return { status: p.status === 'draft' ? 'sent' : p.status, link: `${ctx.env.APP_URL.replace(/\/$/, '')}/p/${token}` };
    });
  });

  /** Aceite registrado pela agência (por telefone, e-mail, reunião). */
  app.post('/proposals/:id/accept-manual', { config: { permission: 'proposals:write' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(manualAcceptInput, req.body);
    const settingsLead = await withContext(ctx.pool, SYSTEM, async (tx) => (await getAgencySettings(tx)).invoiceLeadDays);
    return withContext(ctx.pool, access.context('proposals:write', requestedTenant(req)), async (tx) => {
      const p = await findProposal(tx, id, true);
      if (!p) throw notFound();
      if (!['draft', 'sent', 'viewed'].includes(p.status)) throw badRequest('Esta proposta não pode ser aceita');
      await tx.query(`UPDATE proposals SET status = 'accepted', accepted_at = now(), accepted_by_name = $2, accepted_via = 'manual' WHERE id = $1`, [id, input.acceptedByName]);
      const contractId = await acceptProposal(tx, p, access.principal.userId, 'manual', settingsLead);
      await ctx.audit.recordIn(tx, { action: 'proposal.accept_manual', result: 'success', tenantId: p.tenantId, actorUserId: access.principal.userId, resourceType: 'proposal', resourceId: id, ...requestMeta(req), metadata: { acceptedByName: input.acceptedByName, note: input.note } });
      return { status: 'accepted', contractId };
    });
  });

  // ------------------------------------------------------------------ link público (sem sessão)
  app.get('/public/proposals/:token', { config: { auth: 'public', rateLimit: PUBLIC_RATE } }, async (req) => {
    const { token } = parse(tokenParam, req.params);
    return withContext(ctx.pool, SYSTEM, async (tx) => {
      const p = await findByToken(tx, token);
      if (!p) throw notFound('Proposta não encontrada');
      if (p.status === 'sent') {
        await tx.query(`UPDATE proposals SET status = 'viewed', viewed_at = now() WHERE id = $1`, [p.id]);
        await recordActivity(tx, { tenantId: p.tenantId, actorUserId: null, type: 'proposal.viewed', data: { proposalId: p.id, number: p.number } });
        p.status = 'viewed';
      }
      return publicView(p, (await getAgencySettings(tx)).agencyName);
    });
  });

  app.get('/public/proposals/:token/pdf', { config: { auth: 'public', rateLimit: PUBLIC_RATE } }, async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    return withContext(ctx.pool, SYSTEM, async (tx) => {
      const p = await findByToken(tx, token);
      if (!p) throw notFound('Proposta não encontrada');
      return sendPdf(reply, await getAgencySettings(tx), p);
    });
  });

  app.post('/public/proposals/:token/accept', { config: { auth: 'public', rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = parse(tokenParam, req.params);
    const input = parse(acceptProposalInput, req.body);
    const meta = requestMeta(req);
    return withContext(ctx.pool, SYSTEM, async (tx) => {
      const p = await findByToken(tx, token);
      if (!p) throw notFound('Proposta não encontrada');
      if (p.status === 'expired') throw new AppError(410, 'expired', 'Esta proposta expirou. Peça uma nova à agência.');
      if (!['sent', 'viewed'].includes(p.status)) throw new AppError(409, 'closed', 'Esta proposta já foi respondida.');
      await tx.query(
        `UPDATE proposals SET status = 'accepted', accepted_at = now(), accepted_by_name = $2, accepted_via = 'online', accepted_ip = $3, accepted_user_agent = $4
          WHERE id = $1`,
        [p.id, input.name, meta.ip, meta.userAgent?.slice(0, 500) ?? null],
      );
      const contractId = await acceptProposal(tx, p, null, 'online', (await getAgencySettings(tx)).invoiceLeadDays);
      await ctx.audit.recordIn(tx, { action: 'proposal.accept_online', result: 'success', tenantId: p.tenantId, resourceType: 'proposal', resourceId: p.id, ...meta, metadata: { acceptedByName: input.name, contractId } });
      return { status: 'accepted' };
    });
  });

  app.post('/public/proposals/:token/reject', { config: { auth: 'public', rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = parse(tokenParam, req.params);
    const input = parse(rejectProposalInput, req.body ?? {});
    return withContext(ctx.pool, SYSTEM, async (tx) => {
      const p = await findByToken(tx, token);
      if (!p) throw notFound('Proposta não encontrada');
      if (!['sent', 'viewed'].includes(p.status)) throw new AppError(409, 'closed', 'Esta proposta já foi respondida ou expirou.');
      await tx.query(`UPDATE proposals SET status = 'rejected', rejected_at = now(), rejection_reason = $2 WHERE id = $1`, [p.id, input.reason]);
      await recordActivity(tx, { tenantId: p.tenantId, actorUserId: null, type: 'proposal.rejected', data: { proposalId: p.id, number: p.number, reason: input.reason ?? undefined } });
      await enqueue(tx, { type: 'proposal.answered', tenantId: p.tenantId, payload: { proposalId: p.id } });
      await ctx.audit.recordIn(tx, { action: 'proposal.reject', result: 'success', tenantId: p.tenantId, resourceType: 'proposal', resourceId: p.id, ...requestMeta(req) });
      return { status: 'rejected' };
    });
  });

  async function acceptProposal(tx: Tx, p: { id: string; tenantId: string; number: string; title: string; periodicity: string; recurringTotalCents: number; oneTimeTotalCents: number }, actor: string | null, via: 'online' | 'manual', leadDays: number) {
    const forContract: ProposalForContract = {
      id: p.id,
      tenant_id: p.tenantId,
      number: p.number,
      title: p.title,
      periodicity: p.periodicity as ProposalForContract['periodicity'],
      recurring_total_cents: String(p.recurringTotalCents),
      one_time_total_cents: String(p.oneTimeTotalCents),
    };
    await recordActivity(tx, { tenantId: p.tenantId, actorUserId: actor, type: 'proposal.accepted', data: { proposalId: p.id, number: p.number, via } });
    const contractId = await createContractFromProposal(tx, forContract, { actorUserId: actor, via, today: today(), leadDays });
    await enqueue(tx, { type: 'proposal.answered', tenantId: p.tenantId, payload: { proposalId: p.id } });
    return contractId;
  }
}
