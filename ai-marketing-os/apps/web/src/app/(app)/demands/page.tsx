'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DEMAND_STATUS_LABELS, DEMAND_STATUSES, DEMAND_TYPE_LABELS, PRIORITY_LABELS, type DemandStatus } from '@aimos/shared';
import { fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { demandTone, priorityTone } from '@/lib/labels';
import { Alert, Badge, EmptyState, PageHeader, Select, Skeleton } from '@/design-system/components';

interface Demand {
  id: string;
  clientName: string;
  type: keyof typeof DEMAND_TYPE_LABELS;
  title: string;
  priority: keyof typeof PRIORITY_LABELS;
  dueDate: string | null;
  status: DemandStatus;
  overdue: boolean;
  projectName: string | null;
  createdAt: string;
}

function DemandList() {
  const { me, can } = useAuth();
  const params = useSearchParams();
  const projectId = params.get('projectId');
  const [status, setStatus] = useState('open');
  const [tenant, setTenant] = useState('');
  const qs = new URLSearchParams({
    ...(status === 'open' ? { open: 'true' } : status ? { status } : {}),
    ...(projectId ? { projectId } : {}),
  }).toString();
  const { data, error } = useApi<{ items: Demand[] }>(`/demands?${qs}`);
  const items = (data?.items ?? []).filter((d) => !tenant || d.clientName === tenant);

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Demandas"
        actions={can('demands:create') && <Link className="ds-btn ds-btn-primary" href="/demands/new">Nova demanda</Link>}
      />
      <div className="ds-row" style={{ alignItems: 'flex-end' }}>
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'open', label: 'Em aberto' }, { value: '', label: 'Todas' }, ...DEMAND_STATUSES.map((s) => ({ value: s, label: DEMAND_STATUS_LABELS[s] }))]}
          style={{ minWidth: 200 }}
        />
        {me?.isStaff && <ClientFilter value={tenant} onChange={setTenant} />}
      </div>
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!data ? (
        <Skeleton height={240} />
      ) : items.length === 0 ? (
        <div className="ds-card">
          <EmptyState>Nenhuma demanda por aqui.</EmptyState>
        </div>
      ) : (
        <div className="ds-table-wrap ds-fade-in">
          <table className="ds-table">
            <thead>
              <tr>
                <th scope="col">Demanda</th>
                {me?.isStaff && <th scope="col">Cliente</th>}
                <th scope="col">Tipo</th>
                <th scope="col">Prioridade</th>
                <th scope="col">Prazo</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/demands/${d.id}`} style={{ fontWeight: 500 }}>
                      {d.title}
                    </Link>
                    {d.projectName && <div className="ds-stat-hint">{d.projectName}</div>}
                  </td>
                  {me?.isStaff && <td>{d.clientName}</td>}
                  <td>{DEMAND_TYPE_LABELS[d.type]}</td>
                  <td>
                    <Badge tone={priorityTone[d.priority]}>{PRIORITY_LABELS[d.priority]}</Badge>
                  </td>
                  <td style={{ color: d.overdue ? 'var(--danger-ink)' : undefined }}>
                    {fmtDate(d.dueDate)}
                    {d.overdue && ' · atrasada'}
                  </td>
                  <td>
                    <Badge tone={demandTone[d.status]}>{DEMAND_STATUS_LABELS[d.status]}</Badge>
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

/** Filtro local por cliente (a lista já vem restrita pelo servidor). */
function ClientFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useApi<{ items: { tenantId: string; tradeName: string }[] }>('/clients?limit=100');
  return (
    <Select
      label="Cliente"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[{ value: '', label: 'Todos os clientes' }, ...(data?.items ?? []).map((c) => ({ value: c.tradeName, label: c.tradeName }))]}
      style={{ minWidth: 220 }}
    />
  );
}

export default function DemandsPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <DemandList />
    </Suspense>
  );
}
