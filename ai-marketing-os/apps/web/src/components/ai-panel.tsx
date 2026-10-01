'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AGENT_LABELS, RUN_KIND_LABELS, RUN_STATUS_LABELS, type AgentKey } from '@aimos/shared';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { runTone, usd } from '@/lib/labels';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, EmptyState, Textarea } from '@/design-system/components';

export interface Run {
  id: string;
  agentKey: AgentKey;
  kind: string;
  status: string;
  stepIndex: number | null;
  revision: number;
  instruction: string | null;
  output: { summary?: string; missingInfo?: string[]; score?: number } | null;
  error: string | null;
  costUsdMicros: number;
  createdAt: string;
  finishedAt: string | null;
}

/** Hook: recarrega enquanto houver execução na fila ou rodando (sem websocket nesta fase). */
export function usePolling(active: boolean, reload: () => unknown, ms = 4000) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void reload(), ms);
    return () => clearInterval(t);
  }, [active, reload, ms]);
}

export function RunRow({ r, onAction, context }: { r: Run; onAction?: (path: string, ok: string) => void; context?: ReactNode }) {
  const { can } = useAuth();
  return (
    <li>
      <span className="ds-stack" style={{ gap: 2, minWidth: 0 }}>
        {context && <span className="ds-stat-hint">{context}</span>}
        <span>
          <strong>{AGENT_LABELS[r.agentKey] ?? r.agentKey}</strong> · {RUN_KIND_LABELS[r.kind] ?? r.kind}
          {r.revision > 0 && ` · revisão ${r.revision}`}
        </span>
        {r.kind === 'qa' && typeof r.output?.score === 'number' && <span className="ds-stat-hint">Nota {r.output.score}/100</span>}
        {r.error && <span className="ds-stat-hint" style={{ color: 'var(--danger-ink)' }}>{r.error}</span>}
        <span className="ds-stat-hint">
          {fmtDateTime(r.createdAt)}
          {r.costUsdMicros > 0 && ` · ${usd(r.costUsdMicros, 4)}`}
        </span>
      </span>
      <span className="ds-row" style={{ gap: 6 }}>
        <Badge tone={runTone[r.status]}>{RUN_STATUS_LABELS[r.status as keyof typeof RUN_STATUS_LABELS] ?? r.status}</Badge>
        {onAction && can('ai:run') && ['failed', 'blocked'].includes(r.status) && (
          <Button size="sm" onClick={() => onAction(`/ai/runs/${r.id}/retry`, 'Execução de volta à fila.')}>
            Repetir
          </Button>
        )}
        {onAction && can('ai:run') && ['queued', 'running'].includes(r.status) && (
          <Button size="sm" variant="ghost" onClick={() => onAction(`/ai/runs/${r.id}/cancel`, 'Execução cancelada.')}>
            Cancelar
          </Button>
        )}
      </span>
    </li>
  );
}

/**
 * Painel da equipe de agentes dentro da demanda: aciona o Orchestrator,
 * acompanha cada passo (plano → produção → QA → revisão) e mostra custo.
 * Tudo que os agentes produzem chega como rascunho para revisão humana.
 */
export function AiPanel({ demandId, tenantId, closed, onChange }: { demandId: string; tenantId: string; closed: boolean; onChange: () => void }) {
  const { can } = useAuth();
  const status = useApi<{ llm: string }>('/ai/status');
  const runs = useApi<{ items: Run[] }>(`/ai/runs?demandId=${demandId}&limit=100`);
  const [instruction, setInstruction] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);
  const items = runs.data?.items ?? [];
  const active = items.some((r) => r.status === 'queued' || r.status === 'running');
  const [wasActive, setWasActive] = useState(false);

  usePolling(active, runs.reload);
  useEffect(() => {
    // Quando a fila esvazia, atualiza a demanda (novos rascunhos, status).
    if (wasActive && !active) onChange();
    setWasActive(active);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (path: string, ok: string, body: unknown = {}) => {
    setMsg(null);
    try {
      await api(path, { method: 'POST', body, tenantId });
      setMsg({ tone: 'ok', text: ok });
      await runs.reload();
    } catch (err) {
      setMsg({ tone: err instanceof ApiError && err.code === 'integration_pending' ? 'warn' : 'danger', text: err instanceof ApiError ? err.message : 'Falha.' });
    }
  };

  const plan = items.find((r) => r.kind === 'plan' && r.status === 'succeeded');
  const pending = status.data?.llm === 'integration_pending';
  const total = items.reduce((a, r) => a + r.costUsdMicros, 0);

  return (
    <Card title="Equipe de agentes" action={total > 0 ? <span className="ds-stat-hint">Custo nesta demanda: {usd(total, 4)}</span> : undefined}>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {pending && <Alert tone="warn">IA: integration pending — configure ANTHROPIC_API_KEY no servidor para acionar os agentes.</Alert>}
      {plan?.output?.summary && (
        <div className="ds-stack" style={{ gap: 4 }}>
          <span className="ds-eyebrow">Plano do Orchestrator</span>
          <p className="ds-text-2" style={{ margin: 0 }}>{plan.output.summary}</p>
          {!!plan.output.missingInfo?.length && (
            <Alert tone="warn">
              Falta informação: {plan.output.missingInfo.join('; ')}
            </Alert>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState>Nenhuma execução ainda. O Orchestrator lê o pedido, o briefing, o Brand Vault e a memória aprovada do cliente e monta o plano.</EmptyState>
      ) : (
        <ul className="ds-list">{[...items].reverse().map((r) => <RunRow key={r.id} r={r} onAction={(p, ok) => void act(p, ok)} />)}</ul>
      )}
      {can('ai:run') && !closed && !pending && !active && (
        <div className="ds-stack" style={{ gap: 8 }}>
          <Textarea label="Orientação para o Orchestrator (opcional)" value={instruction} maxLength={4000} onChange={(e) => setInstruction(e.target.value)} />
          <div>
            <Button variant="primary" onClick={() => void act(`/demands/${demandId}/ai/plan`, 'Orchestrator na fila. Os passos aparecem aqui conforme forem executados.', instruction.trim() ? { instruction: instruction.trim() } : {}).then(() => setInstruction(''))}>
              Planejar com IA
            </Button>
          </div>
        </div>
      )}
      {active && <p className="ds-stat-hint">Executando na fila… esta lista atualiza sozinha.</p>}
    </Card>
  );
}
