'use client';

import { useEffect, useState } from 'react';
import { AGENT_LABELS, type AgentKey } from '@aimos/shared';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { usd } from '@/lib/labels';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Skeleton } from '@/design-system/components';

interface Row {
  tenantId: string;
  clientName: string;
  enabled: boolean;
  monthlyBudgetUsdMicros: number | null;
  autoPlanDemands: boolean;
  spentUsdMicros: number;
}
interface Settings {
  items: Row[];
  usdBrlRate: number | null;
  status: { llm: string; model: string; serverFallback: boolean; embeddings: string };
}
interface UsageRow {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
}
interface Usage {
  month: string;
  byClient: UsageRow[];
  byAgent: UsageRow[];
  byModel: UsageRow[];
  byPurpose: UsageRow[];
}

const PURPOSE: Record<string, string> = {
  'demand.plan': 'Plano de demanda',
  'demand.produce': 'Produção',
  'demand.revise': 'Revisão após QA',
  'demand.qa': 'QA',
  'room.reply': 'Agent Room',
  'room.summary': 'Ata de reunião',
  'chat.global': 'Chat Global',
};

function ClientRow({ r, onSaved }: { r: Row; onSaved: (text: string, tone?: 'ok' | 'danger') => void }) {
  const [enabled, setEnabled] = useState(r.enabled);
  const [auto, setAuto] = useState(r.autoPlanDemands);
  const [budget, setBudget] = useState(r.monthlyBudgetUsdMicros === null ? '' : String(r.monthlyBudgetUsdMicros / 1_000_000));
  const pct = r.monthlyBudgetUsdMicros ? Math.round((r.spentUsdMicros / r.monthlyBudgetUsdMicros) * 100) : null;
  const save = async () => {
    const value = budget.trim() === '' ? null : Number(budget.replace(',', '.'));
    if (value !== null && (!Number.isFinite(value) || value < 0)) return onSaved('Orçamento inválido.', 'danger');
    try {
      await api(`/ai/settings/${r.tenantId}`, { method: 'PUT', body: { enabled, monthlyBudgetUsd: value, autoPlanDemands: auto } });
      onSaved(`${r.clientName}: configurações salvas.`);
    } catch (err) {
      onSaved(err instanceof ApiError ? err.message : 'Falha ao salvar.', 'danger');
    }
  };
  return (
    <tr>
      <td>{r.clientName}</td>
      <td>
        <label className="ds-check" style={{ minHeight: 0 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {enabled ? 'Ligada' : 'Desligada'}
        </label>
      </td>
      <td>
        <label className="ds-check" style={{ minHeight: 0 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> {auto ? 'Sim' : 'Não'}
        </label>
      </td>
      <td>
        <Input label="US$ / mês" aria-label={`Orçamento mensal de ${r.clientName} em dólares`} inputMode="decimal" placeholder="sem limite" value={budget} onChange={(e) => setBudget(e.target.value)} style={{ maxWidth: 120 }} />
      </td>
      <td className="ds-num">
        {usd(r.spentUsdMicros)}
        {pct !== null && (
          <div>
            <Badge tone={pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok'}>{pct}%</Badge>
          </div>
        )}
      </td>
      <td>
        <Button size="sm" onClick={() => void save()}>
          Salvar
        </Button>
      </td>
    </tr>
  );
}

function UsageTable({ title, rows, label }: { title: string; rows: UsageRow[]; label: (k: string) => string }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <EmptyState>Sem consumo no mês.</EmptyState>
      ) : (
        <ul className="ds-list">
          {rows.map((r) => (
            <li key={r.key}>
              <span>
                {label(r.key)}
                <div className="ds-stat-hint">
                  {r.calls} chamadas · {Math.round(r.inputTokens).toLocaleString('pt-BR')} tokens entrada · {Math.round(r.outputTokens).toLocaleString('pt-BR')} saída
                </div>
              </span>
              <span className="ds-num">{usd(r.costUsdMicros, 4)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AiSettingsPage() {
  const { can } = useAuth();
  const settings = useApi<Settings>('/ai/settings');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const usage = useApi<Usage>(`/ai/usage?month=${month}`);
  const [rate, setRate] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  useEffect(() => {
    if (settings.data?.usdBrlRate) setRate(String(settings.data.usdBrlRate));
  }, [settings.data?.usdBrlRate]);

  const saveRate = async () => {
    try {
      await api('/ai/usd-rate', { method: 'PUT', body: { usdBrlRate: Number(rate.replace(',', '.')) } });
      setMsg({ tone: 'ok', text: 'Cotação salva: a rentabilidade usa este valor para o custo de IA.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha.' });
    }
  };
  const done = async (text: string, tone: 'ok' | 'danger' = 'ok') => {
    setMsg({ tone, text });
    if (tone === 'ok') await settings.reload();
  };
  const total = (usage.data?.byClient ?? []).reduce((a, r) => a + r.costUsdMicros, 0);

  return (
    <>
      <PageHeader eyebrow="Inteligência" title="Orçamento e consumo de IA" />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {settings.error && <Alert tone="danger">{settings.error.message}</Alert>}
      {settings.data && (
        <div className="ds-row" style={{ flexWrap: 'wrap' }}>
          <Badge tone={settings.data.status.llm === 'configured' ? 'ok' : 'warn'}>{settings.data.status.llm === 'configured' ? `Modelo: ${settings.data.status.model}` : 'IA: integration pending'}</Badge>
          {settings.data.status.serverFallback && <Badge tone="info">fallback do servidor ligado</Badge>}
        </div>
      )}

      <Card title="Por cliente">
        <p className="ds-stat-hint">Orçamento atingido bloqueia novas execuções do cliente no mês (nada é cobrado a mais). Auto-plano: o Orchestrator monta o plano assim que o cliente abre uma demanda.</p>
        {!settings.data ? (
          <Skeleton height={200} />
        ) : settings.data.items.length === 0 ? (
          <EmptyState>Nenhum cliente.</EmptyState>
        ) : (
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">Cliente</th>
                  <th scope="col">IA</th>
                  <th scope="col">Auto-plano</th>
                  <th scope="col">Orçamento mensal</th>
                  <th scope="col">Gasto no mês</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {settings.data.items.map((r) => (
                  <ClientRow key={r.tenantId} r={r} onSaved={(t, tone) => void done(t, tone)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {settings.data?.usdBrlRate !== null && can('ai:settings') && (
        <Card title="Cotação para a rentabilidade">
          <div className="ds-row" style={{ alignItems: 'flex-end' }}>
            <Input label="R$ por US$ 1" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} style={{ maxWidth: 140 }} />
            <Button onClick={() => void saveRate()}>Salvar cotação</Button>
          </div>
        </Card>
      )}

      <div className="ds-row" style={{ alignItems: 'flex-end' }}>
        <Input label="Mês" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 180 }} />
        <span className="ds-stat-hint">Total no mês: {usd(total, 4)}</span>
      </div>
      {usage.error && <Alert tone="danger">{usage.error.message}</Alert>}
      {usage.data && (
        <div className="ds-grid ds-grid-2">
          <UsageTable title="Por cliente" rows={usage.data.byClient} label={(k) => k} />
          <UsageTable title="Por agente" rows={usage.data.byAgent} label={(k) => AGENT_LABELS[k as AgentKey] ?? k} />
          <UsageTable title="Por finalidade" rows={usage.data.byPurpose} label={(k) => PURPOSE[k] ?? k} />
          <UsageTable title="Por modelo" rows={usage.data.byModel} label={(k) => k} />
        </div>
      )}
    </>
  );
}
