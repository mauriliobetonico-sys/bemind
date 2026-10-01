'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TOOL_CALL_STATUSES, TOOL_CALL_STATUS_LABELS, type ToolCallStatus } from '@aimos/shared';
import { useApi } from '@/lib/use-api';
import { ClientPicker } from '@/components/client-picker';
import { usePolling } from '@/components/ai-panel';
import { CallRow, type ToolCall } from '@/components/tool-call-row';
import { Alert, Card, EmptyState, PageHeader, Select, Skeleton } from '@/design-system/components';

export default function ToolCallsPage() {
  const [tenantId, setTenantId] = useState('');
  const [status, setStatus] = useState<ToolCallStatus | ''>('pending_approval');
  const list = useApi<{ items: ToolCall[] }>(`/mcp/tool-calls${status ? `?status=${status}` : ''}`, { tenantId });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const active = !!list.data?.items.some((c) => c.status === 'queued' || c.status === 'running');
  usePolling(active, list.reload);

  const done = async (text: string, tone: 'ok' | 'danger' = 'ok') => {
    setMsg({ tone, text });
    await list.reload();
  };

  return (
    <>
      <PageHeader eyebrow="MCP Hub" title="Ações das ferramentas" actions={<Link href="/integrations">Integrações</Link>} />
      <p className="ds-text-2">Toda ação externa pedida por agentes ou pela equipe aparece aqui. Risco alto sempre espera uma decisão humana; nada é executado antes.</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <div className="ds-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <ClientPicker value={tenantId} onChange={setTenantId} allowAll />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as ToolCallStatus | '')} options={[{ value: '', label: 'Todos' }, ...TOOL_CALL_STATUSES.map((s) => ({ value: s, label: TOOL_CALL_STATUS_LABELS[s] }))]} />
        </div>
        {list.error && <Alert tone="danger">{list.error.message}</Alert>}
        {!list.data ? (
          <Skeleton height={200} />
        ) : list.data.items.length === 0 ? (
          <EmptyState>{status === 'pending_approval' ? 'Nada aguardando sua decisão.' : 'Nenhuma ação com estes filtros.'}</EmptyState>
        ) : (
          <ul className="ds-list">
            {list.data.items.map((c) => (
              <CallRow key={`${c.id}-${c.status}`} c={c} onDone={(t, tone) => void done(t, tone)} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
