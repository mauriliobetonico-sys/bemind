import type { Tx } from '../../db/pool';

export interface ClientProfitability {
  tenantId: string;
  clientName: string;
  mrrCents: number;
  revenueCents: number;
  directCostCents: number;
  aiCostCents: number;
  infraCostCents: number;
  operationalCostCents: number;
  totalCostCents: number;
  marginCents: number;
  marginPercent: number | null;
  production: { demandsDelivered: number; deliverablesApproved: number; tasksDone: number };
  belowThreshold: boolean;
}

export interface ProfitabilityReport {
  month: string;
  from: string;
  to: string;
  thresholdPercent: number;
  totals: { revenueCents: number; costCents: number; marginCents: number; marginPercent: number | null };
  unallocated: { infrastructureCents: number; operationalCents: number };
  aiCost: { status: 'measured'; usdBrlRate: number; totalCents: number; unallocatedCents: number; note: string };
  method: string[];
  clients: ClientProfitability[];
}

export function monthRange(month?: string): { month: string; from: string; to: string } {
  const now = new Date();
  const m = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return { month: m, from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
}

/**
 * Rentabilidade por cliente no mês (método documentado e exibido na tela):
 *  - Receita: pagamentos recebidos no mês.
 *  - Custo direto: despesas rateadas ao cliente no mês.
 *  - Custo de IA: consumo medido pelo AI Gateway (ai_usage), convertido pela cotação configurada.
 *  - Infraestrutura: despesas de infraestrutura não rateadas ÷ clientes com contrato ativo.
 *  - Operacional: demais despesas não rateadas, proporcionais ao MRR do cliente.
 * Deve rodar em escopo global (despesas ficam no tenant da agência).
 */
export async function profitabilityReport(tx: Tx, month: string | undefined, thresholdPercent: number): Promise<ProfitabilityReport> {
  const { month: m, from, to } = monthRange(month);

  const clients = (
    await tx.query<{ tenant_id: string; name: string; mrr: string; revenue: string; direct: string; delivered: number; approved: number; tasks_done: number }>(
      `SELECT c.tenant_id, c.trade_name AS name,
              coalesce((SELECT sum(round(k.recurring_amount_cents / CASE k.periodicity WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 ELSE 1 END))
                          FROM contracts k WHERE k.tenant_id = c.tenant_id AND k.status = 'active'), 0) AS mrr,
              coalesce((SELECT sum(p.amount_cents) FROM payments p WHERE p.tenant_id = c.tenant_id AND p.paid_at BETWEEN $1 AND $2), 0) AS revenue,
              coalesce((SELECT sum(e.amount_cents) FROM expenses e WHERE e.client_tenant_id = c.tenant_id AND e.deleted_at IS NULL AND e.incurred_on BETWEEN $1 AND $2), 0) AS direct,
              (SELECT count(*)::int FROM demands d WHERE d.tenant_id = c.tenant_id AND d.status = 'delivered' AND d.updated_at::date BETWEEN $1 AND $2) AS delivered,
              (SELECT count(*)::int FROM approvals a WHERE a.tenant_id = c.tenant_id AND a.status = 'approved' AND a.decided_at::date BETWEEN $1 AND $2) AS approved,
              (SELECT count(*)::int FROM tasks t WHERE t.tenant_id = c.tenant_id AND t.status = 'done' AND t.completed_at::date BETWEEN $1 AND $2) AS tasks_done
         FROM clients c
        ORDER BY c.trade_name`,
      [from, to],
    )
  ).rows.map((r) => ({ ...r, mrr: Number(r.mrr), revenue: Number(r.revenue), direct: Number(r.direct) }));

  const rate = Number((await tx.query<{ r: string }>('SELECT usd_brl_rate AS r FROM agency_settings WHERE id = 1')).rows[0]?.r ?? 0);
  // micro-dólares → centavos de real: µUSD / 1e6 × cotação × 100
  const toCents = (micros: number) => Math.round((micros * rate) / 10_000);
  const aiByTenant = new Map(
    (
      await tx.query<{ tenant_id: string; micros: string }>(
        `SELECT tenant_id, sum(cost_usd_micros) AS micros FROM ai_usage
          WHERE created_at >= $1::date AND created_at < ($2::date + 1) GROUP BY tenant_id`,
        [from, to],
      )
    ).rows.map((r) => [r.tenant_id, toCents(Number(r.micros))]),
  );
  const unalloc = (
    await tx.query<{ infra: string; other: string }>(
      `SELECT coalesce(sum(amount_cents) FILTER (WHERE category = 'infrastructure'), 0) AS infra,
              coalesce(sum(amount_cents) FILTER (WHERE category <> 'infrastructure'), 0) AS other
         FROM expenses WHERE client_tenant_id IS NULL AND deleted_at IS NULL AND incurred_on BETWEEN $1 AND $2`,
      [from, to],
    )
  ).rows[0]!;
  const infra = Number(unalloc.infra);
  const other = Number(unalloc.other);
  const withContract = clients.filter((c) => c.mrr > 0);
  const totalMrr = withContract.reduce((a, c) => a + c.mrr, 0);

  const rows: ClientProfitability[] = clients
    .filter((c) => c.mrr > 0 || c.revenue > 0 || c.direct > 0 || (aiByTenant.get(c.tenant_id) ?? 0) > 0)
    .map((c) => {
      const infraShare = c.mrr > 0 && withContract.length ? Math.round(infra / withContract.length) : 0;
      const opShare = c.mrr > 0 && totalMrr > 0 ? Math.round((other * c.mrr) / totalMrr) : 0;
      const aiCost = aiByTenant.get(c.tenant_id) ?? 0;
      const totalCost = c.direct + infraShare + opShare + aiCost;
      const margin = c.revenue - totalCost;
      const marginPercent = c.revenue > 0 ? Math.round((margin / c.revenue) * 1000) / 10 : null;
      return {
        tenantId: c.tenant_id,
        clientName: c.name,
        mrrCents: c.mrr,
        revenueCents: c.revenue,
        directCostCents: c.direct,
        aiCostCents: aiCost,
        infraCostCents: infraShare,
        operationalCostCents: opShare,
        totalCostCents: totalCost,
        marginCents: margin,
        marginPercent,
        production: { demandsDelivered: c.delivered, deliverablesApproved: c.approved, tasksDone: c.tasks_done },
        // Sem receita no mês e com custo: também é alerta (margem negativa).
        belowThreshold: marginPercent === null ? totalCost > 0 : marginPercent < thresholdPercent,
      };
    })
    .sort((a, b) => (a.marginPercent ?? -Infinity) - (b.marginPercent ?? -Infinity));

  const revenue = rows.reduce((a, r) => a + r.revenueCents, 0);
  const cost = rows.reduce((a, r) => a + r.totalCostCents, 0);
  return {
    month: m,
    from,
    to,
    thresholdPercent,
    totals: { revenueCents: revenue, costCents: cost, marginCents: revenue - cost, marginPercent: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null },
    unallocated: { infrastructureCents: infra, operationalCents: other },
    aiCost: {
      status: 'measured',
      usdBrlRate: rate,
      totalCents: [...aiByTenant.values()].reduce((a, v) => a + v, 0),
      // Chat Global e outros usos da agência: custo da agência, fora do rateio por cliente.
      unallocatedCents: [...aiByTenant.entries()].filter(([t]) => !clients.some((c) => c.tenant_id === t)).reduce((a, [, v]) => a + v, 0),
      note: `Consumo medido por chamada ao modelo, convertido a R$ ${rate.toFixed(2)} por dólar (ajuste em IA → Orçamento).`,
    },
    method: [
      'Receita = pagamentos recebidos no mês.',
      'Custo direto = despesas rateadas diretamente ao cliente.',
      'Infraestrutura = despesas de infraestrutura sem rateio, divididas igualmente entre clientes com contrato ativo.',
      'Operacional = demais despesas sem rateio, proporcionais ao MRR do cliente.',
      'Custo de IA = tokens consumidos pelos agentes deste cliente × preço do modelo, convertidos pela cotação configurada.',
    ],
    clients: rows,
  };
}
