'use client';

import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { eventLabel, greeting, statusLabel, statusTone } from '@/lib/labels';
import Link from 'next/link';
import { Alert, Badge, Card, PageHeader, PendingModule, Skeleton, StatCard, Timeline } from '@/design-system/components';
import type { ClientStatus } from '@aimos/shared';

interface Overview {
  companies: { tenantId: string; tradeName: string }[];
  client: { tradeName: string; plan: string; status: ClientStatus; responsibleName: string; email: string };
  history: { id: string; type: string; createdAt: string }[];
  work: { approvalsPending: number; openDemands: number; inProduction: number; completed: number };
  pendingModules: { key: string; label: string; phase: number }[];
}

export default function PortalPage() {
  const { me } = useAuth();
  const { data, error } = useApi<Overview>('/portal/overview');
  const firstName = me?.user.name.split(' ')[0] ?? '';

  if (error) return <Alert tone="danger">{error.status === 403 ? 'Seu acesso está temporariamente suspenso. Fale com a agência.' : error.message}</Alert>;
  if (!data) return <Skeleton height={300} />;

  return (
    <>
      <PageHeader eyebrow={data.client.tradeName} title={`${greeting()}, ${firstName}.`} actions={<Badge tone={statusTone[data.client.status]}>{statusLabel(data.client.status)}</Badge>} />
      <p className="ds-text-2" style={{ maxWidth: 720 }}>
        Este é o espaço da {data.client.tradeName}. Tudo o que aparece aqui é exclusivo da sua empresa.
      </p>
      {data.work.approvalsPending > 0 && (
        <Alert tone="warn">
          Você tem {data.work.approvalsPending} entrega(s) aguardando sua aprovação. <Link href="/approvals">Ver agora</Link>
        </Alert>
      )}
      <div className="ds-grid ds-grid-4">
        <StatCard label="Aguardando você" value={data.work.approvalsPending} tone={data.work.approvalsPending > 0 ? 'warn' : undefined} hint="aprovações" />
        <StatCard label="Demandas em aberto" value={data.work.openDemands} />
        <StatCard label="Em produção" value={data.work.inProduction} hint="sua equipe está trabalhando" />
        <StatCard label="Concluídas" value={data.work.completed} />
      </div>
      <div className="ds-row">
        <Link className="ds-btn ds-btn-primary" href="/demands/new">
          Nova demanda
        </Link>
        <Link className="ds-btn" href="/files">
          Enviar arquivos
        </Link>
      </div>
      <div className="ds-grid" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)' }}>
        <div className="ds-stack" style={{ gap: 'var(--space-4)' }}>
          <Card title="Seu plano">
            <dl className="ds-dl">
              <dt>Plano</dt>
              <dd className="ds-mono">{data.client.plan}</dd>
              <dt>Responsável</dt>
              <dd>{data.client.responsibleName}</dd>
              <dt>E-mail de contato</dt>
              <dd>{data.client.email}</dd>
            </dl>
          </Card>
          <Card title="Sua equipe está chegando">
            <p className="ds-text-2">Estas áreas do portal serão liberadas conforme a plataforma evolui:</p>
            <div className="ds-stack" style={{ gap: 8 }}>
              {data.pendingModules.map((m) => (
                <PendingModule key={m.key} label={m.label} phase={m.phase} />
              ))}
            </div>
          </Card>
        </div>
        <Card title="Histórico">
          <Timeline items={data.history.map((h) => ({ id: h.id, at: h.createdAt, content: eventLabel(h.type) }))} />
        </Card>
      </div>
    </>
  );
}
