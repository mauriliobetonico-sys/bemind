'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import type { ClientStatus } from '@aimos/shared';
import { api, brl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { eventLabel, FIELD_LABELS, formatCnpj, statusLabel, statusTone } from '@/lib/labels';
import { Alert, Badge, Button, Card, PageHeader, PendingModule, Skeleton, Timeline } from '@/design-system/components';
import { ClientForm, emptyClient, type ClientFormValues } from '../client-form';

interface Client {
  id: string;
  tenantId: string;
  legalName: string;
  tradeName: string;
  cnpj: string | null;
  responsibleName: string;
  phone: string | null;
  email: string;
  address: Record<string, string | undefined>;
  segment: string | null;
  niche: string | null;
  plan: string;
  status: ClientStatus;
  monthlyFeeCents: number;
  startDate: string | null;
  dueDay: number | null;
  notes: string | null;
  tenantStatus: string;
  createdAt: string;
}

interface ClientEvent {
  id: string;
  type: string;
  createdAt: string;
  actorName: string | null;
  data: { changes?: Record<string, unknown> };
}

function toForm(c: Client): ClientFormValues {
  return {
    ...emptyClient,
    legalName: c.legalName,
    tradeName: c.tradeName,
    cnpj: c.cnpj ?? '',
    responsibleName: c.responsibleName,
    phone: c.phone ?? '',
    email: c.email,
    segment: c.segment ?? '',
    niche: c.niche ?? '',
    plan: c.plan,
    status: c.status,
    monthlyFee: (c.monthlyFeeCents / 100).toFixed(2).replace('.', ','),
    startDate: c.startDate ?? '',
    dueDay: c.dueDay ? String(c.dueDay) : '',
    notes: c.notes ?? '',
    street: c.address.street ?? '',
    number: c.address.number ?? '',
    complement: c.address.complement ?? '',
    district: c.address.district ?? '',
    city: c.address.city ?? '',
    state: c.address.state ?? '',
    zip: c.address.zip ?? '',
  };
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const client = useApi<Client>(`/clients/${id}`);
  const events = useApi<{ items: ClientEvent[] }>(`/clients/${id}/events`);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tenantMsg, setTenantMsg] = useState<string | null>(null);

  if (client.error) {
    return (
      <>
        <PageHeader title="Cliente" />
        <Alert tone="danger">{client.error.status === 404 ? 'Cliente não encontrado.' : client.error.message}</Alert>
        <Link href="/clients">Voltar para clientes</Link>
      </>
    );
  }
  if (!client.data) return <Skeleton height={320} />;
  const c = client.data;
  const address = [c.address.street, c.address.number, c.address.complement, c.address.district, c.address.city, c.address.state, c.address.zip].filter(Boolean).join(', ');

  async function setTenantStatus(status: 'active' | 'suspended') {
    setTenantMsg(null);
    try {
      await api(`/tenants/${c.tenantId}`, { method: 'PATCH', body: { status } });
      await client.reload();
      setTenantMsg(status === 'suspended' ? 'Acesso do cliente suspenso.' : 'Acesso do cliente reativado.');
    } catch (err) {
      setTenantMsg((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/clients">Clientes</Link>}
        title={c.tradeName}
        actions={
          <>
            <Badge tone={statusTone[c.status]}>{statusLabel(c.status)}</Badge>
            {c.tenantStatus === 'suspended' && <Badge tone="danger">acesso suspenso</Badge>}
            {can('clients:write') && !editing && <Button onClick={() => setEditing(true)}>Editar</Button>}
          </>
        }
      />
      {saved && <Alert tone="ok">Cadastro atualizado.</Alert>}
      {tenantMsg && <Alert>{tenantMsg}</Alert>}

      {editing ? (
        <>
          <ClientForm
            initial={toForm(c)}
            mode="edit"
            submitLabel="Salvar alterações"
            onSubmit={async (payload) => {
              await api(`/clients/${id}`, { method: 'PATCH', body: payload });
              setEditing(false);
              setSaved(true);
              await Promise.all([client.reload(), events.reload()]);
            }}
          />
          <div>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancelar edição
            </Button>
          </div>
        </>
      ) : (
        <div className="ds-grid" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
          <div className="ds-stack" style={{ gap: 'var(--space-4)' }}>
            <Card title="Cadastro">
              <dl className="ds-dl">
                <dt>Razão social</dt>
                <dd>{c.legalName}</dd>
                <dt>CNPJ</dt>
                <dd className="ds-mono">{formatCnpj(c.cnpj)}</dd>
                <dt>Responsável</dt>
                <dd>{c.responsibleName}</dd>
                <dt>E-mail</dt>
                <dd>{c.email}</dd>
                <dt>Telefone</dt>
                <dd>{c.phone ?? '—'}</dd>
                <dt>Endereço</dt>
                <dd>{address || '—'}</dd>
                <dt>Segmento · nicho</dt>
                <dd>{[c.segment, c.niche].filter(Boolean).join(' · ') || '—'}</dd>
              </dl>
            </Card>
            <Card title="Comercial">
              <dl className="ds-dl">
                <dt>Plano</dt>
                <dd className="ds-mono">{c.plan}</dd>
                <dt>Valor mensal</dt>
                <dd>{brl(c.monthlyFeeCents)}</dd>
                <dt>Entrada</dt>
                <dd>{c.startDate ? new Date(`${c.startDate}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</dd>
                <dt>Vencimento</dt>
                <dd>{c.dueDay ? `todo dia ${c.dueDay}` : '—'}</dd>
                <dt>Observações</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{c.notes ?? '—'}</dd>
              </dl>
            </Card>
            <Card title="Ambiente do cliente">
              <PendingModule label="Projetos, demandas e aprovações" phase={2} />
              <PendingModule label="Contrato e financeiro" phase={3} />
              <PendingModule label="Equipe de agentes e memória" phase={4} />
              {can('tenants:manage') && (
                <div className="ds-row">
                  {c.tenantStatus === 'suspended' ? (
                    <Button onClick={() => void setTenantStatus('active')}>Reativar acesso</Button>
                  ) : (
                    <Button variant="danger" onClick={() => void setTenantStatus('suspended')}>
                      Suspender acesso
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </div>
          <Card title="Histórico">
            {!events.data ? (
              <Skeleton height={200} />
            ) : (
              <Timeline
                items={events.data.items.map((e) => ({
                  id: e.id,
                  at: e.createdAt,
                  content: (
                    <>
                      {eventLabel(e.type)}
                      {e.data.changes && <span className="ds-muted"> — {Object.keys(e.data.changes).map((k) => FIELD_LABELS[k] ?? k).join(', ')}</span>}
                      <div className="ds-stat-hint">
                        {new Date(e.createdAt).toLocaleDateString('pt-BR')} · {e.actorName ?? 'Sistema'}
                      </div>
                    </>
                  ),
                }))}
              />
            )}
          </Card>
        </div>
      )}
    </>
  );
}
