'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError, brl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { ClientPicker } from '@/components/client-picker';
import { FinanceNav, InvoiceTable, type InvoiceRow } from '@/components/finance';
import { parseMoney } from '../../clients/client-form';
import { Alert, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '@/design-system/components';

export default function InvoicesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const { data, error, reload } = useApi<{ items: InvoiceRow[] }>(`/invoices${status ? `?status=${status}` : ''}`);
  const total = (data?.items ?? []).reduce((a, i) => a + i.amountCents - i.paidCents, 0);
  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Faturas" />
      <FinanceNav />
      <div className="ds-row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'Todas' },
            { value: 'open', label: 'Em aberto' },
            { value: 'overdue', label: 'Vencidas' },
            { value: 'paid', label: 'Pagas' },
            { value: 'cancelled', label: 'Canceladas' },
          ]}
        />
        {data && (status === 'open' || status === 'overdue') && <p className="ds-text-2">Saldo: {brl(total)}</p>}
      </div>
      {can('finance:write') && <NewInvoice onCreated={reload} />}
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!data ? (
        <Skeleton height={300} />
      ) : data.items.length === 0 ? (
        <div className="ds-card">
          <EmptyState>Nenhuma fatura.</EmptyState>
        </div>
      ) : (
        <InvoiceTable items={data.items} onChange={() => void reload()} canWrite={can('finance:write')} showClient />
      )}
    </>
  );
}

function NewInvoice({ onCreated }: { onCreated: () => Promise<void> }) {
  const [tenantId, setTenantId] = useState('');
  const [v, setV] = useState({ description: '', amount: '', dueDate: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) });
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/invoices', { method: 'POST', tenantId: tenantId || null, body: { description: v.description, amountCents: parseMoney(v.amount), dueDate: v.dueDate } });
      setV({ ...v, description: '', amount: '' });
      await onCreated();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao emitir');
    }
  }
  return (
    <Card title="Fatura avulsa">
      <form className="ds-row" style={{ alignItems: 'flex-end' }} onSubmit={submit}>
        <ClientPicker value={tenantId} onChange={setTenantId} />
        <Input label="Descrição" required value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} style={{ minWidth: 240 }} />
        <Input label="Valor (R$)" inputMode="decimal" required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        <Input label="Vencimento" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
        <Button type="submit" variant="primary">
          Emitir
        </Button>
      </form>
      {msg && <Alert tone="danger">{msg}</Alert>}
    </Card>
  );
}
