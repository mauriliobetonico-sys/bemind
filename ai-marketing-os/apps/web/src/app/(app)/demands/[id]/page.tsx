'use client';

import { use, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  DELIVERABLE_STATUS_LABELS,
  DEMAND_STATUS_LABELS,
  DEMAND_TYPE_LABELS,
  PRIORITY_LABELS,
  type DemandStatus,
} from '@aimos/shared';
import { api, ApiError, fmtDate } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { deliverableTone, demandTone, eventLabel, priorityTone } from '@/lib/labels';
import { FileDrop } from '@/components/file-drop';
import { AiPanel } from '@/components/ai-panel';
import { DeliverableTools } from '@/components/deliverable-tools';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, Textarea, Timeline } from '@/design-system/components';

interface Approval {
  id: string;
  status: string;
  message: string | null;
  reason: string | null;
  version: number;
  decidedByName: string | null;
}
interface Deliverable {
  id: string;
  title: string;
  description: string | null;
  fileId: string | null;
  fileName: string | null;
  fileMime: string | null;
  version: number;
  status: keyof typeof DELIVERABLE_STATUS_LABELS;
  qaNotes: string | null;
  agentRunId?: string | null;
  aiReview?: { approved: boolean; score: number; summary: string; issues: { severity: string; item: string; reason: string }[] } | null;
  lastApproval: Approval | null;
}
interface Briefing {
  version: number;
  objective: string;
  audience: string | null;
  keyMessages: string | null;
  deliverables: string | null;
  tone: string | null;
  constraints: string | null;
  authorName: string | null;
  createdAt: string;
}
interface Demand {
  id: string;
  tenantId: string;
  clientName: string;
  type: keyof typeof DEMAND_TYPE_LABELS;
  title: string;
  description: string;
  priority: keyof typeof PRIORITY_LABELS;
  dueDate: string | null;
  refs: string | null;
  notes: string | null;
  status: DemandStatus;
  overdue: boolean;
  requestedByName: string | null;
  createdAt: string;
  briefing: Briefing | null;
  deliverables: Deliverable[];
  activity: { id: string; type: string; createdAt: string; actorName: string | null; data: { reason?: string; notes?: string } }[];
  tasks: { total: number; done: number } | null;
  canManage: boolean;
  allowedTransitions: DemandStatus[];
}
interface FileItem {
  id: string;
  name: string;
  visibility: string;
  scanStatus: string;
}

export default function DemandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const demand = useApi<Demand>(`/demands/${id}`);
  const files = useApi<{ items: FileItem[] }>(`/files?demandId=${id}`);
  const { can } = useAuth();
  // Integrações do cliente (para as ações do entregável). Só a equipe com mcp:read.
  const conns = useApi<{ items: { connector: string; status: string }[] }>(demand.data?.canManage && can('mcp:read') ? '/mcp/connections' : null, { tenantId: demand.data?.tenantId });
  const wordpress = !!conns.data?.items.some((c) => c.connector === 'wordpress' && c.status !== 'disabled');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  if (demand.error) {
    return (
      <>
        <PageHeader title="Demanda" />
        <Alert tone="danger">{demand.error.status === 404 ? 'Demanda não encontrada.' : demand.error.message}</Alert>
        <Link href="/demands">Voltar</Link>
      </>
    );
  }
  if (!demand.data) return <Skeleton height={360} />;
  const d = demand.data;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'ok', text: ok });
      await Promise.all([demand.reload(), files.reload()]);
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha na operação.' });
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/demands">Demandas</Link> · {d.clientName}
          </>
        }
        title={d.title}
        actions={
          <>
            <Badge tone={priorityTone[d.priority]}>{PRIORITY_LABELS[d.priority]}</Badge>
            <Badge tone={demandTone[d.status]}>{DEMAND_STATUS_LABELS[d.status]}</Badge>
          </>
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {d.canManage && d.allowedTransitions.length > 0 && (
        <div className="ds-row">
          <span className="ds-stat-hint">Mover para:</span>
          {d.allowedTransitions.map((s) => (
            <Button key={s} size="sm" variant={s === 'cancelled' ? 'ghost' : 'default'} onClick={() => void run(() => api(`/demands/${id}`, { method: 'PATCH', body: { status: s } }), `Demanda: ${DEMAND_STATUS_LABELS[s]}.`)}>
              {DEMAND_STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
      )}

      <div className="ds-grid ds-split" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <div className="ds-stack" style={{ gap: 'var(--space-4)' }}>
          <Card title="Pedido">
            <dl className="ds-dl">
              <dt>Tipo</dt>
              <dd>{DEMAND_TYPE_LABELS[d.type]}</dd>
              <dt>Prazo</dt>
              <dd style={{ color: d.overdue ? 'var(--danger-ink)' : undefined }}>
                {fmtDate(d.dueDate)}
                {d.overdue && ' · atrasada'}
              </dd>
              <dt>Solicitado por</dt>
              <dd>
                {d.requestedByName ?? '—'} em {fmtDate(d.createdAt)}
              </dd>
              <dt>Descrição</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{d.description}</dd>
              {d.refs && (
                <>
                  <dt>Referências</dt>
                  <dd style={{ whiteSpace: 'pre-wrap' }}>{d.refs}</dd>
                </>
              )}
              {d.notes && (
                <>
                  <dt>Observações</dt>
                  <dd style={{ whiteSpace: 'pre-wrap' }}>{d.notes}</dd>
                </>
              )}
            </dl>
          </Card>

          <BriefingCard demand={d} onSaved={() => void run(async () => undefined, 'Briefing salvo.')} />

          {d.canManage && <AiPanel demandId={id} tenantId={d.tenantId} closed={['delivered', 'cancelled'].includes(d.status)} onChange={() => void demand.reload()} />}

          <Card title="Entregáveis">
            {d.deliverables.length === 0 ? (
              <EmptyState>{d.canManage ? 'Nenhum entregável ainda.' : 'Assim que a equipe tiver algo para você aprovar, aparece aqui.'}</EmptyState>
            ) : (
              <div className="ds-stack" style={{ gap: 'var(--space-3)' }}>
                {d.deliverables.map((v) => (
                  <DeliverableRow key={v.id} v={v} canManage={d.canManage} files={files.data?.items ?? []} run={run} tools={wordpress ? <DeliverableTools deliverableId={v.id} tenantId={d.tenantId} approved={v.status === 'approved'} /> : null} />
                ))}
              </div>
            )}
            {d.canManage && !['delivered', 'cancelled'].includes(d.status) && <NewDeliverable demandId={id} files={files.data?.items ?? []} run={run} />}
          </Card>

          <Card title="Arquivos da demanda">
            <FileDrop tenantId={d.tenantId} query={`?demandId=${id}${d.canManage ? '&visibility=internal' : ''}`} onUploaded={() => void files.reload()} compact />
            {d.canManage && <p className="ds-stat-hint">Arquivos enviados pela equipe aqui ficam internos até o QA liberar o entregável para o cliente.</p>}
            <ul className="ds-list">
              {(files.data?.items ?? []).map((f) => (
                <li key={f.id}>
                  <a href={`/api/files/${f.id}/download`}>{f.name}</a>
                  <span className="ds-row" style={{ gap: 6 }}>
                    {f.visibility === 'internal' && <Badge>interno</Badge>}
                    {f.scanStatus === 'pending' && <Badge tone="warn">em verificação</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="ds-stack" style={{ gap: 'var(--space-4)' }}>
          {d.tasks && (
            <Card title="Tarefas internas" action={<Link href={`/tasks?demandId=${id}`}>Abrir</Link>}>
              <p className="ds-text-2">
                {d.tasks.done} de {d.tasks.total} concluídas
              </p>
            </Card>
          )}
          <Card title="Linha do tempo">
            <Timeline
              items={d.activity.map((a) => ({
                id: a.id,
                at: a.createdAt,
                content: (
                  <>
                    {eventLabel(a.type)}
                    {(a.data.reason || a.data.notes) && <div className="ds-text-2">“{a.data.reason ?? a.data.notes}”</div>}
                    <div className="ds-stat-hint">
                      {fmtDate(a.createdAt)} · {a.actorName ?? 'Sistema'}
                    </div>
                  </>
                ),
              }))}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

function BriefingCard({ demand: d, onSaved }: { demand: Demand; onSaved: () => void }) {
  const b = d.briefing;
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({
    objective: b?.objective ?? '',
    audience: b?.audience ?? '',
    keyMessages: b?.keyMessages ?? '',
    deliverables: b?.deliverables ?? '',
    tone: b?.tone ?? '',
    constraints: b?.constraints ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/demands/${d.id}/briefing`, { method: 'PUT', body: v });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    }
  }

  if (!b && !d.canManage) return null;
  return (
    <Card
      title={b ? `Briefing · v${b.version}` : 'Briefing'}
      action={d.canManage && !editing && <Button size="sm" onClick={() => setEditing(true)}>{b ? 'Revisar' : 'Escrever briefing'}</Button>}
    >
      {editing ? (
        <form className="ds-stack" onSubmit={save}>
          {error && <Alert tone="danger">{error}</Alert>}
          <Textarea label="Objetivo" required value={v.objective} onChange={set('objective')} />
          <div className="ds-form-grid">
            <Textarea label="Público" value={v.audience} onChange={set('audience')} />
            <Textarea label="Mensagens-chave" value={v.keyMessages} onChange={set('keyMessages')} />
            <Textarea label="Entregáveis previstos" value={v.deliverables} onChange={set('deliverables')} />
            <Textarea label="Tom de voz" value={v.tone} onChange={set('tone')} />
          </div>
          <Textarea label="Restrições" value={v.constraints} onChange={set('constraints')} />
          <div className="ds-row">
            <Button type="submit" variant="primary">
              Salvar nova versão
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : b ? (
        <dl className="ds-dl">
          <dt>Objetivo</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{b.objective}</dd>
          {(
            [
              ['Público', b.audience],
              ['Mensagens-chave', b.keyMessages],
              ['Entregáveis', b.deliverables],
              ['Tom de voz', b.tone],
              ['Restrições', b.constraints],
            ] as const
          )
            .filter(([, val]) => val)
            .map(([k, val]) => (
              <Pair key={k} k={k} v={val!} />
            ))}
        </dl>
      ) : (
        <EmptyState>Sem briefing ainda.</EmptyState>
      )}
    </Card>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd style={{ whiteSpace: 'pre-wrap' }}>{v}</dd>
    </>
  );
}

function DeliverableRow({
  v,
  canManage,
  files,
  run,
  tools,
}: {
  v: Deliverable;
  canManage: boolean;
  files: FileItem[];
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  tools?: ReactNode;
}) {
  const [qaNotes, setQaNotes] = useState('');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<null | 'reject' | 'send' | 'changes'>(null);
  const pending = v.lastApproval?.status === 'pending' ? v.lastApproval : null;
  const isImage = v.fileMime?.startsWith('image/') && v.fileMime !== 'image/svg+xml';

  return (
    <div className="ds-card" style={{ background: 'var(--surface-2)', padding: 'var(--space-4)' }}>
      <div className="ds-card-header">
        <div>
          <strong>{v.title}</strong> <span className="ds-stat-hint">v{v.version}</span>{' '}
          {canManage && v.agentRunId && <Badge tone="info">rascunho da IA</Badge>}
        </div>
        <Badge tone={deliverableTone[v.status]}>{DELIVERABLE_STATUS_LABELS[v.status]}</Badge>
      </div>
      {v.description && <p className="ds-text-2" style={{ whiteSpace: 'pre-wrap' }}>{v.description}</p>}
      {v.fileId && isImage && <img className="ds-preview" src={`/api/files/${v.fileId}/download?inline=1`} alt={`Prévia de ${v.title}`} />}
      {v.fileId && (
        <a href={`/api/files/${v.fileId}/download`} style={{ fontSize: 14 }}>
          Baixar {v.fileName}
        </a>
      )}
      {canManage && v.aiReview && (
        <Alert tone={v.aiReview.approved ? 'ok' : 'warn'}>
          QA da IA ({v.aiReview.score}/100): {v.aiReview.summary}
          {v.aiReview.issues.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {v.aiReview.issues.map((i, n) => (
                <li key={n}>
                  [{i.severity}] {i.item}: {i.reason}
                </li>
              ))}
            </ul>
          )}
          <div className="ds-stat-hint">Parecer automático — o envio ao cliente continua sendo decisão da equipe.</div>
        </Alert>
      )}
      {canManage && v.qaNotes && <Alert tone="warn">QA: {v.qaNotes}</Alert>}
      {canManage && tools}
      {v.lastApproval?.status === 'changes_requested' && <Alert tone="danger">Pedido do cliente: “{v.lastApproval.reason}”</Alert>}

      {canManage && (
        <div className="ds-row">
          {(v.status === 'draft' || v.status === 'changes_requested') && (
            <>
              <Select
                label="Arquivo"
                value={v.fileId ?? ''}
                onChange={(e) => void run(() => api(`/deliverables/${v.id}`, { method: 'PATCH', body: { fileId: e.target.value || null } }), 'Arquivo atualizado.')}
                options={[{ value: '', label: 'Sem arquivo' }, ...files.map((f) => ({ value: f.id, label: f.name }))]}
              />
              <Button size="sm" onClick={() => void run(() => api(`/deliverables/${v.id}`, { method: 'PATCH', body: { action: 'submit_for_qa' } }), 'Enviado para QA.')}>
                Enviar para QA
              </Button>
            </>
          )}
          {v.status === 'internal_review' && (
            <>
              <Button size="sm" variant="primary" onClick={() => setMode('send')}>
                QA ok · enviar ao cliente
              </Button>
              <Button size="sm" onClick={() => setMode('reject')}>
                QA: devolver
              </Button>
            </>
          )}
          {(v.status === 'changes_requested' || v.status === 'approved') && (
            <Button size="sm" onClick={() => void run(() => api(`/deliverables/${v.id}`, { method: 'PATCH', body: { action: 'new_version' } }), 'Nova versão criada.')}>
              Criar nova versão
            </Button>
          )}
        </div>
      )}
      {mode === 'reject' && (
        <div className="ds-stack">
          <Textarea label="O que precisa ser corrigido" value={qaNotes} onChange={(e) => setQaNotes(e.target.value)} />
          <Button size="sm" onClick={() => void run(() => api(`/deliverables/${v.id}`, { method: 'PATCH', body: { action: 'qa_reject', qaNotes } }), 'Devolvido para correção.').then(() => setMode(null))}>
            Devolver ao produtor
          </Button>
        </div>
      )}
      {mode === 'send' && (
        <div className="ds-stack">
          <Input label="Mensagem para o cliente (opcional)" value={message} onChange={(e) => setMessage(e.target.value)} />
          <Button size="sm" variant="primary" onClick={() => void run(() => api(`/deliverables/${v.id}/request-approval`, { method: 'POST', body: { message: message || null } }), 'Aprovação solicitada. O aviso por e-mail ao cliente entrou na fila de envio.').then(() => setMode(null))}>
            Solicitar aprovação
          </Button>
        </div>
      )}

      {!canManage && pending && (
        <div className="ds-stack">
          {pending.message && <p className="ds-text-2">“{pending.message}”</p>}
          {mode === 'changes' ? (
            <>
              <Textarea label="O que você gostaria de alterar?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Gostei, mas quero trocar a foto." />
              <div className="ds-row">
                <Button variant="primary" disabled={!reason.trim()} onClick={() => void run(() => api(`/approvals/${pending.id}/decide`, { method: 'POST', body: { decision: 'changes_requested', reason } }), 'Pedido de alteração enviado à equipe.')}>
                  Enviar pedido
                </Button>
                <Button variant="ghost" onClick={() => setMode(null)}>
                  Voltar
                </Button>
              </div>
            </>
          ) : (
            <div className="ds-row">
              <Button variant="primary" onClick={() => void run(() => api(`/approvals/${pending.id}/decide`, { method: 'POST', body: { decision: 'approved' } }), 'Aprovado! A equipe será avisada.')}>
                Aprovar
              </Button>
              <Button onClick={() => setMode('changes')}>Solicitar alteração</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewDeliverable({ demandId, files, run }: { demandId: string; files: FileItem[]; run: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ title: '', description: '', fileId: '' });
  if (!open)
    return (
      <div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Novo entregável
        </Button>
      </div>
    );
  return (
    <form
      className="ds-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`/demands/${demandId}/deliverables`, { method: 'POST', body: { title: v.title, description: v.description || null, fileId: v.fileId || null } }), 'Entregável criado.').then(() => {
          setOpen(false);
          setV({ title: '', description: '', fileId: '' });
        });
      }}
    >
      <Input label="Título" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <Textarea label="Descrição / texto" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      <Select label="Arquivo" value={v.fileId} onChange={(e) => setV({ ...v, fileId: e.target.value })} options={[{ value: '', label: 'Sem arquivo' }, ...files.map((f) => ({ value: f.id, label: f.name }))]} />
      <div className="ds-row">
        <Button type="submit" variant="primary">
          Criar
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
