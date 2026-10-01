'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AGENT_LABELS, ROOM_AGENT_KEYS, type AgentKey } from '@aimos/shared';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { ClientPicker } from '@/components/client-picker';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Skeleton, Textarea } from '@/design-system/components';

interface Meeting {
  id: string;
  clientName: string;
  title: string;
  agentKeys: AgentKey[];
  status: 'open' | 'summarizing' | 'closed';
  createdAt: string;
  createdByName: string | null;
  messageCount: number;
}

const STATUS = { open: ['Aberta', 'ok'], summarizing: ['Gerando ata', 'info'], closed: ['Encerrada', 'neutral'] } as const;

export default function AgentRoomPage() {
  const { can } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const list = useApi<{ items: Meeting[] }>('/ai/meetings', { tenantId: filter });
  const [tenantId, setTenantId] = useState('');
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [agents, setAgents] = useState<AgentKey[]>(['director', 'copywriter']);
  const [error, setError] = useState<string | null>(null);

  const toggle = (k: AgentKey) => setAgents((a) => (a.includes(k) ? a.filter((x) => x !== k) : a.length >= 6 ? a : [...a, k]));

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ id: string }>('/ai/meetings', { method: 'POST', body: { title, agenda: agenda || undefined, agentKeys: agents }, tenantId: tenantId || null });
      router.push(`/agent-room/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao abrir a reunião.');
    }
  }

  return (
    <>
      <PageHeader eyebrow="Inteligência" title="Agent Room" />
      <div className="ds-grid ds-split" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
        <Card title="Reuniões">
          <ClientPicker value={filter} onChange={setFilter} allowAll />
          {list.error && <Alert tone="danger">{list.error.message}</Alert>}
          {!list.data ? (
            <Skeleton height={160} />
          ) : list.data.items.length === 0 ? (
            <EmptyState>Nenhuma reunião ainda.</EmptyState>
          ) : (
            <ul className="ds-list">
              {list.data.items.map((m) => (
                <li key={m.id}>
                  <span className="ds-stack" style={{ gap: 2 }}>
                    <Link href={`/agent-room/${m.id}`}>{m.title}</Link>
                    <span className="ds-stat-hint">
                      {m.clientName} · {m.agentKeys.map((k) => AGENT_LABELS[k]).join(', ')} · {m.messageCount} mensagens · {fmtDateTime(m.createdAt)}
                    </span>
                  </span>
                  <Badge tone={STATUS[m.status][1]}>{STATUS[m.status][0]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {can('ai:run') && (
          <Card title="Nova reunião">
            <form className="ds-stack" style={{ gap: 'var(--space-3)' }} onSubmit={create}>
              {error && <Alert tone="danger">{error}</Alert>}
              <ClientPicker value={tenantId} onChange={setTenantId} />
              <Input label="Assunto" required minLength={2} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
              <Textarea label="Pauta (opcional)" maxLength={4000} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
              <fieldset className="ds-stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
                <legend className="ds-eyebrow">Agentes convidados (até 6)</legend>
                <div className="ds-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {ROOM_AGENT_KEYS.map((k) => (
                    <label key={k} className="ds-check">
                      <input type="checkbox" checked={agents.includes(k)} onChange={() => toggle(k)} /> {AGENT_LABELS[k]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <Button type="submit" variant="primary" disabled={agents.length === 0}>
                  Abrir reunião
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
