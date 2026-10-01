import type pg from 'pg';
import { withContext, SYSTEM } from '../db/pool';
import { enqueue } from '../outbox/outbox';
import { generateDueInvoices, isoDate } from '../modules/commercial/billing';
import { getAgencySettings } from '../modules/finance/settings';

export interface TickResult {
  ran: boolean;
  expiredProposals: number;
  invoicesCreated: number;
  overdueReminders: number;
}

/**
 * Rotina periódica do comercial (worker). Usa advisory lock: com vários
 * workers, só um executa por vez. Tudo idempotente.
 *  - propostas vencidas → expiradas;
 *  - faturas recorrentes dentro da janela de antecedência → emitidas;
 *  - faturas vencidas pela primeira vez → lembrete por e-mail (uma vez).
 */
export async function billingTick(pool: pg.Pool, today = isoDate(new Date())): Promise<TickResult> {
  return withContext(pool, SYSTEM, async (tx) => {
    const lock = (await tx.query<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock(424242) AS ok`)).rows[0]!.ok;
    if (!lock) return { ran: false, expiredProposals: 0, invoicesCreated: 0, overdueReminders: 0 };

    const expired = await tx.query(`UPDATE proposals SET status = 'expired' WHERE status IN ('sent', 'viewed') AND valid_until < $1::date`, [today]);
    const { invoiceLeadDays } = await getAgencySettings(tx);
    const created = await generateDueInvoices(tx, today, invoiceLeadDays);
    const overdue = (
      await tx.query<{ id: string; tenant_id: string }>(
        `UPDATE invoices SET reminded_at = now()
          WHERE status = 'open' AND due_date < $1::date AND reminded_at IS NULL
          RETURNING id, tenant_id`,
        [today],
      )
    ).rows;
    for (const inv of overdue) await enqueue(tx, { type: 'invoice.overdue', tenantId: inv.tenant_id, payload: { invoiceId: inv.id } });
    return { ran: true, expiredProposals: expired.rowCount ?? 0, invoicesCreated: created.length, overdueReminders: overdue.length };
  });
}
