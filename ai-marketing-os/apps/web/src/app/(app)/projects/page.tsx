'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES } from '@aimos/shared';
import { api, ApiError, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { ClientPicker, useClientOptions } from '@/components/client-picker';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '@/design-system/components';

interface Project {
  id: string;
  clientName: string;
  name: string;
  description: string | null;
  status: (typeof PROJECT_STATUSES)[number];
  startDate: string | null;
  dueDate: string | null;
  openDemands: number;
  totalDemands: number;
}

const TONE = { planning: 'info', active: 'ok', on_hold: 'warn', done: 'neutral', cancelled: 'neutral' } as const;

export default function ProjectsPage() {
  const { can } = useAuth();
  const { staff } = useClientOptions();
  const { data, error, reload } = useApi<{ items: Project[] }>('/projects');
  const [tenantId, setTenantId] = useState('');
  const [v, setV] = useState({ name: '', startDate: '', dueDate: '' });
  const [msg, setMsg] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/projects', { method: 'POST', tenantId: staff ? tenantId || null : null, body: { name: v.name, startDate: v.startDate || null, dueDate: v.dueDate || null } });
      setV({ name: '', startDate: '', dueDate: '' });
      await reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao criar');
    }
  }

  const setStatus = async (p: Project, status: string) => {
    try {
      await api(`/projects/${p.id}`, { method: 'PATCH', body: { status } });
      await reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao atualizar');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Operação" title="Projetos" />
      {can('work:manage') && (
        <Card title="Novo projeto">
          <form className="ds-row" style={{ alignItems: 'flex-end' }} onSubmit={create}>
            <ClientPicker value={tenantId} onChange={setTenantId} />
            <Input label="Nome" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} style={{ minWidth: 260 }} />
            <Input label="Início" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
            <Input label="Entrega" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
            <Button type="submit" variant="primary">
              Criar projeto
            </Button>
          </form>
        </Card>
      )}
      {(error || msg) && <Alert tone="danger">{error?.message ?? msg}</Alert>}
      {!data ? (
        <Skeleton height={240} />
      ) : data.items.length === 0 ? (
        <div className="ds-card">
          <EmptyState>Nenhum projeto.</EmptyState>
        </div>
      ) : (
        <div className="ds-grid ds-grid-3">
          {data.items.map((p) => (
            <Card key={p.id} title={p.name} action={<Badge tone={TONE[p.status]}>{PROJECT_STATUS_LABELS[p.status]}</Badge>}>
              <span className="ds-stat-hint">{p.clientName}</span>
              <p className="ds-text-2">
                {p.openDemands} demanda(s) em aberto de {p.totalDemands} · {fmtDate(p.startDate)} → {fmtDate(p.dueDate)}
              </p>
              <div className="ds-row">
                <Link className="ds-btn ds-btn-sm" href={`/demands?projectId=${p.id}`}>
                  Ver demandas
                </Link>
                {can('work:manage') && (
                  <Select label="Status" value={p.status} onChange={(e) => void setStatus(p, e.target.value)} options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))} />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
