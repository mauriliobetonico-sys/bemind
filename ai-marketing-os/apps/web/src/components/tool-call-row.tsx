'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AGENT_LABELS, RISK_LABELS, TOOL_CALL_STATUS_LABELS, type AgentKey, type RiskLevel, type ToolCallStatus } from '@aimos/shared';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { riskTone, toolCallTone } from '@/lib/labels';
import { Alert, Badge, Button, Textarea } from '@/design-system/components';

export interface ToolCall {
  id: string;
  tenantId: string;
  clientName: string;
  tool: string;
  risk: RiskLevel;
  status: ToolCallStatus;
  requiresApproval: boolean;
  params: Record<string, unknown>;
  reason: string | null;
  requestedByAgent: AgentKey | null;
  requestedByUser: string | null;
  requestedByName: string | null;
  demandId: string | null;
  deliverableId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  result: { summary?: string; data?: { link?: string } } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function CallRow({ c, onDone }: { c: ToolCall; onDone: (text: string, tone?: 'ok' | 'danger') => void }) {
  const { can, me } = useAuth();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const act = async (path: string, body: unknown, ok: string) => {
    try {
      await api(path, { method: 'POST', body });
      onDone(ok);
    } catch (err) {
      onDone(err instanceof ApiError ? err.message : 'Falha.', 'danger');
    }
  };
  const who = c.requestedByAgent ? `agente ${AGENT_LABELS[c.requestedByAgent]}` : c.requestedByName ?? 'equipe';
  const pending = c.status === 'pending_approval';
  const canCancel = (pending || c.status === 'queued') && (c.requestedByUser === me?.user.id || can('mcp:approve'));
  return (
    <li style={{ alignItems: 'flex-start' }}>
      <span className="ds-stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
        <span className="ds-row" style={{ gap: 6 }}>
          <strong className="ds-mono" style={{ fontSize: 13 }}>{c.tool}</strong>
          <Badge tone={riskTone[c.risk]}>Risco {RISK_LABELS[c.risk].toLowerCase()}</Badge>
          <Badge tone={toolCallTone[c.status]}>{TOOL_CALL_STATUS_LABELS[c.status]}</Badge>
        </span>
        <span className="ds-stat-hint">
          {c.clientName} · pedido por {who} em {fmtDateTime(c.createdAt)}
          {c.demandId && (
            <>
              {' · '}
              <Link href={`/demands/${c.demandId}`}>demanda</Link>
            </>
          )}
          {c.decidedByName && ` · decidido por ${c.decidedByName}`}
        </span>
        {c.reason && <span>Motivo: {c.reason}</span>}
        <button type="button" className="ds-stat-hint" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline' }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Ocultar parâmetros' : 'Ver parâmetros'}
        </button>
        {open && <pre className="ds-mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: 0, background: 'var(--surface-2)', padding: 8, borderRadius: 8 }}>{JSON.stringify(c.params, null, 2)}</pre>}
        {c.result?.summary && (
          <Alert tone="ok">
            {c.result.summary}
            {c.result.data?.link && (
              <>
                {' '}
                <a href={c.result.data.link} target="_blank" rel="noopener noreferrer">
                  abrir
                </a>
              </>
            )}
          </Alert>
        )}
        {c.error && <Alert tone={c.status === 'failed' ? 'danger' : 'warn'}>{c.status === 'queued' ? `Aguardando nova tentativa: ${c.error}` : c.error}</Alert>}
        {pending && can('mcp:approve') && (
          <div className="ds-stack" style={{ gap: 6 }}>
            <Textarea label="Observação (opcional)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            <div className="ds-row">
              <Button size="sm" variant="primary" onClick={() => void act(`/mcp/tool-calls/${c.id}/decide`, { decision: 'approve', ...(note ? { note } : {}) }, 'Aprovado: a ação entrou na fila.')}>
                Aprovar e executar
              </Button>
              <Button size="sm" variant="danger" onClick={() => void act(`/mcp/tool-calls/${c.id}/decide`, { decision: 'reject', ...(note ? { note } : {}) }, 'Pedido rejeitado.')}>
                Rejeitar
              </Button>
            </div>
          </div>
        )}
      </span>
      {canCancel && (
        <Button size="sm" variant="ghost" onClick={() => void act(`/mcp/tool-calls/${c.id}/cancel`, {}, 'Cancelado.')}>
          Cancelar
        </Button>
      )}
    </li>
  );
}
