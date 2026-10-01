'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@aimos/shared';
import { api, ApiError, brl, fmtDate } from '@/lib/api';
import { INVOICE_STATUS_LABELS, invoiceTone } from '@/lib/labels';
import { Alert, Badge, Button, Input, Select, Textarea } from '@/design-system/components';

export function FinanceNav() {
  const pathname = usePathname();
  const tabs = [
    { href: '/finance', label: 'Visão geral' },
    { href: '/finance/invoices', label: 'Faturas' },
    { href: '/finance/expenses', label: 'Despesas' },
    { href: '/finance/profitability', label: 'Rentabilidade' },
    { href: '/finance/actions', label: 'Aprovações críticas' },
  ];
  return (
    <nav className="ds-tabs" aria-label="Financeiro">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="ds-tab" aria-selected={pathname === t.href} style={{ display: 'inline-flex', alignItems: 'center' }}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export interface InvoiceRow {
  id: string;
  number: string;
  clientName?: string;
  description: string;
  kind: string;
  amountCents: number;
  paidCents: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
}

/** Tabela de faturas com baixa manual e pedido de cancelamento (HITL). */
export function InvoiceTable({ items, onChange, canWrite, showClient }: { items: InvoiceRow[]; onChange: () => void; canWrite: boolean; showClient?: boolean }) {
  const [open, setOpen] = useState<{ id: string; mode: 'pay' | 'cancel' } | null>(null);
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th scope="col">Fatura</th>
            {showClient && <th scope="col">Cliente</th>}
            <th scope="col">Vencimento</th>
            <th scope="col" className="ds-num">
              Valor
            </th>
            <th scope="col">Status</th>
            {canWrite && <th scope="col">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <span className="ds-mono" style={{ fontSize: 13 }}>
                  {i.number}
                </span>
                <div className="ds-stat-hint">{i.description}</div>
                {open?.id === i.id && open.mode === 'pay' && <PaymentForm invoice={i} onDone={() => (setOpen(null), onChange())} />}
                {open?.id === i.id && open.mode === 'cancel' && <CancelForm invoiceId={i.id} onDone={() => (setOpen(null), onChange())} />}
              </td>
              {showClient && <td>{i.clientName}</td>}
              <td>{fmtDate(i.dueDate)}</td>
              <td className="ds-num">
                {brl(i.amountCents)}
                {i.paidCents > 0 && i.status !== 'paid' && <div className="ds-stat-hint">pago {brl(i.paidCents)}</div>}
              </td>
              <td>
                <Badge tone={invoiceTone[i.status]}>{INVOICE_STATUS_LABELS[i.status] ?? i.status}</Badge>
                {i.paidAt && <div className="ds-stat-hint">em {fmtDate(i.paidAt)}</div>}
              </td>
              {canWrite && (
                <td>
                  {(i.status === 'open' || i.status === 'overdue') && (
                    <div className="ds-row" style={{ gap: 6 }}>
                      <Button size="sm" onClick={() => setOpen({ id: i.id, mode: 'pay' })}>
                        Registrar pagamento
                      </Button>
                      {i.paidCents === 0 && (
                        <Button size="sm" variant="ghost" onClick={() => setOpen({ id: i.id, mode: 'cancel' })}>
                          Cancelar
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentForm({ invoice, onDone }: { invoice: InvoiceRow; onDone: () => void }) {
  const [v, setV] = useState({ amount: ((invoice.amountCents - invoice.paidCents) / 100).toFixed(2).replace('.', ','), paidAt: new Date().toISOString().slice(0, 10), method: 'pix', reference: '' });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      const amountCents = Math.round(Number(v.amount.replace(/\./g, '').replace(',', '.')) * 100);
      await api(`/invoices/${invoice.id}/payments`, { method: 'POST', body: { amountCents, paidAt: v.paidAt, method: v.method, reference: v.reference || null } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao registrar');
    }
  };
  return (
    <div className="ds-stack" style={{ marginTop: 10 }}>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="ds-row" style={{ alignItems: 'flex-end' }}>
        <Input label="Valor (R$)" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        <Input label="Data" type="date" value={v.paidAt} onChange={(e) => setV({ ...v, paidAt: e.target.value })} />
        <Select label="Forma" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
        <Input label="Referência" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
        <Button variant="primary" onClick={() => void save()}>
          Confirmar
        </Button>
      </div>
    </div>
  );
}

function CancelForm({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const send = async () => {
    try {
      const r = await api<{ status: string }>(`/invoices/${invoiceId}/cancel`, { method: 'POST', body: { reason } });
      setMsg(r.status === 'pending' ? 'Pedido enviado para aprovação.' : 'Fatura cancelada.');
      setTimeout(onDone, 1200);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha');
    }
  };
  return (
    <div className="ds-stack" style={{ marginTop: 10 }}>
      {msg && <Alert>{msg}</Alert>}
      <Textarea label="Motivo do cancelamento (vai para aprovação)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div>
        <Button size="sm" disabled={reason.trim().length < 5} onClick={() => void send()}>
          Pedir cancelamento
        </Button>
      </div>
    </div>
  );
}
