'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ACTION_LABELS, CONTRACT_STATUS_LABELS, PERIODICITY_LABELS } from '@aimos/shared';
import { api, ApiError, brl, fmtDate, fmtDateTime } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { contractTone } from '@/lib/labels';
import { InvoiceTable, type InvoiceRow } from '@/components/finance';
import { parseMoney } from '../../clients/client-form';
import { Alert, Badge, Button, Card, Input, PageHeader, Skeleton, Textarea } from '@/design-system/components';

interface Contract {
  id: string;
  number: string;
  clientName: string;
  title: string;
  status: keyof typeof CONTRACT_STATUS_LABELS;
  periodicity: keyof typeof PERIODICITY_LABELS;
  recurringAmountCents: number;
  setupAmountCents: number;
  monthlyValueCents: number;
  startDate: string;
  endDate: string | null;
  billingDay: number;
  services: string[];
  signatureStatus: string;
  cancelReason: string | null;
  proposalId: string | null;
  proposalNumber: string | null;
  invoices: InvoiceRow[];
  actions: { id: string; action: string; status: string; reason: string; createdAt: string }[];
}

const SIGNATURE: Record<string, string> = {
  accepted_online: 'Aceite eletrônico pelo link da proposta',
  manual: 'Assinado fora da plataforma / aceite registrado',
  esign_pending: 'Assinatura eletrônica pendente',
  esign_signed: 'Assinado eletronicamente',
};

export default function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const { data: c, error, reload } = useApi<Contract>(`/contracts/${id}`);
  const [mode, setMode] = useState<null | 'value' | 'cancel'>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  if (error) return <Alert tone="danger">{error.status === 404 ? 'Contrato não encontrado.' : error.message}</Alert>;
  if (!c) return <Skeleton height={360} />;
  const writable = can('contracts:write') && c.status !== 'cancelled';

  const run = async (fn: () => Promise<{ status?: string } | unknown>, ok: string) => {
    setMsg(null);
    try {
      const r = (await fn()) as { status?: string } | undefined;
      setMsg({ tone: 'ok', text: r?.status === 'pending' ? 'Pedido enviado para aprovação. Nada muda até a decisão.' : ok });
      setMode(null);
      setReason('');
      await reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha na operação.' });
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/contracts">Contratos</Link> · <span className="ds-mono">{c.number}</span> · {c.clientName}
          </>
        }
        title={c.title}
        actions={<Badge tone={contractTone[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge>}
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {writable && (
        <div className="ds-row">
          {c.status === 'active' && <Button onClick={() => void run(() => api(`/contracts/${id}`, { method: 'PATCH', body: { status: 'suspended' } }), 'Contrato suspenso: novas faturas não serão geradas.')}>Suspender</Button>}
          {c.status === 'suspended' && <Button onClick={() => void run(() => api(`/contracts/${id}`, { method: 'PATCH', body: { status: 'active' } }), 'Contrato reativado.')}>Reativar</Button>}
          <Button onClick={() => setMode('value')}>Alterar valor</Button>
          <Button variant="danger" onClick={() => setMode('cancel')}>
            Cancelar contrato
          </Button>
        </div>
      )}
      {mode && (
        <Card title={mode === 'value' ? 'Alterar valor (requer aprovação)' : 'Cancelar contrato (requer aprovação)'}>
          {mode === 'value' && <Input label="Novo valor por período (R$)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          <Textarea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="ds-row">
            <Button
              variant="primary"
              disabled={reason.trim().length < 5}
              onClick={() =>
                void run(
                  () =>
                    mode === 'value'
                      ? api(`/contracts/${id}/change-value`, { method: 'POST', body: { recurringAmountCents: parseMoney(amount), reason } })
                      : api(`/contracts/${id}/cancel`, { method: 'POST', body: { reason } }),
                  'Feito.',
                )
              }
            >
              Enviar pedido
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Voltar
            </Button>
          </div>
        </Card>
      )}

      <div className="ds-grid ds-grid-2">
        <Card title="Condições">
          <dl className="ds-dl">
            <dt>Valor</dt>
            <dd>
              {brl(c.recurringAmountCents)} {PERIODICITY_LABELS[c.periodicity].toLowerCase()} ({brl(c.monthlyValueCents)}/mês)
            </dd>
            <dt>Setup</dt>
            <dd>{brl(c.setupAmountCents)}</dd>
            <dt>Vigência</dt>
            <dd>
              {fmtDate(c.startDate)} → {c.endDate ? fmtDate(c.endDate) : 'indeterminado'}
            </dd>
            <dt>Vencimento</dt>
            <dd>todo dia {c.billingDay}</dd>
            <dt>Assinatura</dt>
            <dd>{SIGNATURE[c.signatureStatus] ?? c.signatureStatus}</dd>
            {c.proposalId && (
              <>
                <dt>Proposta</dt>
                <dd>
                  <Link href={`/proposals/${c.proposalId}`}>{c.proposalNumber}</Link>
                </dd>
              </>
            )}
            {c.cancelReason && (
              <>
                <dt>Cancelamento</dt>
                <dd>{c.cancelReason}</dd>
              </>
            )}
          </dl>
          <p className="ds-stat-hint">Assinatura eletrônica com certificado (ex.: ICP-Brasil): integração pendente.</p>
        </Card>
        <Card title="Serviços">
          {c.services.length ? (
            <ul className="ds-list">
              {c.services.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="ds-text-2">—</p>
          )}
          {c.actions.length > 0 && (
            <>
              <h3 className="ds-card-title">Pedidos críticos</h3>
              <ul className="ds-list">
                {c.actions.map((a) => (
                  <li key={a.id}>
                    <span>
                      {ACTION_LABELS[a.action] ?? a.action} <span className="ds-stat-hint">· {fmtDateTime(a.createdAt)}</span>
                    </span>
                    <Badge tone={a.status === 'pending' ? 'warn' : a.status === 'executed' ? 'ok' : 'neutral'}>{a.status}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
      <h2 className="ds-card-title">Faturas</h2>
      <InvoiceTable items={c.invoices} onChange={() => void reload()} canWrite={can('finance:write')} />
    </>
  );
}
