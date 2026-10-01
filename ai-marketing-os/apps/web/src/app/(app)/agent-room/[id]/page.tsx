'use client';

import { use, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AGENT_LABELS, type AgentKey } from '@aimos/shared';
import { api, ApiError, fmtDate, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { usePolling } from '@/components/ai-panel';
import { Alert, Badge, Button, Card, PageHeader, Skeleton, Textarea } from '@/design-system/components';

interface Message {
  id: string;
  authorType: 'human' | 'agent' | 'system';
  agentKey: AgentKey | null;
  authorName: string | null;
  content: string;
  createdAt: string;
}
interface Outcome {
  summary: string;
  decisions: string[];
  tasks: { title: string; owner: string; dueDate: string | null }[];
  strategyChanges: string[];
}
interface Meeting {
  id: string;
  tenantId: string;
  clientName: string;
  title: string;
  agenda: string | null;
  agentKeys: AgentKey[];
  status: 'open' | 'summarizing' | 'closed';
  outcome: Outcome | null;
  messages: Message[];
  runs: { id: string; agentKey: AgentKey; kind: string; status: string; error: string | null }[];
}

export default function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const m = useApi<Meeting>(`/ai/meetings/${id}`);
  const [content, setContent] = useState('');
  const [ask, setAsk] = useState<AgentKey[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);
  const [created, setCreated] = useState<number[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const waiting = !!m.data && (m.data.status === 'summarizing' || m.data.runs.some((r) => r.status === 'queued' || r.status === 'running'));
  usePolling(waiting, m.reload, 3000);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [m.data?.messages.length]);

  if (m.error) return <Alert tone="danger">{m.error.status === 404 ? 'Reunião não encontrada.' : m.error.message}</Alert>;
  if (!m.data) return <Skeleton height={400} />;
  const d = m.data;
  const targets = ask ?? d.agentKeys;

  async function send(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api<{ ai: string }>(`/ai/meetings/${id}/messages`, { method: 'POST', body: { content, ask: targets } });
      if (r.ai === 'integration_pending') setMsg({ tone: 'warn', text: 'Mensagem registrada. IA: integration pending — os agentes não responderão até a chave ser configurada.' });
      setContent('');
      await m.reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha ao enviar.' });
    }
  }
  const post = async (path: string, body: unknown, ok: string) => {
    setMsg(null);
    try {
      await api(path, { method: 'POST', body });
      setMsg({ tone: 'ok', text: ok });
      await m.reload();
      return true;
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha.' });
      return false;
    }
  };

  const who = (x: Message) => (x.authorType === 'agent' ? `${AGENT_LABELS[x.agentKey!]} · agente` : x.authorType === 'human' ? x.authorName ?? 'Equipe' : 'Sistema');

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/agent-room">Agent Room</Link> · {d.clientName}
          </>
        }
        title={d.title}
        actions={
          d.status === 'open' && can('ai:run') ? (
            <Button onClick={() => void post(`/ai/meetings/${id}/close`, {}, 'Encerrando: o Orchestrator está redigindo a ata.')}>Encerrar e gerar ata</Button>
          ) : (
            <Badge tone={d.status === 'closed' ? 'neutral' : 'info'}>{d.status === 'closed' ? 'Encerrada' : 'Gerando ata…'}</Badge>
          )
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {d.agenda && <p className="ds-text-2">Pauta: {d.agenda}</p>}

      <div className="ds-grid ds-split" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
        <Card title="Conversa">
          <div className="ds-stack" style={{ gap: 'var(--space-3)', maxHeight: 560, overflowY: 'auto' }} aria-live="polite">
            {d.messages.length === 0 && <p className="ds-stat-hint">Comece com uma pergunta para os agentes convidados.</p>}
            {d.messages.map((x) => (
              <div key={x.id} className="ds-card" style={{ padding: 'var(--space-3)', background: x.authorType === 'human' ? 'var(--surface-2)' : undefined }}>
                <span className="ds-eyebrow">
                  {who(x)} · {fmtDateTime(x.createdAt)}
                </span>
                <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{x.content}</p>
              </div>
            ))}
            {d.runs
              .filter((r) => r.status === 'queued' || r.status === 'running')
              .map((r) => (
                <p key={r.id} className="ds-stat-hint">
                  {AGENT_LABELS[r.agentKey]} está {r.kind === 'summarize' ? 'redigindo a ata' : 'respondendo'}…
                </p>
              ))}
            {d.runs
              .filter((r) => r.status === 'failed' || r.status === 'blocked')
              .map((r) => (
                <Alert key={r.id} tone="warn">
                  {AGENT_LABELS[r.agentKey]} não respondeu: {r.error}
                </Alert>
              ))}
            <div ref={end} />
          </div>
          {d.status === 'open' && can('ai:run') && (
            <form className="ds-stack" style={{ gap: 8 }} onSubmit={send}>
              <Textarea label="Sua mensagem" required maxLength={8000} value={content} onChange={(e) => setContent(e.target.value)} />
              <div className="ds-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="ds-stat-hint">Quem responde:</span>
                {d.agentKeys.map((k) => (
                  <label key={k} className="ds-check">
                    <input type="checkbox" checked={targets.includes(k)} onChange={() => setAsk(targets.includes(k) ? targets.filter((x) => x !== k) : [...targets, k])} /> {AGENT_LABELS[k]}
                  </label>
                ))}
              </div>
              <div>
                <Button type="submit" variant="primary" disabled={waiting && d.status !== 'open'}>
                  Enviar
                </Button>
              </div>
            </form>
          )}
        </Card>

        <Card title="Ata">
          {!d.outcome ? (
            <p className="ds-stat-hint">{d.status === 'closed' ? 'Reunião encerrada sem ata automática.' : 'A ata é gerada ao encerrar a reunião.'}</p>
          ) : (
            <div className="ds-stack" style={{ gap: 'var(--space-3)' }}>
              <p style={{ margin: 0 }}>{d.outcome.summary}</p>
              {d.outcome.decisions.length > 0 && (
                <div>
                  <span className="ds-eyebrow">Decisões</span>
                  <ul>
                    {d.outcome.decisions.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {d.outcome.tasks.length > 0 && (
                <div>
                  <span className="ds-eyebrow">Tarefas sugeridas</span>
                  <ul className="ds-list">
                    {d.outcome.tasks.map((t, i) => (
                      <li key={i}>
                        <span>
                          {t.title}
                          <div className="ds-stat-hint">
                            {t.owner}
                            {t.dueDate && ` · até ${fmtDate(t.dueDate)}`}
                          </div>
                        </span>
                        {can('tasks:write') &&
                          (created.includes(i) ? (
                            <Badge tone="ok">criada</Badge>
                          ) : (
                            <Button size="sm" onClick={() => void post(`/ai/meetings/${id}/tasks`, { index: i }, 'Tarefa criada.').then((ok) => ok && setCreated((c) => [...c, i]))}>
                              Criar tarefa
                            </Button>
                          ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.outcome.strategyChanges.length > 0 && (
                <Alert tone="neutral">
                  Mudanças de estratégia viraram memória proposta: revise em <Link href="/memory">Memória</Link>.
                </Alert>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
