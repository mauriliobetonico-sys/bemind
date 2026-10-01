'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RUN_STATUSES, RUN_STATUS_LABELS, type AgentKey } from '@aimos/shared';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { ClientPicker } from '@/components/client-picker';
import { RunRow, usePolling, type Run } from '@/components/ai-panel';
import { Alert, Badge, Card, EmptyState, PageHeader, Select, Skeleton } from '@/design-system/components';

interface Agent {
  key: AgentKey;
  name: string;
  identity: string;
  objective: string;
  quality: string[];
  handoff: AgentKey[];
  forbiddenTools: string[];
}
interface Status {
  llm: string;
  model: string;
  serverFallback: boolean;
  embeddings: string;
}

export default function AgentsPage() {
  const [tenantId, setTenantId] = useState('');
  const [status, setStatus] = useState('');
  const st = useApi<Status>('/ai/status');
  const agents = useApi<{ items: Agent[] }>('/ai/agents');
  const runs = useApi<{ items: (Run & { clientName: string; demandId: string | null; meetingId: string | null })[] }>(`/ai/runs?limit=100${status ? `&status=${status}` : ''}`, { tenantId });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const active = !!runs.data?.items.some((r) => r.status === 'queued' || r.status === 'running');
  usePolling(active, runs.reload);

  const act = async (path: string, ok: string) => {
    try {
      await api(path, { method: 'POST', body: {} });
      setMsg({ tone: 'ok', text: ok });
      await runs.reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha.' });
    }
  };

  return (
    <>
      <PageHeader eyebrow="Inteligência" title="Agentes" />
      {st.data && (
        <div className="ds-row">
          <Badge tone={st.data.llm === 'configured' ? 'ok' : 'warn'}>{st.data.llm === 'configured' ? `Claude conectado · ${st.data.model}` : 'IA: integration pending'}</Badge>
          {st.data.llm === 'configured' && st.data.serverFallback && <Badge tone="info">fallback do servidor ligado</Badge>}
          <Badge tone={st.data.embeddings === 'configured' ? 'ok' : 'neutral'}>{st.data.embeddings === 'configured' ? 'Busca semântica na memória ativa' : 'Busca semântica: integration pending'}</Badge>
        </div>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="ds-grid ds-split" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
        <Card title="Execuções">
          <div className="ds-row" style={{ alignItems: 'flex-end' }}>
            <ClientPicker value={tenantId} onChange={setTenantId} allowAll />
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Todos' }, ...RUN_STATUSES.map((s) => ({ value: s, label: RUN_STATUS_LABELS[s] }))]} />
          </div>
          {runs.error && <Alert tone="danger">{runs.error.message}</Alert>}
          {!runs.data ? (
            <Skeleton height={200} />
          ) : runs.data.items.length === 0 ? (
            <EmptyState>Nenhuma execução. Acione o Orchestrator numa demanda ou abra uma reunião no Agent Room.</EmptyState>
          ) : (
            <ul className="ds-list">
              {runs.data.items.map((r) => (
                <RunRow
                  key={r.id}
                  r={r}
                  onAction={(p, ok) => void act(p, ok)}
                  context={
                  <>
                    {r.clientName}
                    {r.demandId && (
                      <>
                        {' · '}
                        <Link href={`/demands/${r.demandId}`}>demanda</Link>
                      </>
                    )}
                    {r.meetingId && (
                      <>
                        {' · '}
                        <Link href={`/agent-room/${r.meetingId}`}>reunião</Link>
                      </>
                    )}
                  </>
                  }
                />
              ))}
            </ul>
          )}
        </Card>

        <Card title="A equipe">
          {!agents.data ? (
            <Skeleton height={300} />
          ) : (
            <ul className="ds-list">
              {agents.data.items.map((a) => (
                <li key={a.key} style={{ alignItems: 'flex-start' }}>
                  <span className="ds-stack" style={{ gap: 4 }}>
                    <strong>{a.name}</strong>
                    <span className="ds-text-2">{a.objective}</span>
                    <span className="ds-stat-hint">Qualidade: {a.quality.join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="ds-stat-hint">
            Nenhum agente publica, envia, gasta verba ou aprova: tudo o que produzem é rascunho, revisado pelo QA da IA e depois por uma pessoa da equipe.
          </p>
        </Card>
      </div>
    </>
  );
}
