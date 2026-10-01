import { PERIOD_MONTHS, type Periodicity } from '@aimos/shared';
import type { Tx } from '../../db/pool';
import { enqueue } from '../../outbox/outbox';
import { recordActivity } from '../work/common';

/** Numeração legível e sequencial: PROP-2026-000123. */
export async function nextNumber(tx: Tx, sequence: 'proposal_number_seq' | 'contract_number_seq' | 'invoice_number_seq', prefix: string): Promise<string> {
  const { n } = (await tx.query<{ n: string }>(`SELECT nextval('${sequence}')::text AS n`)).rows[0]!;
  return `${prefix}-${new Date().getFullYear()}-${n.padStart(6, '0')}`;
}

// --------------------------------------------------------------- datas (YYYY-MM-DD, sem fuso)
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return isoDate(target);
}
export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return isoDate(t);
}

export interface BillingPeriod {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
}

/**
 * Período n do contrato: começa em start + n·meses; vence no dia de
 * cobrança do mês de início do período (ou no mês seguinte, se esse dia
 * cair antes do início).
 */
export function billingPeriod(startDate: string, periodicity: Periodicity, billingDay: number, n: number): BillingPeriod {
  const months = PERIOD_MONTHS[periodicity];
  const periodStart = addMonths(startDate, n * months);
  const periodEnd = addDays(addMonths(startDate, (n + 1) * months), -1);
  let dueDate = `${periodStart.slice(0, 8)}${String(billingDay).padStart(2, '0')}`;
  if (dueDate < periodStart) dueDate = addMonths(dueDate, 1);
  return { periodStart, periodEnd, dueDate };
}

/** MRR normalizado: valor do período ÷ meses do período. */
export const monthlyValue = (amountCents: number, periodicity: Periodicity) => Math.round(amountCents / PERIOD_MONTHS[periodicity]);

interface ContractRow {
  id: string;
  tenant_id: string;
  number: string;
  title: string;
  periodicity: Periodicity;
  recurring_amount_cents: string;
  start_date: string;
  end_date: string | null;
  billing_day: number;
}

/**
 * Gera as faturas recorrentes cujo vencimento está dentro da janela
 * (hoje + antecedência). Idempotente: índice único por contrato/período.
 * Retorna os IDs criados (cada um gera o e-mail "fatura emitida").
 */
export async function generateDueInvoices(tx: Tx, today: string, leadDays: number, contractId?: string): Promise<string[]> {
  const contracts = (
    await tx.query<ContractRow>(
      `SELECT id, tenant_id, number, title, periodicity, recurring_amount_cents,
              to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, billing_day
         FROM contracts
        WHERE status = 'active' AND recurring_amount_cents > 0 ${contractId ? 'AND id = $1' : ''}`,
      contractId ? [contractId] : [],
    )
  ).rows;
  const horizon = addDays(today, leadDays);
  const created: string[] = [];
  for (const c of contracts) {
    for (let n = 0; n < 240; n++) {
      const p = billingPeriod(c.start_date, c.periodicity, c.billing_day, n);
      if (p.dueDate > horizon) break;
      if (c.end_date && p.periodStart > c.end_date) break;
      // Checa antes de numerar para não deixar buracos na sequência de faturas.
      const exists = (
        await tx.query(`SELECT 1 FROM invoices WHERE contract_id = $1 AND kind = 'recurring' AND period_start = $2`, [c.id, p.periodStart])
      ).rowCount;
      if (exists) continue;
      const number = await nextNumber(tx, 'invoice_number_seq', 'FAT');
      const row = (
        await tx.query<{ id: string }>(
          `INSERT INTO invoices (tenant_id, contract_id, number, kind, period_start, period_end, description, amount_cents, due_date)
           VALUES ($1, $2, $3, 'recurring', $4, $5, $6, $7, $8)
           ON CONFLICT (contract_id, kind, period_start) WHERE contract_id IS NOT NULL AND kind <> 'one_off' DO NOTHING
           RETURNING id`,
          [c.tenant_id, c.id, number, p.periodStart, p.periodEnd, `${c.title} — ${fmtPeriod(p.periodStart, p.periodEnd)}`, c.recurring_amount_cents, p.dueDate],
        )
      ).rows[0];
      if (row) {
        created.push(row.id);
        await enqueue(tx, { type: 'invoice.issued', tenantId: c.tenant_id, payload: { invoiceId: row.id } });
      }
    }
  }
  return created;
}

function fmtPeriod(start: string, end: string) {
  const f = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  return `${f(start)} a ${f(end)}`;
}

export interface ProposalForContract {
  id: string;
  tenant_id: string;
  number: string;
  title: string;
  periodicity: Periodicity;
  recurring_total_cents: string;
  one_time_total_cents: string;
}

/**
 * PROPOSTA ACEITA → contrato ativo, fatura de setup (se houver) e primeiras
 * faturas recorrentes (cobrança iniciada). Tudo na transação do aceite.
 */
export async function createContractFromProposal(
  tx: Tx,
  p: ProposalForContract,
  opts: { actorUserId: string | null; via: 'online' | 'manual'; today: string; leadDays: number },
): Promise<string> {
  const client = (
    await tx.query<{ due_day: number | null }>(`SELECT due_day FROM clients WHERE tenant_id = $1`, [p.tenant_id])
  ).rows[0];
  const services = (
    await tx.query<{ name: string }>(`SELECT name FROM proposal_items WHERE proposal_id = $1 ORDER BY position`, [p.id])
  ).rows.map((r) => r.name);
  const number = await nextNumber(tx, 'contract_number_seq', 'CTR');
  const setup = Number(p.one_time_total_cents);
  const { id } = (
    await tx.query<{ id: string }>(
      `INSERT INTO contracts (tenant_id, number, proposal_id, title, periodicity, recurring_amount_cents, setup_amount_cents,
                              start_date, billing_day, services, signature_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        p.tenant_id,
        number,
        p.id,
        p.title,
        p.periodicity,
        p.recurring_total_cents,
        setup,
        opts.today,
        client?.due_day ?? 10,
        JSON.stringify(services),
        opts.via === 'online' ? 'accepted_online' : 'manual',
        opts.actorUserId,
      ],
    )
  ).rows[0]!;

  await issueInitialInvoices(tx, { tenantId: p.tenant_id, contractId: id, title: p.title, setupCents: setup, today: opts.today, leadDays: opts.leadDays });
  await recordActivity(tx, { tenantId: p.tenant_id, actorUserId: opts.actorUserId, type: 'contract.created', data: { contractId: id, number, proposalNumber: p.number } });
  await enqueue(tx, { type: 'contract.activated', tenantId: p.tenant_id, payload: { contractId: id } });
  return id;
}

/** Fatura de setup (vence em 3 dias) + faturas recorrentes já dentro da janela. */
export async function issueInitialInvoices(
  tx: Tx,
  c: { tenantId: string; contractId: string; title: string; setupCents: number; today: string; leadDays: number },
): Promise<void> {
  if (c.setupCents > 0) {
    const invNumber = await nextNumber(tx, 'invoice_number_seq', 'FAT');
    const inv = (
      await tx.query<{ id: string }>(
        `INSERT INTO invoices (tenant_id, contract_id, number, kind, period_start, description, amount_cents, due_date)
         VALUES ($1, $2, $3, 'setup', $4, $5, $6, $7) RETURNING id`,
        [c.tenantId, c.contractId, invNumber, c.today, `Setup — ${c.title}`, c.setupCents, addDays(c.today, 3)],
      )
    ).rows[0]!;
    await enqueue(tx, { type: 'invoice.issued', tenantId: c.tenantId, payload: { invoiceId: inv.id } });
  }
  await generateDueInvoices(tx, c.today, c.leadDays, c.contractId);
}

/**
 * Registra pagamento; fatura quitada quando a soma cobre o valor.
 * PAGAMENTO CONFIRMADO de um cliente ainda sem acesso → cria o usuário e
 * dispara o onboarding (e-mail de boas-vindas).
 */
export async function applyPayment(
  tx: Tx,
  invoice: { id: string; tenant_id: string; amount_cents: string },
  payment: { amountCents: number; paidAt: string; method: string; reference: string | null; actorUserId: string | null },
): Promise<{ paid: boolean; onboardingStarted: boolean }> {
  await tx.query(
    `INSERT INTO payments (tenant_id, invoice_id, amount_cents, paid_at, method, reference, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [invoice.tenant_id, invoice.id, payment.amountCents, payment.paidAt, payment.method, payment.reference, payment.actorUserId],
  );
  const { total } = (await tx.query<{ total: string }>(`SELECT coalesce(sum(amount_cents), 0) AS total FROM payments WHERE invoice_id = $1`, [invoice.id])).rows[0]!;
  const paid = Number(total) >= Number(invoice.amount_cents);
  if (paid) await tx.query(`UPDATE invoices SET status = 'paid', paid_at = $2 WHERE id = $1`, [invoice.id, payment.paidAt]);
  await recordActivity(tx, { tenantId: invoice.tenant_id, actorUserId: payment.actorUserId, type: paid ? 'invoice.paid' : 'invoice.partial_payment', data: { invoiceId: invoice.id, amountCents: payment.amountCents } });
  await enqueue(tx, { type: 'payment.received', tenantId: invoice.tenant_id, payload: { invoiceId: invoice.id, amountCents: payment.amountCents } });
  const onboardingStarted = paid ? await startOnboardingIfNeeded(tx, invoice.tenant_id, payment.actorUserId) : false;
  return { paid, onboardingStarted };
}

async function startOnboardingIfNeeded(tx: Tx, tenantId: string, actorUserId: string | null): Promise<boolean> {
  const client = (
    await tx.query<{ id: string; status: string; email: string; responsible_name: string }>(
      `SELECT id, status, email, responsible_name FROM clients WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows[0];
  if (!client) return false;
  const hasUser = (await tx.query(`SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND role_key = 'CLIENTE'`, [tenantId])).rowCount;
  let started = false;
  if (!hasUser) {
    const existing = (await tx.query<{ id: string; status: string; global_role: string | null }>(`SELECT id, status, global_role FROM users WHERE email = $1`, [client.email])).rows[0];
    if (!existing?.global_role) {
      const userId =
        existing?.id ??
        (await tx.query<{ id: string }>(`INSERT INTO users (email, name, status) VALUES ($1, $2, 'invited') RETURNING id`, [client.email, client.responsible_name])).rows[0]!.id;
      await tx.query(`INSERT INTO tenant_users (tenant_id, user_id, role_key) VALUES ($1, $2, 'CLIENTE') ON CONFLICT DO NOTHING`, [tenantId, userId]);
      if (!existing || existing.status === 'invited') {
        await enqueue(tx, { type: 'user.invite', tenantId, payload: { userId, template: 'client_welcome', clientId: client.id } });
      }
      started = true;
    }
  }
  if (client.status === 'prospect') {
    await tx.query(`UPDATE clients SET status = 'onboarding' WHERE id = $1`, [client.id]);
    started = true;
  }
  if (started) await recordActivity(tx, { tenantId, actorUserId, type: 'client.onboarding_started', data: { trigger: 'first_payment' } });
  return started;
}
