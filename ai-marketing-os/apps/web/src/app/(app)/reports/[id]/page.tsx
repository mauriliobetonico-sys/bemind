'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { REPORT_SECTION_LABELS, REPORT_SECTIONS, type ReportSection } from '@aimos/shared';
import { api, ApiError, fmtDate, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, PageHeader, Skeleton } from '@/design-system/components';

interface Report {
  id: string;
  clientName: string;
  date: string;
  intro: string;
  generator: 'template' | 'ai';
  hasActivity: boolean;
  emailedTo: number;
  emailedAt: string | null;
  sections: Record<ReportSection, string[]>;
}

const EMPTY: Record<ReportSection, string> = {
  doneToday: 'Sem novas movimentações hoje.',
  inProgress: 'Nada em andamento.',
  completed: 'Nenhuma conclusão hoje.',
  needsApproval: 'Nada aguardando você. 👍',
  nextSteps: 'Sem compromissos nos próximos 7 dias.',
  notes: '',
};

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, me } = useAuth();
  const r = useApi<Report>(`/reports/${id}`);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  if (r.error) return <Alert tone="danger">{r.error.status === 404 ? 'Relatório não encontrado.' : r.error.message}</Alert>;
  if (!r.data) return <Skeleton height={400} />;
  const d = r.data;

  const resend = async () => {
    try {
      await api(`/reports/${id}/send`, { method: 'POST', body: {} });
      setMsg({ tone: 'ok', text: 'Reenvio na fila para os usuários do cliente.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha.' });
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/reports">Relatórios</Link>
            {me?.isStaff ? ` · ${d.clientName}` : ''}
          </>
        }
        title={`Relatório de ${fmtDate(d.date)}`}
        actions={
          can('reports:manage') ? (
            <Button size="sm" onClick={() => void resend()}>
              Reenviar por e-mail
            </Button>
          ) : undefined
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6 }}>{d.intro}</p>
        {me?.isStaff && (
          <span className="ds-stat-hint">
            {d.generator === 'ai' ? 'Abertura escrita pelo agente Customer Success a partir dos fatos do dia. ' : ''}
            {d.emailedAt ? (d.emailedTo > 0 ? `Enviado a ${d.emailedTo} pessoa(s) em ${fmtDateTime(d.emailedAt)}.` : 'Sem destinatários: o cliente ainda não tem usuários ativos no portal.') : 'Ainda não enviado por e-mail.'}
          </span>
        )}
      </Card>
      <div className="ds-grid ds-grid-2">
        {REPORT_SECTIONS.filter((k) => k !== 'notes' || d.sections.notes?.length).map((k) => (
          <Card key={k} title={REPORT_SECTION_LABELS[k]} action={k === 'needsApproval' && d.sections.needsApproval.length ? <Badge tone="warn">{d.sections.needsApproval.length}</Badge> : undefined}>
            {d.sections[k]?.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {d.sections[k].map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="ds-stat-hint" style={{ margin: 0 }}>{EMPTY[k]}</p>
            )}
            {k === 'needsApproval' && d.sections.needsApproval.length > 0 && !me?.isStaff && <Link href="/approvals">Revisar agora</Link>}
          </Card>
        ))}
      </div>
    </>
  );
}
