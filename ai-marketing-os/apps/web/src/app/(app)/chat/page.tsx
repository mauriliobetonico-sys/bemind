'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { usePolling } from '@/components/ai-panel';
import { Alert, Button, Card, EmptyState, PageHeader, Skeleton, Textarea } from '@/design-system/components';

interface Thread {
  id: string;
  title: string;
  updatedAt: string;
}
interface ThreadDetail extends Thread {
  messages: { id: string; authorType: 'human' | 'agent'; content: string; data: { toolCalls?: string[] } | null; createdAt: string }[];
  lastRun: { id: string; status: string; error: string | null } | null;
}

const TOOL_LABELS: Record<string, string> = {
  list_clients: 'clientes',
  client_overview: 'visão do cliente',
  list_open_demands: 'demandas',
  finance_summary: 'financeiro',
  ai_usage_summary: 'consumo de IA',
  client_memory: 'memória',
};

export default function ChatPage() {
  const threads = useApi<{ items: Thread[] }>('/ai/chat/threads');
  const status = useApi<{ llm: string }>('/ai/status');
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    // Conversa aberta a partir do comando do Desk (?t=<id>).
    const t = new URLSearchParams(window.location.search).get('t');
    if (t && /^[0-9a-f-]{36}$/i.test(t)) setActive(t);
  }, []);
  const thread = useApi<ThreadDetail>(active ? `/ai/chat/threads/${active}` : null);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const busy = !!thread.data?.lastRun && ['queued', 'running'].includes(thread.data.lastRun.status);
  usePolling(busy, thread.reload, 2500);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [thread.data?.messages.length, busy]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (active) {
        await api(`/ai/chat/threads/${active}/messages`, { method: 'POST', body: { content } });
        await thread.reload();
      } else {
        const r = await api<{ id: string }>('/ai/chat/threads', { method: 'POST', body: { content } });
        setActive(r.id);
        await threads.reload();
      }
      setContent('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao enviar.');
    }
  }
  const remove = async (id: string) => {
    await api(`/ai/chat/threads/${id}`, { method: 'DELETE' });
    if (active === id) setActive(null);
    await threads.reload();
  };

  const pending = status.data?.llm === 'integration_pending';

  return (
    <>
      <PageHeader eyebrow="Inteligência" title="Chat Global" />
      <p className="ds-text-2">Pergunte sobre clientes, demandas, finanças e consumo de IA. O assistente consulta dados reais com as suas permissões e só lê — quem executa ações é você, na tela certa.</p>
      {pending && <Alert tone="warn">IA: integration pending — configure ANTHROPIC_API_KEY no servidor.</Alert>}
      <div className="ds-grid ds-split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2.4fr)' }}>
        <Card title="Conversas" action={<Button size="sm" onClick={() => setActive(null)}>Nova</Button>}>
          {!threads.data ? (
            <Skeleton height={120} />
          ) : threads.data.items.length === 0 ? (
            <EmptyState>Nenhuma conversa.</EmptyState>
          ) : (
            <ul className="ds-list">
              {threads.data.items.map((t) => (
                <li key={t.id}>
                  <button type="button" className="ds-link-btn" onClick={() => setActive(t.id)} aria-current={active === t.id ? 'true' : undefined} style={{ fontWeight: active === t.id ? 600 : 400, textAlign: 'left', background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }}>
                    {t.title}
                    <div className="ds-stat-hint">{fmtDateTime(t.updatedAt)}</div>
                  </button>
                  <Button size="sm" variant="ghost" aria-label={`Excluir conversa ${t.title}`} onClick={() => void remove(t.id)}>
                    Excluir
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={thread.data?.title ?? 'Nova conversa'}>
          <div className="ds-stack" style={{ gap: 'var(--space-3)', minHeight: 240, maxHeight: 560, overflowY: 'auto' }} aria-live="polite">
            {!active && <p className="ds-stat-hint">Ex.: “Quais clientes têm fatura vencida?”, “Como está a operação do cliente X?”, “Quanto gastamos de IA este mês?”</p>}
            {thread.data?.messages.map((m) => (
              <div key={m.id} className="ds-card" style={{ padding: 'var(--space-3)', background: m.authorType === 'human' ? 'var(--surface-2)' : undefined }}>
                <span className="ds-eyebrow">
                  {m.authorType === 'human' ? 'Você' : 'Assistente'} · {fmtDateTime(m.createdAt)}
                  {!!m.data?.toolCalls?.length && ` · consultou: ${[...new Set(m.data.toolCalls)].map((t) => TOOL_LABELS[t] ?? t).join(', ')}`}
                </span>
                <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{m.content}</p>
              </div>
            ))}
            {busy && <p className="ds-stat-hint">Consultando dados e respondendo…</p>}
            {thread.data?.lastRun && ['failed', 'blocked'].includes(thread.data.lastRun.status) && <Alert tone="warn">Não foi possível responder: {thread.data.lastRun.error}</Alert>}
            <div ref={end} />
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <form className="ds-stack" style={{ gap: 8 }} onSubmit={send}>
            <Textarea label="Pergunta" required maxLength={8000} value={content} onChange={(e) => setContent(e.target.value)} />
            <div>
              <Button type="submit" variant="primary" disabled={busy || pending}>
                Enviar
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
