'use client';

import Link from 'next/link';
import { PROPOSAL_STATUS_LABELS, type ProposalStatus } from '@aimos/shared';
import { brl, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/design-system/components';
import { proposalTone } from '@/lib/labels';

interface Proposal {
  id: string;
  number: string;
  clientName: string;
  title: string;
  status: ProposalStatus;
  validUntil: string;
  recurringTotalCents: number;
  oneTimeTotalCents: number;
  createdAt: string;
}

export default function ProposalsPage() {
  const { can } = useAuth();
  const { data, error } = useApi<{ items: Proposal[] }>('/proposals');
  const open = (data?.items ?? []).filter((p) => p.status === 'sent' || p.status === 'viewed');
  return (
    <>
      <PageHeader eyebrow="Comercial" title="Propostas" actions={can('proposals:write') && <Link className="ds-btn ds-btn-primary" href="/proposals/new">Nova proposta</Link>} />
      {data && open.length > 0 && (
        <p className="ds-text-2">
          {open.length} proposta(s) aguardando resposta · {brl(open.reduce((a, p) => a + p.recurringTotalCents, 0))} em recorrência potencial
        </p>
      )}
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!data ? (
        <Skeleton height={240} />
      ) : data.items.length === 0 ? (
        <div className="ds-card">
          <EmptyState>Nenhuma proposta ainda.</EmptyState>
        </div>
      ) : (
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th scope="col">Proposta</th>
                <th scope="col">Cliente</th>
                <th scope="col" className="ds-num">
                  Recorrente
                </th>
                <th scope="col" className="ds-num">
                  Setup
                </th>
                <th scope="col">Validade</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/proposals/${p.id}`} style={{ fontWeight: 500 }}>
                      {p.title}
                    </Link>
                    <div className="ds-stat-hint ds-mono">{p.number}</div>
                  </td>
                  <td>{p.clientName}</td>
                  <td className="ds-num">{brl(p.recurringTotalCents)}</td>
                  <td className="ds-num">{brl(p.oneTimeTotalCents)}</td>
                  <td>{fmtDate(p.validUntil)}</td>
                  <td>
                    <Badge tone={proposalTone[p.status]}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge>
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
