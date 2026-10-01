'use client';

import { useState } from 'react';
import Link from 'next/link';
import { brl } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { FinanceNav } from '@/components/finance';
import { Alert, Card, Input, PageHeader, PendingModule, Skeleton, StatCard } from '@/design-system/components';

interface Summary {
  month: string;
  mrrCents: number;
  activeContracts: number;
  averageTicketCents: number;
  receivedCents: number;
  billedCents: number;
  receivableCents: number;
  overdueCents: number;
  overdueCount: number;
  overdueClients: number;
  delinquencyRate: number;
  expensesCents: number;
  resultCents: number;
  pendingActions: number;
  series: { month: string; receivedCents: number; expensesCents: number }[];
}

export default function FinancePage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, error } = useApi<Summary>(`/finance/summary?month=${month}`);
  const max = Math.max(1, ...(data?.series ?? []).flatMap((s) => [s.receivedCents, s.expensesCents]));

  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Visão geral" actions={<Input label="Mês" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />} />
      <FinanceNav />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!data ? (
        <Skeleton height={300} />
      ) : (
        <>
          {data.pendingActions > 0 && (
            <Alert tone="warn">
              {data.pendingActions} ação(ões) crítica(s) aguardando aprovação. <Link href="/finance/actions">Revisar</Link>
            </Alert>
          )}
          <div className="ds-grid ds-grid-4">
            <StatCard label="MRR" value={brl(data.mrrCents)} hint={`${data.activeContracts} contrato(s) ativo(s)`} />
            <StatCard label="Ticket médio" value={brl(data.averageTicketCents)} hint="MRR ÷ contratos ativos" />
            <StatCard label="Recebido no mês" value={brl(data.receivedCents)} hint={`faturado ${brl(data.billedCents)}`} />
            <StatCard label="Resultado do mês" value={brl(data.resultCents)} tone={data.resultCents < 0 ? 'danger' : undefined} hint={`despesas ${brl(data.expensesCents)}`} />
          </div>
          <div className="ds-grid ds-grid-4">
            <StatCard label="A receber" value={brl(data.receivableCents)} hint="faturas em aberto no prazo" />
            <StatCard label="Inadimplência" value={brl(data.overdueCents)} tone={data.overdueCents > 0 ? 'danger' : undefined} hint={`${data.overdueCount} fatura(s) · ${data.overdueClients} cliente(s)`} />
            <StatCard label="Taxa de inadimplência" value={`${data.delinquencyRate.toLocaleString('pt-BR')}%`} hint="vencido em aberto ÷ vencido nos últimos 12 meses" />
            <StatCard label="Aprovações críticas" value={data.pendingActions} tone={data.pendingActions > 0 ? 'warn' : undefined} />
          </div>
          <Card title="Recebido × despesas (6 meses)">
            <div className="ds-stack" style={{ gap: 10 }}>
              {data.series.map((s) => (
                <div key={s.month} className="ds-row" style={{ flexWrap: 'nowrap', gap: 12 }}>
                  <span className="ds-mono ds-stat-hint" style={{ width: 64 }}>
                    {s.month.slice(5)}/{s.month.slice(2, 4)}
                  </span>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div title={`Recebido ${brl(s.receivedCents)}`} style={{ height: 10, width: `${(s.receivedCents / max) * 100}%`, minWidth: s.receivedCents ? 3 : 0, background: 'var(--accent)', borderRadius: 4 }} />
                    <div title={`Despesas ${brl(s.expensesCents)}`} style={{ height: 10, width: `${(s.expensesCents / max) * 100}%`, minWidth: s.expensesCents ? 3 : 0, background: 'var(--warn-ink)', borderRadius: 4, opacity: 0.8 }} />
                  </div>
                  <span className="ds-num ds-stat-hint" style={{ width: 200 }}>
                    {brl(s.receivedCents)} / {brl(s.expensesCents)}
                  </span>
                </div>
              ))}
              <p className="ds-stat-hint">Verde: recebido · Âmbar: despesas.</p>
            </div>
          </Card>
          <PendingModule label="Cobrança automática por PIX/boleto (gateway de pagamento) — hoje a baixa é manual" phase={5} />
        </>
      )}
    </>
  );
}
