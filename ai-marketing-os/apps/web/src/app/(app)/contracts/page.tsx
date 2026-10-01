'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CONTRACT_STATUS_LABELS, PERIODICITIES, PERIODICITY_LABELS } from '@aimos/shared';
import { api, ApiError, brl, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { contractTone } from '@/lib/labels';
import { ClientPicker } from '@/components/client-picker';
import { parseMoney } from '../clients/client-form';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '@/design-system/components';

interface Contract {
  id: string;
  number: string;
  clientName: string;
  title: string;
  status: keyof typeof CONTRACT_STATUS_LABELS;
  periodicity: keyof typeof PERIODICITY_LABELS;
  recurringAmountCents: number;
  monthlyValueCents: number;
  startDate: string;
  endDate: string | null;
  proposalNumber: string | null;
}

export default function ContractsPage() {
  const { can } = useAuth();
  const { data, error, reload } = useApi<{ items: Contract[] }>('/contracts');
  const [creating, setCreating] = useState(false);
  const mrr = (data?.items ?? []).filter((c) => c.status === 'active').reduce((a, c) => a + c.monthlyValueCents, 0);
  return (
    <>
      <PageHeader eyebrow="Comercial" title="Contratos" actions={can('contracts:write') && <Button onClick={() => setCreating((v) => !v)}>Contrato direto</Button>} />
      {data && <p className="ds-text-2">MRR dos contratos ativos: {brl(mrr)}</p>}
      {creating && <NewContract onCreated={async () => (setCreating(false), reload())} />}
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!data ? (
        <Skeleton height={240} />
      ) : data.items.length === 0 ? (
        <div className="ds-card">
          <EmptyState>Nenhum contrato. Contratos nascem do aceite de uma proposta ou podem ser cadastrados direto.</EmptyState>
        </div>
      ) : (
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th scope="col">Contrato</th>
                <th scope="col">Cliente</th>
                <th scope="col" className="ds-num">
                  Valor
                </th>
                <th scope="col">Vigência</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/contracts/${c.id}`} style={{ fontWeight: 500 }}>
                      {c.title}
                    </Link>
                    <div className="ds-stat-hint ds-mono">
                      {c.number}
                      {c.proposalNumber && ` · ${c.proposalNumber}`}
                    </div>
                  </td>
                  <td>{c.clientName}</td>
                  <td className="ds-num">
                    {brl(c.recurringAmountCents)}
                    <div className="ds-stat-hint">{PERIODICITY_LABELS[c.periodicity].toLowerCase()}</div>
                  </td>
                  <td>
                    {fmtDate(c.startDate)} → {c.endDate ? fmtDate(c.endDate) : 'indeterminado'}
                  </td>
                  <td>
                    <Badge tone={contractTone[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NewContract({ onCreated }: { onCreated: () => Promise<void> }) {
  const [tenantId, setTenantId] = useState('');
  const [v, setV] = useState({ title: '', periodicity: 'monthly', amount: '', setup: '', startDate: new Date().toISOString().slice(0, 10), billingDay: '10' });
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/contracts', {
        method: 'POST',
        tenantId: tenantId || null,
        body: { title: v.title, periodicity: v.periodicity, recurringAmountCents: parseMoney(v.amount), setupAmountCents: parseMoney(v.setup || '0'), startDate: v.startDate, billingDay: Number(v.billingDay) },
      });
      await onCreated();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao criar');
    }
  }
  return (
    <Card title="Contrato direto (assinado fora da plataforma)">
      <form className="ds-form-grid" onSubmit={submit}>
        <ClientPicker value={tenantId} onChange={setTenantId} />
        <Input label="Título" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        <Select label="Periodicidade" value={v.periodicity} onChange={(e) => setV({ ...v, periodicity: e.target.value })} options={PERIODICITIES.map((p) => ({ value: p, label: PERIODICITY_LABELS[p] }))} />
        <Input label="Valor por período (R$)" inputMode="decimal" required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        <Input label="Setup (R$, opcional)" inputMode="decimal" value={v.setup} onChange={(e) => setV({ ...v, setup: e.target.value })} />
        <Input label="Início" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
        <Input label="Dia de vencimento" type="number" min={1} max={28} value={v.billingDay} onChange={(e) => setV({ ...v, billingDay: e.target.value })} />
        <div className="ds-span-2">
          <Button type="submit" variant="primary">
            Criar contrato e iniciar cobrança
          </Button>
        </div>
      </form>
      {msg && <Alert tone="danger">{msg}</Alert>}
    </Card>
  );
}
