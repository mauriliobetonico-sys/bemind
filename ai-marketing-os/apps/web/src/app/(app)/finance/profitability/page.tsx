'use client';

import { useState } from 'react';
import { brl } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { FinanceNav } from '@/components/finance';
import { Alert, Badge, Card, EmptyState, Input, PageHeader, Skeleton, StatCard } from '@/design-system/components';

interface Row {
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
interface Report {
  thresholdPercent: number;
  totals: { revenueCents: number; costCents: number; marginCents: number; marginPercent: number | null };
  aiCost: { note: string };
  method: string[];
  clients: Row[];
}

const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`);

export default function ProfitabilityPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, error } = useApi<Report>(`/finance/profitability?month=${month}`);
  const alerts = (data?.clients ?? []).filter((c) => c.belowThreshold);

  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Rentabilidade por cliente" actions={<Input label="Mês" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />} />
      <FinanceNav />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!data ? (
        <Skeleton height={300} />
      ) : (
        <>
          {alerts.length > 0 && (
            <Alert tone="warn">
              {alerts.length} cliente(s) com margem abaixo do limite configurado ({data.thresholdPercent}%): {alerts.map((a) => a.clientName).join(', ')}.
            </Alert>
          )}
          <div className="ds-grid ds-grid-4">
            <StatCard label="Receita" value={brl(data.totals.revenueCents)} hint="recebida no mês" />
            <StatCard label="Custos" value={brl(data.totals.costCents)} />
            <StatCard label="Margem" value={brl(data.totals.marginCents)} tone={data.totals.marginCents < 0 ? 'danger' : undefined} />
            <StatCard label="Margem %" value={pct(data.totals.marginPercent)} hint={`limite de alerta: ${data.thresholdPercent}%`} />
          </div>
          {data.clients.length === 0 ? (
            <div className="ds-card">
              <EmptyState>Sem receita ou custos neste mês.</EmptyState>
            </div>
          ) : (
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col" className="ds-num">
                      Receita
                    </th>
                    <th scope="col" className="ds-num">
                      Direto
                    </th>
                    <th scope="col" className="ds-num">
                      IA
                    </th>
                    <th scope="col" className="ds-num">
                      Infra
                    </th>
                    <th scope="col" className="ds-num">
                      Operacional
                    </th>
                    <th scope="col" className="ds-num">
                      Margem
                    </th>
                    <th scope="col">Produção</th>
                  </tr>
                </thead>
                <tbody>
                  {data.clients.map((c) => (
                    <tr key={c.tenantId}>
                      <td>
                        {c.clientName}
                        <div className="ds-stat-hint">MRR {brl(c.mrrCents)}</div>
                      </td>
                      <td className="ds-num">{brl(c.revenueCents)}</td>
                      <td className="ds-num">{brl(c.directCostCents)}</td>
                      <td className="ds-num" title="Consumo medido pelo AI Gateway">
                        {brl(c.aiCostCents)}
                      </td>
                      <td className="ds-num">{brl(c.infraCostCents)}</td>
                      <td className="ds-num">{brl(c.operationalCostCents)}</td>
                      <td className="ds-num">
                        {brl(c.marginCents)}
                        <div>
                          <Badge tone={c.belowThreshold ? 'danger' : 'ok'}>{pct(c.marginPercent)}</Badge>
                        </div>
                      </td>
                      <td className="ds-stat-hint">
                        {c.production.demandsDelivered} entregas · {c.production.deliverablesApproved} aprovações · {c.production.tasksDone} tarefas
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Card title="Como calculamos">
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }} className="ds-text-2">
              {data.method.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="ds-stat-hint">{data.aiCost.note}</p>
          </Card>
        </>
      )}
    </>
  );
}
