'use client';

import { useState } from 'react';
import { RISK_LABELS, TOOL_CALL_STATUS_LABELS } from '@aimos/shared';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { toolCallTone } from '@/lib/labels';
import { usePolling } from '@/components/ai-panel';
import type { ToolCall } from '@/components/tool-call-row';
import { Alert, Badge, Button } from '@/design-system/components';

/**
 * Ações de integração de um entregável (hoje: WordPress). Sempre passam pelo
 * MCP Hub — publicar é risco alto e fica aguardando aprovação humana.
 */
export function DeliverableTools({ deliverableId, tenantId, approved }: { deliverableId: string; tenantId: string; approved: boolean }) {
  const { can } = useAuth();
  const calls = useApi<{ items: ToolCall[] }>(`/mcp/tool-calls?deliverableId=${deliverableId}&limit=10`, { tenantId });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);
  const [when, setWhen] = useState('');
  const items = calls.data?.items ?? [];
  usePolling(items.some((c) => c.status === 'queued' || c.status === 'running'), calls.reload);
  const open = (tool: string) => items.some((c) => c.tool === tool && ['pending_approval', 'queued', 'running'].includes(c.status));

  const request = async (tool: string, reason: string, scheduledFor?: string) => {
    setMsg(null);
    try {
      const r = await api<{ status: string; risk: 'LOW' | 'MEDIUM' | 'HIGH' }>('/mcp/tool-calls', { method: 'POST', body: { tool, params: { deliverableId }, reason, ...(scheduledFor ? { scheduledFor } : {}) }, tenantId });
      setMsg(
        r.status === 'pending_approval'
          ? { tone: 'warn', text: `Risco ${RISK_LABELS[r.risk].toLowerCase()}: aguardando aprovação em "Ações das ferramentas".` }
          : { tone: 'ok', text: 'Na fila: o resultado aparece aqui.' },
      );
      await calls.reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha.' });
    }
  };

  if (!can('mcp:use')) return null;
  return (
    <div className="ds-stack" style={{ gap: 6 }}>
      <div className="ds-row" style={{ flexWrap: 'wrap' }}>
        <span className="ds-stat-hint">WordPress:</span>
        <Button size="sm" disabled={open('wordpress.create_draft')} onClick={() => void request('wordpress.create_draft', 'Enviar como rascunho para revisão no site')}>
          Enviar como rascunho
        </Button>
        <Button
          size="sm"
          disabled={!approved || open('wordpress.publish_post')}
          title={approved ? undefined : 'Disponível depois da aprovação do cliente'}
          onClick={() => void request('wordpress.publish_post', when ? 'Publicação agendada de entregável aprovado' : 'Publicar entregável aprovado pelo cliente', when ? new Date(when).toISOString() : undefined)}
        >
          {when ? 'Agendar publicação (exige aprovação)' : 'Publicar (exige aprovação)'}
        </Button>
        {approved && (
          <label className="ds-stat-hint ds-row" style={{ gap: 6 }}>
            Agendar para
            <input type="datetime-local" className="ds-input" style={{ minHeight: 32, padding: '2px 8px', width: 'auto' }} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Data e hora da publicação" />
          </label>
        )}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {items.slice(0, 3).map((c) => (
        <span key={c.id} className="ds-stat-hint">
          <Badge tone={toolCallTone[c.status]}>{TOOL_CALL_STATUS_LABELS[c.status]}</Badge> {c.tool === 'wordpress.publish_post' ? 'Publicação' : 'Rascunho'}
          {c.scheduledFor && c.status !== 'succeeded' && ` · agendada para ${fmtDateTime(c.scheduledFor)}`}
          {c.result?.summary && ` · ${c.result.summary}`}
          {c.error && ` · ${c.error}`}
          {c.result?.data?.link && (
            <>
              {' · '}
              <a href={c.result.data.link} target="_blank" rel="noopener noreferrer">
                abrir
              </a>
            </>
          )}
        </span>
      ))}
    </div>
  );
}
