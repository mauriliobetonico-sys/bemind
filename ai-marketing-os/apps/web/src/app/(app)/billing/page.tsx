'use client';

import Link from 'next/link';
import { CONTRACT_STATUS_LABELS, PERIODICITY_LABELS, PROPOSAL_STATUS_LABELS, type ProposalStatus } from '@aimos/shared';
import { brl, fmtDate } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { contractTone, INVOICE_STATUS_LABELS, invoiceTone, proposalTone } from '@/lib/labels';
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from '@/design-system/components';

interface Billing {
  contracts: {
    id: string;
    number: string;
    title: string;
    status: keyof typeof CONTRACT_STATUS_LABELS;
    periodicity: keyof typeof PERIODICITY_LABELS;
    recurringAmountCents: number;
    startDate: string;
    billingDay: number;
    services: string[];
  }[];
  invoices: { id: string; number: string; description: string; amountCents: number; paidCents: number; dueDate: string; status: string; paidAt: string | null }[];
  proposals: { id: string; number: string; title: string; status: ProposalStatus; validUntil: string; recurringTotalCents: number; link: string | null }[];
  paymentInstructions: string | null;
}

export default function BillingPage() {
  const { data, error } = useApi<Billing>('/portal/billing');
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data) return <Skeleton height={320} />;
  const due = data.invoices.filter((i) => i.status === 'open' || i.status === 'overdue');

  return (
    <>
      <PageHeader eyebrow="Sua conta" title="Contrato e faturas" />
      {due.some((i) => i.status === 'overdue') && <Alert tone="warn">Há fatura vencida. Se já pagou, desconsidere — a baixa pode levar até 1 dia útil.</Alert>}
      <div className="ds-grid ds-grid-2">
        <div className="ds-stack" style={{ gap: 'var(--space-4)' }}>
          {data.contracts.length === 0 ? (
            <Card title="Contrato">
              <EmptyState>Nenhum contrato ativo.</EmptyState>
            </Card>
          ) : (
            data.contracts.map((c) => (
              <Card key={c.id} title={c.title} action={<Badge tone={contractTone[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge>}>
                <dl className="ds-dl">
                  <dt>Contrato</dt>
                  <dd className="ds-mono">{c.number}</dd>
                  <dt>Valor</dt>
                  <dd>
                    {brl(c.recurringAmountCents)} · {PERIODICITY_LABELS[c.periodicity].toLowerCase()}
                  </dd>
                  <dt>Início</dt>
                  <dd>{fmtDate(c.startDate)}</dd>
                  <dt>Vencimento</dt>
                  <dd>todo dia {c.billingDay}</dd>
                </dl>
                {c.services.length > 0 && <p className="ds-text-2">Serviços: {c.services.join(', ')}.</p>}
              </Card>
            ))
          )}
          {data.paymentInstructions && (
            <Card title="Como pagar">
              <p style={{ whiteSpace: 'pre-wrap' }}>{data.paymentInstructions}</p>
            </Card>
          )}
          {data.proposals.length > 0 && (
            <Card title="Propostas">
              <ul className="ds-list">
                {data.proposals.map((p) => (
                  <li key={p.id}>
                    <span>
                      {p.link ? <Link href={p.link}>{p.title}</Link> : p.title} <span className="ds-stat-hint ds-mono">{p.number}</span>
                    </span>
                    <Badge tone={proposalTone[p.status]}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card title="Faturas">
          {data.invoices.length === 0 ? (
            <EmptyState>Nenhuma fatura ainda.</EmptyState>
          ) : (
            <ul className="ds-list">
              {data.invoices.map((i) => (
                <li key={i.id}>
                  <span>
                    {i.description}
                    <div className="ds-stat-hint">
                      <span className="ds-mono">{i.number}</span> · vence {fmtDate(i.dueDate)}
                      {i.paidAt && ` · paga em ${fmtDate(i.paidAt)}`}
                    </div>
                  </span>
                  <span className="ds-stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                    <span className="ds-num">{brl(i.amountCents - (i.status === 'paid' ? 0 : i.paidCents))}</span>
                    <Badge tone={invoiceTone[i.status]}>{INVOICE_STATUS_LABELS[i.status] ?? i.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="ds-stat-hint">Pagamento online (PIX/boleto automático): em breve.</p>
        </Card>
      </div>
    </>
  );
}
