'use client';

import { useState, type FormEvent } from 'react';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@aimos/shared';
import { api, ApiError, brl, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { ClientPicker } from '@/components/client-picker';
import { FinanceNav } from '@/components/finance';
import { parseMoney } from '../../clients/client-form';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '@/design-system/components';

interface Expense {
  id: string;
  category: (typeof EXPENSE_CATEGORIES)[number];
  description: string;
  supplier: string | null;
  amountCents: number;
  incurredOn: string;
  clientName: string | null;
  deletionPending: boolean;
}

export default function ExpensesPage() {
  const { can } = useAuth();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, error, reload } = useApi<{ items: Expense[] }>(`/expenses?month=${month}`);
  const [msg, setMsg] = useState<string | null>(null);
  const total = (data?.items ?? []).reduce((a, e) => a + e.amountCents, 0);

  const remove = async (e: Expense) => {
    const reason = window.prompt(`Motivo para excluir "${e.description}"?`);
    if (!reason || reason.trim().length < 5) return;
    try {
      const r = await api<{ status: string }>(`/expenses/${e.id}`, { method: 'DELETE', body: { reason } });
      setMsg(r.status === 'pending' ? 'Exclusão enviada para aprovação.' : 'Despesa excluída.');
      await reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Despesas" actions={<Input label="Mês" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />} />
      <FinanceNav />
      {can('finance:write') && <NewExpense onCreated={reload} />}
      {(error || msg) && <Alert tone={error ? 'danger' : 'neutral'}>{error?.message ?? msg}</Alert>}
      {!data ? (
        <Skeleton height={240} />
      ) : data.items.length === 0 ? (
        <div className="ds-card">
          <EmptyState>Nenhuma despesa neste mês.</EmptyState>
        </div>
      ) : (
        <>
          <p className="ds-text-2">Total do mês: {brl(total)}</p>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">Despesa</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Rateio</th>
                  <th scope="col">Data</th>
                  <th scope="col" className="ds-num">
                    Valor
                  </th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.description}
                      {e.supplier && <div className="ds-stat-hint">{e.supplier}</div>}
                    </td>
                    <td>{EXPENSE_CATEGORY_LABELS[e.category]}</td>
                    <td>{e.clientName ?? <span className="ds-muted">Agência (geral)</span>}</td>
                    <td>{fmtDate(e.incurredOn)}</td>
                    <td className="ds-num">{brl(e.amountCents)}</td>
                    <td>
                      {e.deletionPending ? (
                        <Badge tone="warn">exclusão pendente</Badge>
                      ) : (
                        can('finance:write') && (
                          <Button size="sm" variant="ghost" onClick={() => void remove(e)}>
                            Excluir
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function NewExpense({ onCreated }: { onCreated: () => Promise<void> }) {
  const [clientTenantId, setClient] = useState('');
  const [v, setV] = useState({ category: 'software', description: '', supplier: '', amount: '', incurredOn: new Date().toISOString().slice(0, 10) });
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/expenses', { method: 'POST', body: { category: v.category, description: v.description, supplier: v.supplier || null, amountCents: parseMoney(v.amount), incurredOn: v.incurredOn, clientTenantId: clientTenantId || null } });
      setV({ ...v, description: '', supplier: '', amount: '' });
      await onCreated();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao salvar');
    }
  }
  return (
    <Card title="Nova despesa">
      <form className="ds-row" style={{ alignItems: 'flex-end' }} onSubmit={submit}>
        <Select label="Categoria" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))} />
        <Input label="Descrição" required value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} style={{ minWidth: 220 }} />
        <Input label="Fornecedor" value={v.supplier} onChange={(e) => setV({ ...v, supplier: e.target.value })} />
        <Input label="Valor (R$)" inputMode="decimal" required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        <Input label="Data" type="date" value={v.incurredOn} onChange={(e) => setV({ ...v, incurredOn: e.target.value })} />
        <ClientPicker label="Ratear para (opcional)" value={clientTenantId} onChange={setClient} allowAll />
        <Button type="submit" variant="primary">
          Lançar
        </Button>
      </form>
      {msg && <Alert tone="danger">{msg}</Alert>}
    </Card>
  );
}
