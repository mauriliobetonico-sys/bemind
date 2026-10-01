'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError, brl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { eventLabel, greeting, statusLabel, statusTone, usd } from '@/lib/labels';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, PendingModule, Skeleton, StatCard, Timeline } from '@/design-system/components';
import type { ClientStatus } from '@aimos/shared';

interface AdminDashboard {
  clients: { total: number; active: number; onboarding: number; prospect: number; paused: number; churned: number; newThisMonth: number };
  revenue: { mrrCents: number; averageTicketCents: number; basis: string };
  byPlan: { plan: string; count: number; mrrCents: number }[];
  attention: { clientId: string; tradeName: string; status: string; since: string; reason: string }[];
  timeline: { id: string; type: string; at: string; clientId: string; clientName: string; actorName: string | null }[];
  pendingModules: { key: string; label: string; phase: number }[];
  mcp: { pendingApprovals: number; failed7d: number; connectionsWithError: number } | null;
  ai: { status: string; runsActive: number; runsWithProblems: number; runsDoneThisMonth: number; memoryProposals: number; costThisMonthUsdMicros: number | null } | null;
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
  const { me, can } = useAuth();
  const router = useRouter();
  const { data, error, loading } = useApi<AdminDashboard>('/dashboard/admin');
  const [command, setCommand] = useState('');

  const firstName = me?.user.name.split(' ')[0] ?? '';
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  const aiChat = can('ai:chat');
  const [cmdError, setCmdError] = useState<string | null>(null);
  async function onCommand(e: FormEvent) {
    e.preventDefault();
    const q = command.trim();
    if (aiChat && q) {
      // Linguagem natural: vira uma conversa no Chat Global (ferramentas só de leitura).
      try {
        const r = await api<{ id: string }>('/ai/chat/threads', { method: 'POST', body: { content: q } });
        router.push(`/chat?t=${r.id}`);
      } catch (err) {
        setCmdError(err instanceof ApiError ? err.message : 'Falha ao enviar.');
      }
      return;
    }
    router.push(q ? `/clients?q=${encodeURIComponent(q)}` : '/clients');
  }

  return (
    <>
      <PageHeader eyebrow={today} title={`${greeting()}, ${firstName}.`} actions={me && <Link className="ds-btn ds-btn-primary" href="/clients/new">Novo cliente</Link>} />

      <form className="ds-command" onSubmit={onCommand} role="search">
        <label htmlFor="cmd" className="ds-eyebrow" style={{ flexShrink: 0 }}>
          Comando
        </label>
        <input
          id="cmd"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={aiChat ? 'Pergunte em linguagem natural: “quais clientes têm fatura vencida?”' : 'Buscar um cliente pelo nome, CNPJ ou e-mail.'}
        />
        {aiChat && <Badge tone="info">Chat Global</Badge>}
        <Button type="submit" variant="primary">
          Ir
        </Button>
      </form>

      {cmdError && <Alert tone="danger">{cmdError}</Alert>}
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

      <div className="ds-grid ds-split" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
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
          {data?.ai && (
            <Card title="Equipe de agentes" action={<Link href="/agents">Ver execuções</Link>}>
              {data.ai.status !== 'configured' && <Alert tone="warn">IA: integration pending — configure ANTHROPIC_API_KEY no servidor.</Alert>}
              <div className="ds-grid ds-grid-2">
                <StatCard label="Executando agora" value={data.ai.runsActive} />
                <StatCard label="Com erro (7 dias)" value={data.ai.runsWithProblems} tone={data.ai.runsWithProblems ? 'warn' : undefined} hint={data.ai.runsWithProblems ? <Link href="/agents">revisar</Link> : undefined} />
                <StatCard label="Concluídas no mês" value={data.ai.runsDoneThisMonth} />
                <StatCard label="Memória aguardando você" value={data.ai.memoryProposals} tone={data.ai.memoryProposals ? 'warn' : undefined} hint={data.ai.memoryProposals ? <Link href="/memory">revisar</Link> : undefined} />
              </div>
              {data.mcp && (data.mcp.pendingApprovals > 0 || data.mcp.failed7d > 0 || data.mcp.connectionsWithError > 0) && (
                <Alert tone="warn">
                  Ferramentas: {data.mcp.pendingApprovals} aguardando sua aprovação · {data.mcp.failed7d} falhas em 7 dias
                  {data.mcp.connectionsWithError > 0 && ` · ${data.mcp.connectionsWithError} integração(ões) com erro`} — <Link href="/tool-calls">revisar</Link>
                </Alert>
              )}
              {data.ai.costThisMonthUsdMicros !== null && (
                <p className="ds-stat-hint">
                  Custo de IA no mês: {usd(data.ai.costThisMonthUsdMicros)} · <Link href="/ai-settings">orçamento por cliente</Link>
                </p>
              )}
            </Card>
          )}
          {(data?.pendingModules ?? []).length > 0 && (
            <Card title="Chegando nas próximas fases">
              <div className="ds-stack" style={{ gap: 8 }}>
                {(data?.pendingModules ?? []).map((m) => (
                  <PendingModule key={m.key} label={m.label} phase={m.phase} />
                ))}
              </div>
            </Card>
          )}
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
