'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { eventLabel, greeting, statusLabel, statusTone } from '@/lib/labels';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, PendingModule, Skeleton, StatCard, Timeline } from '@/design-system/components';
import type { ClientStatus } from '@aimos/shared';

interface AdminDashboard {
  clients: { total: number; active: number; onboarding: number; prospect: number; paused: number; churned: number; newThisMonth: number };
  revenue: { mrrCents: number; averageTicketCents: number; basis: string };
  byPlan: { plan: string; count: number; mrrCents: number }[];
  attention: { clientId: string; tradeName: string; status: string; since: string; reason: string }[];
  timeline: { id: string; type: string; at: string; clientId: string; clientName: string; actorName: string | null }[];
  pendingModules: { key: string; label: string; phase: number }[];
  operations: {
    openDemands: number;
    newDemands: number;
    inProduction: number;
    overdueDemands: number;
    approvalsPending: number;
    approvalsStale: number;
    openTasks: number;
    overdueTasks: number;
    tasksDueToday: number;
  };
  workAttention: { kind: string; demandId: string; title: string; clientName: string; detail: string }[];
  finance: {
    overdueCount: number;
    overdueCents: number;
    receivedThisMonthCents: number;
    pendingActions: number;
    openProposals: number;
    clientsWithoutContract: number;
  } | null;
}

export default function DeskPage() {
  const { me } = useAuth();
  const router = useRouter();
  const { data, error, loading } = useApi<AdminDashboard>('/dashboard/admin');
  const [command, setCommand] = useState('');

  const firstName = me?.user.name.split(' ')[0] ?? '';
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  function onCommand(e: FormEvent) {
    e.preventDefault();
    const q = command.trim();
    router.push(q ? `/clients?q=${encodeURIComponent(q)}` : '/clients');
  }

  return (
    <>
      <PageHeader eyebrow={today} title={`${greeting()}, ${firstName}.`} actions={me && <Link className="ds-btn ds-btn-primary" href="/clients/new">Novo cliente</Link>} />

      <form className="ds-command" onSubmit={onCommand} role="search">
        <label htmlFor="cmd" className="ds-eyebrow" style={{ flexShrink: 0 }}>
          Comando
        </label>
        <input id="cmd" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="O que você deseja fazer? Hoje: buscar um cliente pelo nome, CNPJ ou e-mail." />
        <Badge>Linguagem natural · fase 4</Badge>
        <Button type="submit" variant="primary">
          Ir
        </Button>
      </form>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <div className="ds-grid ds-grid-4">
        {loading || !data ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} height={104} />)
        ) : (
          <>
            <StatCard label="MRR" value={brl(data.revenue.mrrCents)} hint="contratos ativos" />
            <StatCard label="Clientes ativos" value={data.clients.active} hint={`${data.clients.total} no total`} />
            <StatCard label="Em onboarding" value={data.clients.onboarding} tone={data.clients.onboarding > 0 ? 'warn' : undefined} hint={`${data.clients.newThisMonth} novo(s) este mês`} />
            <StatCard label="Ticket médio" value={brl(data.revenue.averageTicketCents)} hint="MRR ÷ contratos ativos" />
          </>
        )}
      </div>

      {data && (
        <div className="ds-grid ds-grid-4">
          <StatCard label="Demandas em aberto" value={data.operations.openDemands} hint={`${data.operations.newDemands} nova(s) aguardando triagem`} />
          <StatCard label="Em produção" value={data.operations.inProduction} hint={`${data.operations.overdueDemands} atrasada(s)`} tone={data.operations.overdueDemands > 0 ? 'danger' : undefined} />
          <StatCard label="Aprovações pendentes" value={data.operations.approvalsPending} hint={`${data.operations.approvalsStale} parada(s) há +3 dias`} tone={data.operations.approvalsStale > 0 ? 'warn' : undefined} />
          <StatCard label="Tarefas atrasadas" value={data.operations.overdueTasks} hint={`${data.operations.tasksDueToday} vencem hoje · ${data.operations.openTasks} abertas`} tone={data.operations.overdueTasks > 0 ? 'danger' : undefined} />
        </div>
      )}

      {data?.finance && (
        <div className="ds-grid ds-grid-4">
          <StatCard label="Recebido no mês" value={brl(data.finance.receivedThisMonthCents)} hint={<Link href="/finance">abrir financeiro</Link>} />
          <StatCard label="Inadimplência" value={brl(data.finance.overdueCents)} tone={data.finance.overdueCount > 0 ? 'danger' : undefined} hint={`${data.finance.overdueCount} fatura(s) vencida(s)`} />
          <StatCard label="Propostas aguardando" value={data.finance.openProposals} hint={<Link href="/proposals">ver propostas</Link>} />
          <StatCard label="Aprovações críticas" value={data.finance.pendingActions} tone={data.finance.pendingActions > 0 ? 'warn' : undefined} hint={data.finance.clientsWithoutContract > 0 ? `${data.finance.clientsWithoutContract} cliente(s) sem contrato` : 'todos os clientes com contrato'} />
        </div>
      )}

      <div className="ds-grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
        <div className="ds-stack" style={{ gap: 'var(--space-4)' }}>
          <Card title="O que precisa da sua atenção">
            {!data ? (
              <Skeleton height={80} />
            ) : data.attention.length === 0 && data.workAttention.length === 0 ? (
              <EmptyState>Nada pendente nos clientes. Tudo em dia.</EmptyState>
            ) : (
              <ul className="ds-list">
                {data.workAttention.map((a) => (
                  <li key={`${a.kind}-${a.demandId}`}>
                    <Link href={`/demands/${a.demandId}`}>
                      {a.clientName} — {a.title} <span className="ds-text-2">· {a.detail}</span>
                    </Link>
                    <Badge tone={a.kind === 'demand_new' ? 'info' : a.kind === 'approval_stale' ? 'warn' : 'danger'}>
                      {a.kind === 'demand_new' ? 'nova' : a.kind === 'approval_stale' ? 'aprovação' : a.kind === 'changes_requested' ? 'alteração' : 'atraso'}
                    </Badge>
                  </li>
                ))}
                {data.attention.map((a) => (
                  <li key={a.clientId}>
                    <Link href={`/clients/${a.clientId}`}>
                      {a.tradeName} — <span className="ds-text-2">{a.reason}</span>
                    </Link>
                    <Badge tone={statusTone[a.status as ClientStatus]}>{statusLabel(a.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Receita por plano">
            {!data ? (
              <Skeleton height={80} />
            ) : data.byPlan.length === 0 ? (
              <EmptyState>Cadastre o primeiro cliente para ver a distribuição.</EmptyState>
            ) : (
              <ul className="ds-list">
                {data.byPlan.map((p) => (
                  <li key={p.plan}>
                    <span>
                      <span className="ds-mono">{p.plan}</span> <span className="ds-muted">· {p.count} {p.count === 1 ? 'cliente' : 'clientes'}</span>
                    </span>
                    <span className="ds-num">{brl(p.mrrCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {data && <p className="ds-stat-hint">{data.revenue.basis}.</p>}
          </Card>
          <Card title="Chegando nas próximas fases">
            <div className="ds-stack" style={{ gap: 8 }}>
              {(data?.pendingModules ?? []).map((m) => (
                <PendingModule key={m.key} label={m.label} phase={m.phase} />
              ))}
            </div>
          </Card>
        </div>
        <Card title="Timeline operacional">
          {!data ? (
            <Skeleton height={240} />
          ) : (
            <Timeline
              items={data.timeline.map((t) => ({
                id: t.id,
                at: t.at,
                content: (
                  <>
                    <Link href={`/clients/${t.clientId}`}>{t.clientName}</Link> — {eventLabel(t.type)}
                    {t.actorName && <span className="ds-muted"> · {t.actorName}</span>}
                  </>
                ),
              }))}
            />
          )}
        </Card>
      </div>
    </>
  );
}
