'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  DEMAND_TYPE_LABELS,
  DEMAND_TYPES,
  RISK_LABELS,
  WORKFLOW_TRIGGER_LABELS,
  WORKFLOW_TRIGGERS,
  WORKFLOW_VARIABLES,
  type RiskLevel,
  type WorkflowTrigger,
} from '@aimos/shared';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { riskTone } from '@/lib/labels';
import { ClientPicker, useClientOptions } from '@/components/client-picker';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, Textarea } from '@/design-system/components';

interface Rule {
  id: string;
  tenantId: string;
  clientName: string;
  name: string;
  trigger: WorkflowTrigger;
  conditions: { demandTypes?: string[] };
  tool: string;
  params: Record<string, unknown>;
  enabled: boolean;
  runs: number;
  lastRunAt: string | null;
}
interface Tool {
  name: string;
  title: string;
  risk: RiskLevel;
  connector: string;
  approval: 'always' | 'when_agent' | 'never';
}
interface Run {
  id: string;
  status: 'requested' | 'rejected';
  error: string | null;
  createdAt: string;
  toolCallStatus: string | null;
}

/** Modelos prontos de parâmetros por ferramenta (editáveis). */
const TEMPLATES: Record<string, Record<string, unknown>> = {
  'internal.create_task': { title: 'Programar publicação: {{deliverableTitle}}', demandId: '{{demandId}}' },
  'internal.schedule_event': { title: 'Revisão: {{demandTitle}}', kind: 'task', startsAt: '2030-01-01T12:00:00-03:00' },
  'email.send_to_client': { subject: 'Recebemos sua aprovação', message: 'Obrigado por aprovar "{{deliverableTitle}}". Seguimos com os próximos passos.' },
  'webhook.trigger': { event: 'demanda.entregue', data: { demandId: '{{demandId}}', titulo: '{{demandTitle}}' } },
  'wordpress.create_draft': { deliverableId: '{{deliverableId}}' },
  'wordpress.publish_post': { deliverableId: '{{deliverableId}}' },
};

function RuleRow({ r, tool, onChange }: { r: Rule; tool: Tool | undefined; onChange: (t: string, tone?: 'ok' | 'danger') => void }) {
  const [open, setOpen] = useState(false);
  const runs = useApi<{ items: Run[] }>(open ? `/workflows/${r.id}/runs` : null);
  const toggle = async () => {
    try {
      await api(`/workflows/${r.id}`, {
        method: 'PUT',
        body: { name: r.name, trigger: r.trigger, demandTypes: r.conditions.demandTypes ?? [], tool: r.tool, params: r.params, enabled: !r.enabled },
      });
      onChange(r.enabled ? 'Workflow pausado.' : 'Workflow ligado.');
    } catch (err) {
      onChange(err instanceof ApiError ? err.message : 'Falha.', 'danger');
    }
  };
  const remove = async () => {
    if (!confirm(`Excluir o workflow "${r.name}"?`)) return;
    await api(`/workflows/${r.id}`, { method: 'DELETE' });
    onChange('Workflow excluído.');
  };
  return (
    <li style={{ alignItems: 'flex-start' }}>
      <span className="ds-stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
        <span className="ds-row" style={{ gap: 6 }}>
          <strong>{r.name}</strong>
          {!r.enabled && <Badge>pausado</Badge>}
          {tool && <Badge tone={riskTone[tool.risk]}>Risco {RISK_LABELS[tool.risk].toLowerCase()}</Badge>}
        </span>
        <span className="ds-text-2" style={{ fontSize: 14 }}>
          Quando: {WORKFLOW_TRIGGER_LABELS[r.trigger]}
          {r.conditions.demandTypes?.length ? ` (${r.conditions.demandTypes.map((t) => DEMAND_TYPE_LABELS[t as keyof typeof DEMAND_TYPE_LABELS] ?? t).join(', ')})` : ''} → {tool?.title ?? r.tool}
        </span>
        <span className="ds-stat-hint">
          {r.clientName} · {r.runs} disparo(s){r.lastRunAt ? ` · último ${fmtDateTime(r.lastRunAt)}` : ''}
          {tool && tool.approval !== 'never' && ' · cada disparo espera aprovação humana'}
        </span>
        <button type="button" className="ds-stat-hint" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline' }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Ocultar detalhes' : 'Ver parâmetros e histórico'}
        </button>
        {open && (
          <>
            <pre className="ds-mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: 0, background: 'var(--surface-2)', padding: 8, borderRadius: 8 }}>{JSON.stringify(r.params, null, 2)}</pre>
            {runs.data?.items.length ? (
              <ul className="ds-list">
                {runs.data.items.map((x) => (
                  <li key={x.id}>
                    <span className="ds-stat-hint">
                      {fmtDateTime(x.createdAt)} · {x.status === 'rejected' ? `recusado pela política: ${x.error}` : `pedido ao Hub${x.toolCallStatus ? ` (${x.toolCallStatus})` : ''}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="ds-stat-hint">Ainda não disparou.</span>
            )}
          </>
        )}
      </span>
      <span className="ds-stack" style={{ gap: 6 }}>
        <Button size="sm" onClick={() => void toggle()}>
          {r.enabled ? 'Pausar' : 'Ligar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void remove()}>
          Excluir
        </Button>
      </span>
    </li>
  );
}

function NewRule({ tools, onCreated }: { tools: Tool[]; onCreated: (t: string, tone?: 'ok' | 'danger') => void }) {
  const { options } = useClientOptions();
  const [tenantId, setTenantId] = useState('');
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<WorkflowTrigger>('approval.approved');
  const [tool, setTool] = useState('internal.create_task');
  const [types, setTypes] = useState<string[]>([]);
  const [params, setParams] = useState(JSON.stringify(TEMPLATES['internal.create_task'], null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!tenantId && options[0]) setTenantId(options[0].tenantId);
  }, [options, tenantId]);
  const pickTool = (t: string) => {
    setTool(t);
    setParams(JSON.stringify(TEMPLATES[t] ?? {}, null, 2));
  };
  const selected = tools.find((t) => t.name === tool);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(params);
    } catch {
      return setError('Parâmetros: JSON inválido.');
    }
    try {
      await api('/workflows', { method: 'POST', body: { name, trigger, demandTypes: types, tool, params: parsed, enabled: true }, tenantId: tenantId || null });
      setName('');
      onCreated('Workflow criado.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar.');
    }
  }

  return (
    <Card title="Novo workflow">
      <form className="ds-stack" style={{ gap: 'var(--space-3)' }} onSubmit={submit}>
        {error && <Alert tone="danger">{error}</Alert>}
        <ClientPicker value={tenantId} onChange={setTenantId} />
        <Input label="Nome" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Publicar post aprovado" />
        <Select label="Quando" value={trigger} onChange={(e) => setTrigger(e.target.value as WorkflowTrigger)} options={WORKFLOW_TRIGGERS.map((t) => ({ value: t, label: WORKFLOW_TRIGGER_LABELS[t] }))} />
        <fieldset className="ds-stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
          <legend className="ds-eyebrow">Só para estes tipos de demanda (opcional)</legend>
          <div className="ds-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {DEMAND_TYPES.map((t) => (
              <label key={t} className="ds-check">
                <input type="checkbox" checked={types.includes(t)} onChange={() => setTypes((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]))} /> {DEMAND_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <Select label="Fazer" value={tool} onChange={(e) => pickTool(e.target.value)} options={tools.map((t) => ({ value: t.name, label: `${t.title} (risco ${RISK_LABELS[t.risk].toLowerCase()})` }))} />
        {selected && selected.approval !== 'never' && <Alert tone="warn">Risco {RISK_LABELS[selected.risk].toLowerCase()}: cada disparo fica em "Ações das ferramentas" aguardando aprovação humana.</Alert>}
        <Textarea label="Parâmetros (JSON)" value={params} onChange={(e) => setParams(e.target.value)} rows={6} className="ds-mono" />
        <span className="ds-stat-hint">
          Marcadores disponíveis: {WORKFLOW_VARIABLES[trigger].map((v) => `{{${v}}}`).join(' ')}
        </span>
        <div>
          <Button type="submit" variant="primary">
            Criar workflow
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function WorkflowsPage() {
  const [tenantId, setTenantId] = useState('');
  const list = useApi<{ items: Rule[] }>('/workflows', { tenantId });
  const catalog = useApi<{ tools: Tool[]; connectors: { key: string; availability: string }[] }>('/mcp/catalog');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const available = (catalog.data?.tools ?? []).filter((t) => catalog.data?.connectors.find((c) => c.key === t.connector)?.availability === 'available');
  const changed = async (text: string, tone: 'ok' | 'danger' = 'ok') => {
    setMsg({ tone, text });
    await list.reload();
  };

  return (
    <>
      <PageHeader eyebrow="Automação" title="Workflows" actions={<Link href="/tool-calls">Ações das ferramentas</Link>} />
      <p className="ds-text-2">“Quando X acontecer, faça Y.” Cada disparo vira um pedido ao MCP Hub, com as mesmas regras de sempre: risco médio e alto esperam aprovação humana, e a integração precisa estar conectada no cliente.</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="ds-grid ds-split" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <Card title="Workflows">
          <ClientPicker value={tenantId} onChange={setTenantId} allowAll />
          {list.error && <Alert tone="danger">{list.error.message}</Alert>}
          {!list.data ? (
            <Skeleton height={200} />
          ) : list.data.items.length === 0 ? (
            <EmptyState>Nenhum workflow. Exemplo: quando o cliente aprovar um post, criar a tarefa de programar a publicação.</EmptyState>
          ) : (
            <ul className="ds-list">
              {list.data.items.map((r) => (
                <RuleRow key={`${r.id}-${r.enabled}`} r={r} tool={catalog.data?.tools.find((t) => t.name === r.tool)} onChange={(t, tone) => void changed(t, tone)} />
              ))}
            </ul>
          )}
        </Card>
        {catalog.data && <NewRule tools={available} onCreated={(t, tone) => void changed(t, tone)} />}
      </div>
    </>
  );
}
