'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AGENT_LABELS, MEMORY_KIND_LABELS, MEMORY_KINDS, MEMORY_STATUS_LABELS, MEMORY_STATUSES, type AgentKey, type MemoryKind, type MemoryStatus } from '@aimos/shared';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { memoryTone } from '@/lib/labels';
import { ClientPicker } from '@/components/client-picker';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Select, Skeleton, Textarea } from '@/design-system/components';

interface Memory {
  id: string;
  tenantId: string;
  clientName: string;
  kind: MemoryKind;
  content: string;
  status: MemoryStatus;
  sourceType: 'run' | 'message' | 'file' | 'manual';
  sourceDemandId: string | null;
  sourceMeetingId: string | null;
  proposedByAgent: AgentKey | null;
  proposedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  hasEmbedding: boolean;
  createdAt: string;
}

function Origin({ m }: { m: Memory }) {
  const by = m.proposedByAgent ? `agente ${AGENT_LABELS[m.proposedByAgent]}` : m.proposedByName ?? 'equipe';
  return (
    <span className="ds-stat-hint">
      {m.clientName} · proposta por {by} em {fmtDateTime(m.createdAt)}
      {m.sourceDemandId && (
        <>
          {' · '}
          <Link href={`/demands/${m.sourceDemandId}`}>origem: demanda</Link>
        </>
      )}
      {m.sourceMeetingId && (
        <>
          {' · '}
          <Link href={`/agent-room/${m.sourceMeetingId}`}>origem: reunião</Link>
        </>
      )}
      {m.decidedByName && ` · decidida por ${m.decidedByName}`}
    </span>
  );
}

function MemoryRow({ m, canDecide, onDone }: { m: Memory; canDecide: boolean; onDone: (text: string, tone?: 'ok' | 'danger') => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  const decide = async (decision: 'approve' | 'reject' | 'archive') => {
    try {
      await api(`/ai/memory/${m.id}/decide`, { method: 'POST', body: { decision, ...(editing && text !== m.content ? { content: text } : {}) } });
      setEditing(false);
      onDone(decision === 'approve' ? 'Memória aprovada: os agentes passam a usá-la.' : decision === 'reject' ? 'Memória rejeitada.' : 'Memória arquivada.');
    } catch (err) {
      onDone(err instanceof ApiError ? err.message : 'Falha.', 'danger');
    }
  };
  return (
    <li style={{ alignItems: 'flex-start' }}>
      <span className="ds-stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
        <span className="ds-row" style={{ gap: 6 }}>
          <Badge>{MEMORY_KIND_LABELS[m.kind]}</Badge>
          <Badge tone={memoryTone[m.status]}>{MEMORY_STATUS_LABELS[m.status]}</Badge>
        </span>
        {editing ? <Textarea label="Corrigir antes de aprovar" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} /> : <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>}
        <Origin m={m} />
      </span>
      {canDecide && (
        <span className="ds-stack" style={{ gap: 6 }}>
          {m.status !== 'approved' && (
            <Button size="sm" variant="primary" onClick={() => void decide('approve')}>
              Aprovar
            </Button>
          )}
          {m.status === 'proposed' && (
            <Button size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Cancelar' : 'Corrigir'}
            </Button>
          )}
          {m.status === 'proposed' && (
            <Button size="sm" variant="ghost" onClick={() => void decide('reject')}>
              Rejeitar
            </Button>
          )}
          {m.status === 'approved' && (
            <Button size="sm" variant="ghost" onClick={() => void decide('archive')}>
              Arquivar
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

export default function MemoryPage() {
  const { can } = useAuth();
  const [tenantId, setTenantId] = useState('');
  const [status, setStatus] = useState<MemoryStatus | ''>('proposed');
  const [kind, setKind] = useState<MemoryKind | ''>('');
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}) }).toString();
  const list = useApi<{ items: Memory[] }>(`/ai/memory?${qs}`, { tenantId });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [newKind, setNewKind] = useState<MemoryKind>('brand_rules');
  const [newContent, setNewContent] = useState('');
  const canApprove = can('ai:memory_approve');

  const done = async (text: string, tone: 'ok' | 'danger' = 'ok') => {
    setMsg({ tone, text });
    await list.reload();
  };

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<Memory>('/ai/memory', { method: 'POST', body: { kind: newKind, content: newContent }, tenantId: tenantId || null });
      setNewContent('');
      await done(r.status === 'approved' ? 'Memória registrada e aprovada.' : 'Memória proposta: aguarda aprovação de um gestor.');
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha.' });
    }
  }

  return (
    <>
      <PageHeader eyebrow="Inteligência" title="Memória dos clientes" />
      <p className="ds-text-2">
        Tudo que os agentes aprendem entra como <strong>proposta</strong>, com a origem. Só memória <strong>aprovada</strong> por uma pessoa é usada pelos agentes — regras de marca inclusive.
      </p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="ds-grid ds-split" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
        <Card title="Memórias">
          <div className="ds-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <ClientPicker value={tenantId} onChange={setTenantId} allowAll />
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as MemoryStatus | '')} options={[{ value: '', label: 'Todos' }, ...MEMORY_STATUSES.map((s) => ({ value: s, label: MEMORY_STATUS_LABELS[s] }))]} />
            <Select label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind | '')} options={[{ value: '', label: 'Todos' }, ...MEMORY_KINDS.map((k) => ({ value: k, label: MEMORY_KIND_LABELS[k] }))]} />
          </div>
          {list.error && <Alert tone="danger">{list.error.message}</Alert>}
          {!list.data ? (
            <Skeleton height={200} />
          ) : list.data.items.length === 0 ? (
            <EmptyState>{status === 'proposed' ? 'Nada aguardando revisão.' : 'Nenhuma memória com estes filtros.'}</EmptyState>
          ) : (
            <ul className="ds-list">
              {list.data.items.map((m) => (
                <MemoryRow key={`${m.id}-${m.status}`} m={m} canDecide={canApprove} onDone={(t, tone) => void done(t, tone)} />
              ))}
            </ul>
          )}
        </Card>
        {can('ai:run') && (
          <Card title="Registrar manualmente">
            <form className="ds-stack" style={{ gap: 'var(--space-3)' }} onSubmit={add}>
              <ClientPicker value={tenantId} onChange={setTenantId} />
              <Select label="Tipo" value={newKind} onChange={(e) => setNewKind(e.target.value as MemoryKind)} options={MEMORY_KINDS.map((k) => ({ value: k, label: MEMORY_KIND_LABELS[k] }))} />
              <Textarea label="Conteúdo" required minLength={3} maxLength={4000} value={newContent} onChange={(e) => setNewContent(e.target.value)} />
              <div>
                <Button type="submit" variant="primary">
                  {canApprove ? 'Registrar (aprovada)' : 'Propor'}
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
