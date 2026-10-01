'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CALENDAR_KIND_LABELS, CALENDAR_KINDS } from '@aimos/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { ClientPicker, useClientOptions } from '@/components/client-picker';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '@/design-system/components';

interface CalItem {
  source: 'event' | 'demand' | 'approval' | 'task';
  id: string;
  clientName: string | null;
  kind: keyof typeof CALENDAR_KIND_LABELS;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  visibility: string;
  demandId: string | null;
}

type View = 'month' | 'week' | 'day';
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
/** Dia local do item (dias inteiros vêm como meia-noite UTC: usa a data, não o fuso). */
const dayKey = (i: CalItem) => (i.allDay ? i.startsAt.slice(0, 10) : iso(new Date(i.startsAt)));

function range(view: View, cursor: Date): [Date, Date] {
  if (view === 'day') return [cursor, cursor];
  if (view === 'week') {
    const s = startOfWeek(cursor);
    return [s, addDays(s, 6)];
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const s = startOfWeek(first);
  return [s, addDays(s, 41)];
}

export default function CalendarPage() {
  const { can } = useAuth();
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [from, to] = range(view, cursor);
  const { data, error, reload } = useApi<{ items: CalItem[] }>(`/calendar?from=${iso(from)}&to=${iso(to)}`);

  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const i of data?.items ?? []) {
      const k = dayKey(i);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return m;
  }, [data]);

  const move = (dir: number) =>
    setCursor((c) => (view === 'month' ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, dir * (view === 'week' ? 7 : 1))));
  const title =
    view === 'month'
      ? cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${from.toLocaleDateString('pt-BR')} – ${to.toLocaleDateString('pt-BR')}`
        : cursor.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const today = iso(new Date());
  const days = Array.from({ length: Math.round((to.getTime() - from.getTime()) / 86400000) + 1 }, (_, n) => addDays(from, n));

  return (
    <>
      <PageHeader eyebrow="Planejamento" title="Calendário" />
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <div className="ds-row">
          <Button size="sm" onClick={() => move(-1)} aria-label="Período anterior">
            ‹
          </Button>
          <Button size="sm" onClick={() => setCursor(new Date())}>
            Hoje
          </Button>
          <Button size="sm" onClick={() => move(1)} aria-label="Próximo período">
            ›
          </Button>
          <h2 className="ds-card-title">{title.charAt(0).toUpperCase() + title.slice(1)}</h2>
        </div>
        <div className="ds-tabs" role="tablist" style={{ borderBottom: 'none' }}>
          {(['month', 'week', 'day'] as const).map((v) => (
            <button key={v} className="ds-tab" role="tab" aria-selected={view === v} onClick={() => setView(v)}>
              {v === 'month' ? 'Mensal' : v === 'week' ? 'Semanal' : 'Diário'}
            </button>
          ))}
        </div>
      </div>
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!data ? (
        <Skeleton height={420} />
      ) : view === 'month' ? (
        <>
          <div className="ds-cal-grid">
            {WEEKDAYS.map((w) => (
              <div key={w} className="ds-cal-head">
                {w}
              </div>
            ))}
            {days.map((d) => {
              const k = iso(d);
              const items = byDay.get(k) ?? [];
              return (
                <div key={k} className="ds-cal-day" data-out={d.getMonth() !== cursor.getMonth()} data-today={k === today}>
                  <button
                    className="ds-cal-num"
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                    onClick={() => {
                      setCursor(d);
                      setView('day');
                    }}
                    aria-label={`Ver ${d.toLocaleDateString('pt-BR')}`}
                  >
                    {d.getDate()}
                  </button>
                  {items.slice(0, 3).map((i) => (
                    <ItemChip key={`${i.source}-${i.id}`} i={i} />
                  ))}
                  {items.length > 3 && <span className="ds-stat-hint">+{items.length - 3}</span>}
                </div>
              );
            })}
          </div>
          <AgendaList days={days.filter((d) => d.getMonth() === cursor.getMonth())} byDay={byDay} mobileOnly />
        </>
      ) : (
        <AgendaList days={days} byDay={byDay} />
      )}
      {can('work:manage') && <NewEvent onCreated={reload} defaultDate={iso(cursor)} />}
    </>
  );
}

function ItemChip({ i }: { i: CalItem }) {
  const label = `${i.clientName ? `${i.clientName}: ` : ''}${i.title}`;
  return i.demandId ? (
    <Link className="ds-cal-item" data-kind={i.kind} href={`/demands/${i.demandId}`} title={label}>
      {label}
    </Link>
  ) : (
    <span className="ds-cal-item" data-kind={i.kind} title={label}>
      {label}
    </span>
  );
}

function AgendaList({ days, byDay, mobileOnly }: { days: Date[]; byDay: Map<string, CalItem[]>; mobileOnly?: boolean }) {
  const withItems = days.filter((d) => (byDay.get(iso(d)) ?? []).length > 0);
  return (
    <div className={mobileOnly ? 'ds-agenda-mobile' : undefined}>
      {withItems.length === 0 ? (
        <div className="ds-card">
          <EmptyState>Nada agendado neste período.</EmptyState>
        </div>
      ) : (
        <div className="ds-stack">
          {withItems.map((d) => (
            <Card key={iso(d)} title={d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}>
              <ul className="ds-list">
                {(byDay.get(iso(d)) ?? []).map((i) => (
                  <li key={`${i.source}-${i.id}`}>
                    <span>
                      {!i.allDay && (
                        <span className="ds-mono ds-stat-hint">{new Date(i.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} </span>
                      )}
                      {i.demandId ? <Link href={`/demands/${i.demandId}`}>{i.title}</Link> : i.title}
                      {i.clientName && <span className="ds-stat-hint"> · {i.clientName}</span>}
                    </span>
                    <span className="ds-row" style={{ gap: 6 }}>
                      {i.visibility === 'internal' && <Badge>interno</Badge>}
                      <Badge>{CALENDAR_KIND_LABELS[i.kind]}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NewEvent({ onCreated, defaultDate }: { onCreated: () => Promise<void>; defaultDate: string }) {
  const { staff } = useClientOptions();
  const [tenantId, setTenantId] = useState('');
  const [v, setV] = useState({ kind: 'content', title: '', date: defaultDate, time: '', visibility: 'client' });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const allDay = !v.time;
    const startsAt = new Date(`${v.date}T${v.time || '00:00'}:00`).toISOString();
    try {
      await api('/calendar/events', { method: 'POST', tenantId: staff ? tenantId || null : null, body: { kind: v.kind, title: v.title, startsAt, allDay, visibility: v.visibility } });
      setV({ ...v, title: '' });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar');
    }
  }

  return (
    <Card title="Novo evento">
      <form className="ds-row" style={{ alignItems: 'flex-end' }} onSubmit={submit}>
        <ClientPicker value={tenantId} onChange={setTenantId} />
        <Select label="Tipo" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={CALENDAR_KINDS.map((k) => ({ value: k, label: CALENDAR_KIND_LABELS[k] }))} />
        <Input label="Título" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} style={{ minWidth: 220 }} />
        <Input label="Data" type="date" required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        <Input label="Hora (opcional)" type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} />
        <Select label="Visível para" value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value })} options={[{ value: 'client', label: 'Cliente e equipe' }, { value: 'internal', label: 'Só equipe' }]} />
        <Button type="submit" variant="primary">
          Criar
        </Button>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
    </Card>
  );
}
