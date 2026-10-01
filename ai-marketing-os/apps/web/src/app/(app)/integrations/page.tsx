'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AGENT_LABELS, CONNECTION_STATUS_LABELS, RISK_LABELS, type AgentKey, type RiskLevel } from '@aimos/shared';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { riskTone } from '@/lib/labels';
import { ClientPicker, useClientOptions } from '@/components/client-picker';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Skeleton } from '@/design-system/components';

interface Field {
  name: string;
  label: string;
  type: 'text' | 'url' | 'password';
  secret: boolean;
  required: boolean;
  help?: string;
}
interface Connector {
  key: string;
  name: string;
  description: string;
  availability: 'available' | 'integration_pending';
  requirements: string | null;
  builtIn: boolean;
  testable: boolean;
  fields: Field[];
  capabilities: { name: string; status: 'available' | 'unavailable'; note: string }[];
}
interface Tool {
  name: string;
  title: string;
  description: string;
  connector: string;
  risk: RiskLevel;
  allowedAgents: AgentKey[];
  enabled: boolean;
  allowSelfApproval: boolean;
  approval: 'always' | 'when_agent' | 'never';
}
interface Catalog {
  credentialsKey: 'configured' | 'missing';
  smtp: string;
  connectors: Connector[];
  tools: Tool[];
}
interface Connection {
  id: string;
  tenantId: string;
  connector: string;
  status: 'active' | 'disabled' | 'error';
  label: string | null;
  config: Record<string, string>;
  hasSecret: boolean;
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastError: string | null;
  lastSuccessAt: string | null;
}

const APPROVAL = { always: 'Sempre exige aprovação humana', when_agent: 'Exige aprovação quando um agente pede', never: 'Executa direto' } as const;

function ConnectorCard({
  c,
  tools,
  conn,
  tenantId,
  canManage,
  keyMissing,
  onChange,
}: {
  c: Connector;
  tools: Tool[];
  conn: Connection | undefined;
  tenantId: string;
  canManage: boolean;
  keyMissing: boolean;
  onChange: (text: string, tone?: 'ok' | 'danger' | 'warn') => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(!conn);
  useEffect(() => {
    setValues(Object.fromEntries(c.fields.filter((f) => !f.secret).map((f) => [f.name, conn?.config[f.name] ?? ''])));
    setEditing(!conn);
  }, [conn, c.fields]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      const r = (await fn()) as { ok?: boolean; message?: string } | undefined;
      if (r && typeof r.ok === 'boolean') onChange(r.message ?? '', r.ok ? 'ok' : 'danger');
      else onChange(ok);
    } catch (err) {
      onChange(err instanceof ApiError ? err.message : 'Falha.', 'danger');
    }
  };
  const save = () =>
    run(async () => {
      const config = Object.fromEntries(c.fields.filter((f) => !f.secret).map((f) => [f.name, values[f.name] ?? '']));
      const secrets = Object.fromEntries(c.fields.filter((f) => f.secret && values[f.name]).map((f) => [f.name, values[f.name]!]));
      await api(`/mcp/connections/${tenantId}/${c.key}`, { method: 'PUT', body: { config, ...(Object.keys(secrets).length ? { secrets } : {}) } });
      setValues((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !c.fields.find((f) => f.name === k)?.secret)));
    }, `${c.name} conectado.`);

  const status = c.builtIn ? (
    <Badge tone="ok">Sempre disponível</Badge>
  ) : c.availability === 'integration_pending' ? (
    <Badge tone="warn">Integration pending</Badge>
  ) : conn ? (
    <Badge tone={conn.status === 'active' ? 'ok' : conn.status === 'error' ? 'danger' : 'neutral'}>{CONNECTION_STATUS_LABELS[conn.status]}</Badge>
  ) : (
    <Badge>Não conectado</Badge>
  );

  return (
    <Card title={c.name} action={status}>
      <p className="ds-text-2" style={{ margin: 0 }}>{c.description}</p>
      {c.requirements && <p className="ds-stat-hint" style={{ margin: 0 }}>{c.availability === 'integration_pending' ? `Para ativar: ${c.requirements}` : c.requirements}</p>}
      {c.capabilities?.length > 0 && (
        <ul className="ds-caps" aria-label={`Capacidades de ${c.name}`}>
          {c.capabilities.map((cap) => (
            <li key={cap.name}>
              <Badge tone={cap.status === 'available' ? 'ok' : 'neutral'}>{cap.status === 'available' ? 'Disponível' : 'Indisponível'}</Badge>
              <span>
                {cap.name}
                <span className="ds-stat-hint" style={{ display: 'block' }}>{cap.note}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {conn?.lastError && <Alert tone="warn">Último erro: {conn.lastError}</Alert>}
      {conn?.circuitOpenUntil && new Date(conn.circuitOpenUntil) > new Date() && <Alert tone="danger">Pausada após falhas seguidas até {fmtDateTime(conn.circuitOpenUntil)} — novas chamadas aguardam.</Alert>}
      {conn?.lastSuccessAt && <span className="ds-stat-hint">Último sucesso: {fmtDateTime(conn.lastSuccessAt)}</span>}

      {canManage && c.availability === 'available' && !c.builtIn && (
        <>
          {editing || !conn ? (
            <div className="ds-stack" style={{ gap: 8 }}>
              {c.fields.map((f) => (
                <Input
                  key={f.name}
                  label={f.label}
                  type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                  autoComplete={f.secret ? 'new-password' : 'off'}
                  placeholder={f.secret && conn?.hasSecret ? '•••••• (mantém o atual se vazio)' : undefined}
                  hint={f.help}
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              ))}
              {keyMissing && c.fields.some((f) => f.secret) && <Alert tone="warn">Defina CREDENTIALS_KEY no servidor para salvar credenciais.</Alert>}
              <div className="ds-row">
                <Button variant="primary" onClick={() => void save()}>
                  {conn ? 'Salvar' : 'Conectar'}
                </Button>
                {conn && (
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="ds-row" style={{ flexWrap: 'wrap' }}>
              <Button size="sm" onClick={() => setEditing(true)}>
                Editar
              </Button>
              {c.testable && (
                <Button size="sm" onClick={() => void run(() => api(`/mcp/connections/${conn.id}/test`, { method: 'POST', body: {} }), '')}>
                  Testar conexão
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/mcp/connections/${conn.id}/status`, { method: 'PATCH', body: { status: conn.status === 'disabled' ? 'active' : 'disabled' } }), conn.status === 'disabled' ? 'Integração religada.' : 'Integração desligada.')}>
                {conn.status === 'disabled' ? 'Religar' : 'Desligar'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => confirm(`Remover ${c.name} deste cliente? Chamadas pendentes serão canceladas.`) && void run(() => api(`/mcp/connections/${conn.id}`, { method: 'DELETE' }), 'Integração removida.')}>
                Remover
              </Button>
            </div>
          )}
        </>
      )}

      {tools.length > 0 && (
        <ul className="ds-list">
          {tools.map((t) => (
            <li key={t.name} style={{ alignItems: 'flex-start' }}>
              <span className="ds-stack" style={{ gap: 2 }}>
                <span>
                  {t.title} {!t.enabled && <Badge>desligada</Badge>}
                </span>
                <span className="ds-stat-hint">
                  {APPROVAL[t.approval]}
                  {t.allowedAgents.length > 0 && ` · agentes: ${t.allowedAgents.map((a) => AGENT_LABELS[a]).join(', ')}`}
                </span>
              </span>
              <Badge tone={riskTone[t.risk]}>Risco {RISK_LABELS[t.risk].toLowerCase()}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Policies({ tools, onChange }: { tools: Tool[]; onChange: (t: string, tone?: 'ok' | 'danger') => void }) {
  const set = async (t: Tool, patch: Partial<Pick<Tool, 'enabled' | 'allowSelfApproval'>>) => {
    try {
      await api(`/mcp/policies/${t.name}`, { method: 'PUT', body: { enabled: patch.enabled ?? t.enabled, allowSelfApproval: patch.allowSelfApproval ?? t.allowSelfApproval } });
      onChange('Política atualizada.');
    } catch (err) {
      onChange(err instanceof ApiError ? err.message : 'Falha.', 'danger');
    }
  };
  return (
    <Card title="Políticas das ferramentas (todos os clientes)">
      <p className="ds-stat-hint">Risco alto sempre passa por aprovação humana — isso não pode ser desligado. Aqui você liga/desliga ferramentas e decide se quem pediu pode aprovar o próprio pedido.</p>
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead>
            <tr>
              <th scope="col">Ferramenta</th>
              <th scope="col">Risco</th>
              <th scope="col">Ligada</th>
              <th scope="col">Quem pediu pode aprovar</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name}>
                <td>{t.title}</td>
                <td>
                  <Badge tone={riskTone[t.risk]}>{RISK_LABELS[t.risk]}</Badge>
                </td>
                <td>
                  <label className="ds-check" style={{ minHeight: 0 }}>
                    <input type="checkbox" checked={t.enabled} onChange={(e) => void set(t, { enabled: e.target.checked })} /> {t.enabled ? 'Sim' : 'Não'}
                  </label>
                </td>
                <td>
                  <label className="ds-check" style={{ minHeight: 0 }}>
                    <input type="checkbox" disabled={t.approval === 'never'} checked={t.allowSelfApproval} onChange={(e) => void set(t, { allowSelfApproval: e.target.checked })} />{' '}
                    {t.approval === 'never' ? '—' : t.allowSelfApproval ? 'Sim (segundo passo explícito)' : 'Não (outra pessoa)'}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function IntegrationsPage() {
  const { can, me } = useAuth();
  const { options } = useClientOptions();
  const [tenantId, setTenantId] = useState('');
  useEffect(() => {
    if (!tenantId && options[0]) setTenantId(options[0].tenantId);
  }, [options, tenantId]);
  const catalog = useApi<Catalog>('/mcp/catalog');
  const conns = useApi<{ items: Connection[] }>(tenantId ? '/mcp/connections' : null, { tenantId });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);
  const canManage = can('mcp:manage');
  const globalManage = !!me?.user.globalRole && canManage;

  const changed = async (text: string, tone: 'ok' | 'danger' | 'warn' = 'ok') => {
    if (text) setMsg({ tone, text });
    await Promise.all([conns.reload(), catalog.reload()]);
  };

  return (
    <>
      <PageHeader eyebrow="MCP Hub" title="Integrações" actions={<Link href="/tool-calls">Ações das ferramentas</Link>} />
      <p className="ds-text-2">
        Agentes e pessoas nunca falam direto com serviços externos: tudo passa pelo Hub, que confere a conexão do cliente, a permissão, o risco e — quando preciso — espera uma aprovação humana. Credenciais ficam cifradas.
      </p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {catalog.data?.credentialsKey === 'missing' && <Alert tone="warn">CREDENTIALS_KEY não configurada no servidor: integrações com senha não podem ser salvas.</Alert>}
      <div className="ds-row" style={{ alignItems: 'flex-end' }}>
        <ClientPicker value={tenantId} onChange={setTenantId} />
      </div>
      {catalog.error && <Alert tone="danger">{catalog.error.message}</Alert>}
      {!catalog.data || (tenantId && !conns.data) ? (
        <Skeleton height={300} />
      ) : !tenantId ? (
        <EmptyState>Selecione um cliente.</EmptyState>
      ) : (
        <div className="ds-grid ds-grid-2">
          {catalog.data.connectors.map((c) => (
            <ConnectorCard
              key={`${tenantId}-${c.key}`}
              c={c}
              tools={catalog.data!.tools.filter((t) => t.connector === c.key)}
              conn={conns.data?.items.find((x) => x.connector === c.key)}
              tenantId={tenantId}
              canManage={canManage}
              keyMissing={catalog.data!.credentialsKey === 'missing'}
              onChange={(t, tone) => void changed(t, tone)}
            />
          ))}
        </div>
      )}
      {globalManage && catalog.data && <Policies tools={catalog.data.tools} onChange={(t, tone) => void changed(t, tone)} />}
    </>
  );
}
