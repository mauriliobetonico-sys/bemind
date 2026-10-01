'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { PERIODICITY_LABELS, PROPOSAL_STATUS_LABELS, type ProposalItemInput, type ProposalStatus } from '@aimos/shared';
import { api, ApiError, brl, fmtDate, fmtDateTime } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Card, Input, PageHeader, Skeleton } from '@/design-system/components';
import { ProposalEditor, type ProposalDraft } from '../proposal-editor';
import { proposalTone } from '@/lib/labels';

interface Proposal extends ProposalDraft {
  id: string;
  tenantId: string;
  number: string;
  clientName: string;
  clientEmail: string;
  status: ProposalStatus;
  items: (ProposalItemInput & { totalCents: number })[];
  recurringSubtotalCents: number;
  discountCents: number;
  recurringTotalCents: number;
  oneTimeTotalCents: number;
  sentAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  acceptedVia: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  contractId: string | null;
}

export default function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const { data: p, error, reload } = useApi<Proposal>(`/proposals/${id}`);
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [manual, setManual] = useState(false);
  const [acceptedBy, setAcceptedBy] = useState('');

  if (error) return <Alert tone="danger">{error.status === 404 ? 'Proposta não encontrada.' : error.message}</Alert>;
  if (!p) return <Skeleton height={360} />;
  const writable = can('proposals:write');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'ok', text: ok });
      await reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha na operação.' });
    }
  };

  const send = () =>
    run(async () => {
      const r = await api<{ link: string }>(`/proposals/${id}/send`, { method: 'POST' });
      setLink(r.link);
    }, `Proposta enviada. O e-mail para ${p.clientEmail} entrou na fila de envio.`);

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/proposals">Propostas</Link> · <span className="ds-mono">{p.number}</span> · {p.clientName}
          </>
        }
        title={p.title}
        actions={<Badge tone={proposalTone[p.status]}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge>}
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {link && (
        <Card title="Link da proposta">
          <p className="ds-text-2">Envie este link ao cliente por onde preferir (WhatsApp, e-mail). Ele abre a proposta e permite aceitar online.</p>
          <div className="ds-row">
            <input className="ds-input" readOnly value={link} aria-label="Link da proposta" style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
            <Button onClick={() => void navigator.clipboard?.writeText(link).then(() => setMsg({ tone: 'ok', text: 'Link copiado.' }))}>Copiar</Button>
          </div>
        </Card>
      )}

      <div className="ds-row">
        <a className="ds-btn" href={`/api/proposals/${id}/pdf`}>
          Baixar PDF
        </a>
        {writable && ['draft', 'sent', 'viewed'].includes(p.status) && (
          <Button variant="primary" onClick={() => void send()}>
            {p.status === 'draft' ? 'Enviar ao cliente' : 'Reenviar / ver link'}
          </Button>
        )}
        {writable && ['draft', 'sent', 'viewed'].includes(p.status) && <Button onClick={() => setManual(true)}>Registrar aceite manual</Button>}
        {p.contractId && (
          <Link className="ds-btn" href={`/contracts/${p.contractId}`}>
            Ver contrato
          </Link>
        )}
      </div>
      {manual && (
        <Card title="Aceite registrado pela agência">
          <p className="ds-text-2">Use quando o cliente aceitou por telefone, reunião ou e-mail. O contrato é criado e a cobrança começa.</p>
          <div className="ds-row" style={{ alignItems: 'flex-end' }}>
            <Input label="Quem aceitou (nome completo)" value={acceptedBy} onChange={(e) => setAcceptedBy(e.target.value)} />
            <Button variant="primary" disabled={acceptedBy.trim().length < 3} onClick={() => void run(() => api(`/proposals/${id}/accept-manual`, { method: 'POST', body: { acceptedByName: acceptedBy } }), 'Aceite registrado. Contrato criado e cobrança iniciada.').then(() => setManual(false))}>
              Confirmar aceite
            </Button>
          </div>
        </Card>
      )}

      <Card title="Andamento">
        <dl className="ds-dl">
          <dt>Válida até</dt>
          <dd>{fmtDate(p.validUntil)}</dd>
          <dt>Enviada</dt>
          <dd>{fmtDateTime(p.sentAt)}</dd>
          <dt>Visualizada</dt>
          <dd>{fmtDateTime(p.viewedAt)}</dd>
          {p.acceptedAt && (
            <>
              <dt>Aceita</dt>
              <dd>
                {fmtDateTime(p.acceptedAt)} por {p.acceptedByName} ({p.acceptedVia === 'online' ? 'aceite online' : 'registrado pela agência'})
              </dd>
            </>
          )}
          {p.rejectedAt && (
            <>
              <dt>Recusada</dt>
              <dd>
                {fmtDateTime(p.rejectedAt)}
                {p.rejectionReason && ` — “${p.rejectionReason}”`}
              </dd>
            </>
          )}
        </dl>
      </Card>

      {p.status === 'draft' && writable ? (
        <ProposalEditor initial={p} submitLabel="Salvar alterações" onSubmit={(body) => run(() => api(`/proposals/${id}`, { method: 'PATCH', body }), 'Rascunho salvo.')} />
      ) : (
        <Card title="Serviços">
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">Serviço</th>
                  <th scope="col" className="ds-num">
                    Qtd.
                  </th>
                  <th scope="col" className="ds-num">
                    Unitário
                  </th>
                  <th scope="col">Tipo</th>
                  <th scope="col" className="ds-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((i, idx) => (
                  <tr key={idx}>
                    <td>
                      {i.name}
                      {i.description && <div className="ds-stat-hint">{i.description}</div>}
                    </td>
                    <td className="ds-num">{i.quantity}</td>
                    <td className="ds-num">{brl(i.unitPriceCents)}</td>
                    <td>{i.recurrence === 'recurring' ? 'Recorrente' : 'Único'}</td>
                    <td className="ds-num">{brl(i.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ds-dl" style={{ maxWidth: 520 }}>
            {p.discountCents > 0 && (
              <>
                <dt>Desconto</dt>
                <dd>− {brl(p.discountCents)}</dd>
              </>
            )}
            <dt>Recorrente ({PERIODICITY_LABELS[p.periodicity].toLowerCase()})</dt>
            <dd style={{ fontWeight: 600 }}>{brl(p.recurringTotalCents)}</dd>
            <dt>Único (setup)</dt>
            <dd style={{ fontWeight: 600 }}>{brl(p.oneTimeTotalCents)}</dd>
            {p.internalNotes && (
              <>
                <dt>Notas internas</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{p.internalNotes}</dd>
              </>
            )}
          </dl>
        </Card>
      )}
    </>
  );
}
