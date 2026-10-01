'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Skeleton, Textarea } from '@/design-system/components';

interface Approval {
  id: string;
  clientName: string;
  status: 'pending' | 'approved' | 'changes_requested' | 'cancelled';
  message: string | null;
  reason: string | null;
  version: number;
  createdAt: string;
  decidedAt: string | null;
  deliverableTitle: string;
  deliverableDescription: string | null;
  fileId: string | null;
  fileName: string | null;
  fileMime: string | null;
  demandId: string;
  demandTitle: string;
  requestedByName: string | null;
  decidedByName: string | null;
}

const STATUS = {
  pending: { label: 'Aguardando', tone: 'warn' },
  approved: { label: 'Aprovado', tone: 'ok' },
  changes_requested: { label: 'Alteração solicitada', tone: 'danger' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
} as const;

export default function ApprovalsPage() {
  const { can } = useAuth();
  const decider = can('approvals:decide');
  const { data, error, reload } = useApi<{ items: Approval[] }>('/approvals');
  const pending = (data?.items ?? []).filter((a) => a.status === 'pending');
  const history = (data?.items ?? []).filter((a) => a.status !== 'pending');

  return (
    <>
      <PageHeader eyebrow="Operação" title="Aprovações" />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!data ? (
        <Skeleton height={280} />
      ) : (
        <>
          <section className="ds-stack">
            <h2 className="ds-card-title">{decider ? 'Esperando a sua decisão' : 'Aguardando o cliente'}</h2>
            {pending.length === 0 ? (
              <div className="ds-card">
                <EmptyState>Nada aguardando aprovação.</EmptyState>
              </div>
            ) : (
              <div className="ds-grid ds-grid-2">
                {pending.map((a) => (
                  <ApprovalCard key={a.id} a={a} decider={decider} onDone={reload} />
                ))}
              </div>
            )}
          </section>
          {history.length > 0 && (
            <section className="ds-stack">
              <h2 className="ds-card-title">Histórico</h2>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th scope="col">Entregável</th>
                      <th scope="col">Cliente</th>
                      <th scope="col">Decisão</th>
                      <th scope="col">Quando</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/demands/${a.demandId}`}>{a.deliverableTitle}</Link> <span className="ds-stat-hint">v{a.version}</span>
                          {a.reason && <div className="ds-stat-hint">“{a.reason}”</div>}
                        </td>
                        <td>{a.clientName}</td>
                        <td>
                          <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                        </td>
                        <td className="ds-stat-hint">
                          {fmtDateTime(a.decidedAt)} {a.decidedByName && `· ${a.decidedByName}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function ApprovalCard({ a, decider, onDone }: { a: Approval; decider: boolean; onDone: () => Promise<void> }) {
  const [changing, setChanging] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isImage = a.fileMime?.startsWith('image/') && a.fileMime !== 'image/svg+xml';

  async function decide(decision: 'approved' | 'changes_requested') {
    setBusy(true);
    setError(null);
    try {
      await api(`/approvals/${a.id}/decide`, { method: 'POST', body: { decision, reason: decision === 'changes_requested' ? reason : null } });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao registrar a decisão');
      setBusy(false);
    }
  }

  return (
    <Card title={a.deliverableTitle} action={<Badge tone="warn">v{a.version}</Badge>}>
      <p className="ds-stat-hint">
        <Link href={`/demands/${a.demandId}`}>{a.demandTitle}</Link> · {a.clientName} · enviado {fmtDateTime(a.createdAt)}
        {a.requestedByName && ` por ${a.requestedByName}`}
      </p>
      {a.fileId && isImage && <img className="ds-preview" src={`/api/files/${a.fileId}/download?inline=1`} alt={`Prévia de ${a.deliverableTitle}`} />}
      {a.deliverableDescription && <p style={{ whiteSpace: 'pre-wrap' }}>{a.deliverableDescription}</p>}
      {a.fileId && <a href={`/api/files/${a.fileId}/download`}>Baixar {a.fileName}</a>}
      {a.message && <p className="ds-text-2">“{a.message}”</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      {decider &&
        (changing ? (
          <div className="ds-stack">
            <Textarea label="O que você gostaria de alterar?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Gostei, mas quero trocar a foto." />
            <div className="ds-row">
              <Button variant="primary" disabled={busy || !reason.trim()} onClick={() => void decide('changes_requested')}>
                Enviar pedido de alteração
              </Button>
              <Button variant="ghost" onClick={() => setChanging(false)}>
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <div className="ds-row">
            <Button variant="primary" disabled={busy} onClick={() => void decide('approved')}>
              Aprovar
            </Button>
            <Button disabled={busy} onClick={() => setChanging(true)}>
              Solicitar alteração
            </Button>
          </div>
        ))}
    </Card>
  );
}
