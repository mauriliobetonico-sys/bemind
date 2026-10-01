'use client';

import { useState } from 'react';
import { ACTION_LABELS } from '@aimos/shared';
import { api, ApiError, brl, fmtDateTime } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { FinanceNav } from '@/components/finance';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Skeleton } from '@/design-system/components';

interface Action {
  id: string;
  clientName: string;
  action: string;
  payload: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'rejected' | 'executed' | 'failed';
  decisionNote: string | null;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  allowSelfApproval: boolean;
}

const STATUS = { pending: ['Aguardando', 'warn'], executed: ['Executada', 'ok'], rejected: ['Rejeitada', 'neutral'], failed: ['Falhou', 'danger'] } as const;

function describe(a: Action) {
  const p = a.payload;
  if (a.action === 'contract.change_value') return `${p.contractNumber}: ${brl(Number(p.previousCents))} → ${brl(Number(p.recurringAmountCents))}`;
  if (a.action === 'contract.cancel') return String(p.contractNumber ?? '');
  if (a.action === 'invoice.cancel') return String(p.invoiceNumber ?? '');
  if (a.action === 'expense.delete') return String(p.description ?? '');
  return '';
}

export default function ActionsPage() {
  const { me, can } = useAuth();
  const { data, error, reload } = useApi<{ items: Action[] }>('/actions');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const approver = can('finance:approve');

  const decide = async (a: Action, decision: 'approve' | 'reject') => {
    setMsg(null);
    try {
      const r = await api<{ status: string }>(`/actions/${a.id}/decide`, { method: 'POST', body: { decision, note: notes[a.id] || null } });
      setMsg({ tone: 'ok', text: r.status === 'executed' ? 'Aprovada e executada.' : 'Pedido rejeitado.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha' });
    }
    await reload();
  };

  const pending = (data?.items ?? []).filter((a) => a.status === 'pending');
  const done = (data?.items ?? []).filter((a) => a.status !== 'pending');

  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Aprovações críticas" />
      <FinanceNav />
      <p className="ds-text-2" style={{ maxWidth: 760 }}>
        Cancelar faturas e contratos, alterar valores e excluir despesas exigem uma decisão humana. Nada é executado antes da aprovação. As regras ficam em Configurações.
      </p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!data ? (
        <Skeleton height={240} />
      ) : (
        <>
          {pending.length === 0 ? (
            <div className="ds-card">
              <EmptyState>Nenhum pedido aguardando.</EmptyState>
            </div>
          ) : (
            <div className="ds-grid ds-grid-2">
              {pending.map((a) => {
                const selfBlocked = a.requestedBy === me?.user.id && !a.allowSelfApproval;
                return (
                  <Card key={a.id} title={ACTION_LABELS[a.action] ?? a.action} action={<Badge tone="warn">aguardando</Badge>}>
                    <p className="ds-stat-hint">
                      {a.clientName} · pedido por {a.requestedByName ?? '—'} em {fmtDateTime(a.createdAt)}
                    </p>
                    <p>{describe(a)}</p>
                    <p className="ds-text-2">Motivo: “{a.reason}”</p>
                    {approver ? (
                      selfBlocked ? (
                        <Alert>A política desta ação exige outra pessoa para aprovar.</Alert>
                      ) : (
                        <>
                          <Input label="Observação (opcional)" value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                          <div className="ds-row">
                            <Button variant="primary" onClick={() => void decide(a, 'approve')}>
                              Aprovar e executar
                            </Button>
                            <Button onClick={() => void decide(a, 'reject')}>Rejeitar</Button>
                          </div>
                        </>
                      )
                    ) : (
                      <p className="ds-stat-hint">Aguardando um administrador.</p>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
          {done.length > 0 && (
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th scope="col">Ação</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Decisão</th>
                    <th scope="col">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {done.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {ACTION_LABELS[a.action] ?? a.action}
                        <div className="ds-stat-hint">{describe(a)} · “{a.reason}”</div>
                        {a.error && <div className="ds-field-error">{a.error}</div>}
                      </td>
                      <td>{a.clientName}</td>
                      <td>
                        <Badge tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</Badge>
                        {a.decidedByName && <div className="ds-stat-hint">por {a.decidedByName}</div>}
                      </td>
                      <td className="ds-stat-hint">{fmtDateTime(a.decidedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
