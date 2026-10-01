'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError, fmtDate, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { ClientPicker } from '@/components/client-picker';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '@/design-system/components';

interface Report {
  id: string;
  tenantId: string;
  clientName: string;
  date: string;
  intro: string;
  generator: 'template' | 'ai';
  hasActivity: boolean;
  emailedTo: number;
  emailedAt: string | null;
}
interface Settings {
  timezone: string;
  hour: number;
  today: string;
  items: { tenantId: string; clientName: string; status: string; dailyReportEnabled: boolean; dailyReportWeekdaysOnly: boolean }[];
}

function SettingsCard({ onQueued }: { onQueued: (text: string, tone?: 'ok' | 'danger') => void }) {
  const s = useApi<Settings>('/reports/settings');
  const save = async (tenantId: string, patch: { dailyReportEnabled: boolean; dailyReportWeekdaysOnly: boolean }) => {
    try {
      await api(`/reports/settings/${tenantId}`, { method: 'PUT', body: patch });
      await s.reload();
    } catch (err) {
      onQueued(err instanceof ApiError ? err.message : 'Falha.', 'danger');
    }
  };
  const generate = async (tenantId: string, name: string) => {
    try {
      await api('/reports/generate', { method: 'POST', body: { send: true }, tenantId });
      onQueued(`Relatório de hoje de ${name} na fila: aparece na lista em instantes e vai por e-mail aos usuários do cliente.`);
    } catch (err) {
      onQueued(err instanceof ApiError ? err.message : 'Falha.', 'danger');
    }
  };
  return (
    <Card title="Envio automático">
      {!s.data ? (
        <Skeleton height={160} />
      ) : (
        <>
          <p className="ds-stat-hint">
            Todo dia às {s.data.hour}h ({s.data.timezone}) cada cliente ativo recebe o relatório do próprio dia, por e-mail e no portal. Sem nenhuma movimentação, o relatório fica só registrado.
          </p>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">Cliente</th>
                  <th scope="col">Envio diário</th>
                  <th scope="col">Só dias úteis</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {s.data.items.map((c) => (
                  <tr key={c.tenantId}>
                    <td>{c.clientName}</td>
                    <td>
                      <label className="ds-check" style={{ minHeight: 0 }}>
                        <input type="checkbox" checked={c.dailyReportEnabled} onChange={(e) => void save(c.tenantId, { dailyReportEnabled: e.target.checked, dailyReportWeekdaysOnly: c.dailyReportWeekdaysOnly })} />{' '}
                        {c.dailyReportEnabled ? 'Ligado' : 'Desligado'}
                      </label>
                    </td>
                    <td>
                      <label className="ds-check" style={{ minHeight: 0 }}>
                        <input type="checkbox" disabled={!c.dailyReportEnabled} checked={c.dailyReportWeekdaysOnly} onChange={(e) => void save(c.tenantId, { dailyReportEnabled: c.dailyReportEnabled, dailyReportWeekdaysOnly: e.target.checked })} />{' '}
                        {c.dailyReportWeekdaysOnly ? 'Sim' : 'Todos os dias'}
                      </label>
                    </td>
                    <td>
                      <Button size="sm" onClick={() => void generate(c.tenantId, c.clientName)}>
                        Gerar e enviar hoje
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

export default function ReportsPage() {
  const { can, me } = useAuth();
  const [tenantId, setTenantId] = useState('');
  const list = useApi<{ items: Report[] }>('/reports', { tenantId });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const staff = !!me?.isStaff;

  return (
    <>
      <PageHeader eyebrow={staff ? 'Automação' : 'Sua conta'} title={staff ? 'Relatórios diários' : 'Relatórios do dia'} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card title="Relatórios" action={staff ? <Button size="sm" variant="ghost" onClick={() => void list.reload()}>Atualizar</Button> : undefined}>
        {staff && <ClientPicker value={tenantId} onChange={setTenantId} allowAll />}
        {list.error && <Alert tone="danger">{list.error.message}</Alert>}
        {!list.data ? (
          <Skeleton height={200} />
        ) : list.data.items.length === 0 ? (
          <EmptyState>{staff ? 'Nenhum relatório gerado ainda.' : 'Seu primeiro relatório do dia chega no fim da tarde de um dia útil.'}</EmptyState>
        ) : (
          <ul className="ds-list">
            {list.data.items.map((r) => (
              <li key={r.id} style={{ alignItems: 'flex-start' }}>
                <span className="ds-stack" style={{ gap: 2, minWidth: 0 }}>
                  <Link href={`/reports/${r.id}`}>
                    {staff ? `${r.clientName} · ` : ''}
                    {fmtDate(r.date)}
                  </Link>
                  <span className="ds-text-2" style={{ fontSize: 14 }}>{r.intro}</span>
                  {staff && <span className="ds-stat-hint">{r.emailedAt ? (r.emailedTo > 0 ? `Enviado a ${r.emailedTo} pessoa(s) em ${fmtDateTime(r.emailedAt)}` : 'Sem destinatários (cliente sem usuários no portal)') : 'Não enviado por e-mail'}</span>}
                </span>
                <span className="ds-row" style={{ gap: 6 }}>
                  {!r.hasActivity && <Badge>sem movimentação</Badge>}
                  {staff && r.generator === 'ai' && <Badge tone="info">texto da IA</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can('reports:manage') && <SettingsCard onQueued={(t, tone = 'ok') => setMsg({ tone, text: t })} />}
    </>
  );
}
