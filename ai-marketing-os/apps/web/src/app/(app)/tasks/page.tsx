'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUSES } from '@aimos/shared';
import { api, ApiError, fmtDate } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { priorityTone } from '@/lib/labels';
import { ClientPicker } from '@/components/client-picker';
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Skeleton } from '@/design-system/components';

interface Task {
  id: string;
  tenantId: string;
  clientName: string;
  demandId: string | null;
  demandTitle: string | null;
  title: string;
  status: (typeof TASK_STATUSES)[number];
  priority: (typeof PRIORITIES)[number];
  assigneeName: string | null;
  dueDate: string | null;
  overdue: boolean;
}

function TaskBoard() {
  const params = useSearchParams();
  const demandId = params.get('demandId');
  const [filter, setFilter] = useState<'all' | 'mine' | 'overdue'>('all');
  const qs = new URLSearchParams({ ...(demandId ? { demandId } : {}), ...(filter === 'mine' ? { mine: 'true' } : {}), ...(filter === 'overdue' ? { overdue: 'true' } : {}) }).toString();
  const { data, error, reload } = useApi<{ items: Task[] }>(`/tasks?${qs}`);
  const [msg, setMsg] = useState<string | null>(null);

  const move = async (t: Task, status: string) => {
    try {
      await api(`/tasks/${t.id}`, { method: 'PATCH', body: { status } });
      await reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha ao mover');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Operação" title="Tarefas" actions={demandId && <Link href={`/demands/${demandId}`}>Voltar para a demanda</Link>} />
      <div className="ds-row" style={{ alignItems: 'flex-end' }}>
        <Select
          label="Mostrar"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'mine', label: 'Minhas' },
            { value: 'overdue', label: 'Atrasadas' },
          ]}
        />
      </div>
      <NewTask demandId={demandId} onCreated={reload} />
      {(error || msg) && <Alert tone="danger">{error?.message ?? msg}</Alert>}
      {!data ? (
        <Skeleton height={300} />
      ) : (
        <div className="ds-board">
          {TASK_STATUSES.map((s) => {
            const col = data.items.filter((t) => t.status === s);
            return (
              <section key={s} className="ds-column" aria-label={TASK_STATUS_LABELS[s]}>
                <header className="ds-column-head">
                  <span className="ds-eyebrow">{TASK_STATUS_LABELS[s]}</span>
                  <Badge>{col.length}</Badge>
                </header>
                {col.map((t) => (
                  <article key={t.id} className="ds-task" data-overdue={t.overdue}>
                    <strong style={{ fontWeight: 500 }}>{t.title}</strong>
                    <span className="ds-stat-hint">
                      {t.clientName}
                      {t.demandTitle && (
                        <>
                          {' · '}
                          <Link href={`/demands/${t.demandId}`}>{t.demandTitle}</Link>
                        </>
                      )}
                    </span>
                    <div className="ds-row" style={{ gap: 6 }}>
                      <Badge tone={priorityTone[t.priority]}>{PRIORITY_LABELS[t.priority]}</Badge>
                      {t.dueDate && <Badge tone={t.overdue ? 'danger' : 'neutral'}>{fmtDate(t.dueDate)}</Badge>}
                    </div>
                    {t.assigneeName && <span className="ds-stat-hint">Responsável: {t.assigneeName}</span>}
                    <label className="ds-label" htmlFor={`st-${t.id}`} style={{ fontSize: 12 }}>
                      Mover para
                    </label>
                    <select id={`st-${t.id}`} className="ds-select" value={t.status} onChange={(e) => void move(t, e.target.value)}>
                      {TASK_STATUSES.map((o) => (
                        <option key={o} value={o}>
                          {TASK_STATUS_LABELS[o]}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function NewTask({ demandId, onCreated }: { demandId: string | null; onCreated: () => Promise<void> }) {
  const [tenantId, setTenantId] = useState('');
  const [v, setV] = useState({ title: '', priority: 'normal', dueDate: '' });
  const [error, setError] = useState<string | null>(null);
  const demand = useApi<{ tenantId: string }>(demandId ? `/demands/${demandId}` : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/tasks', {
        method: 'POST',
        tenantId: demand.data?.tenantId ?? (tenantId || null),
        body: { title: v.title, priority: v.priority, dueDate: v.dueDate || null, demandId },
      });
      setV({ title: '', priority: 'normal', dueDate: '' });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar');
    }
  }

  return (
    <Card>
      <form className="ds-row" style={{ alignItems: 'flex-end' }} onSubmit={submit}>
        {!demandId && <ClientPicker value={tenantId} onChange={setTenantId} />}
        <Input label="Nova tarefa" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} style={{ minWidth: 260 }} />
        <Select label="Prioridade" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
        <Input label="Prazo" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
        <Button type="submit" variant="primary">
          Adicionar
        </Button>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
    </Card>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<Skeleton height={300} />}>
      <TaskBoard />
    </Suspense>
  );
}
