'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { PERIODICITY_LABELS, type Periodicity } from '@aimos/shared';
import { api, ApiError, brl, fmtDate, fmtDateTime } from '@/lib/api';
import { Alert, Badge, Button, Card, Input, Skeleton, Textarea } from '@/design-system/components';

interface PublicProposal {
  agencyName: string;
  clientName: string;
  number: string;
  title: string;
  status: 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  validUntil: string;
  periodicity: Periodicity;
  items: { name: string; description: string | null; quantity: number; unitPriceCents: number; recurrence: string; totalCents: number }[];
  recurringSubtotalCents: number;
  discountCents: number;
  recurringTotalCents: number;
  oneTimeTotalCents: number;
  notes: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
}

/** Página pública da proposta: o token na URL é a única credencial (assinado e revogável). */
export default function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [p, setP] = useState<PublicProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setP(await api<PublicProposal>(`/public/proposals/${token}`));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'Proposta não encontrada. Confira o link recebido.' : 'Não foi possível abrir a proposta.');
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: 'accept' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      await api(`/public/proposals/${token}/${path}`, { method: 'POST', body: path === 'accept' ? { name, agree } : { reason: reason || null } });
      setDone(path === 'accept' ? 'Proposta aceita! A agência foi avisada e você receberá a confirmação do contrato por e-mail.' : 'Resposta registrada. Obrigado pelo retorno.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao registrar a resposta.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !p) {
    return (
      <main className="ds-auth">
        <Alert tone="danger">{error}</Alert>
      </main>
    );
  }
  if (!p) {
    return (
      <main className="ds-main" style={{ margin: '0 auto' }}>
        <Skeleton height={400} />
      </main>
    );
  }
  const open = p.status === 'sent' || p.status === 'viewed';
  const per = PERIODICITY_LABELS[p.periodicity].toLowerCase();

  return (
    <main className="ds-main" style={{ margin: '0 auto', maxWidth: 880 }}>
      <header className="ds-stack" style={{ gap: 6 }}>
        <span className="ds-eyebrow">
          {p.agencyName} · Proposta {p.number}
        </span>
        <h1 className="ds-page-title">{p.title}</h1>
        <p className="ds-text-2">
          Para {p.clientName} · válida até {fmtDate(p.validUntil)}
        </p>
      </header>
      {done && <Alert tone="ok">{done}</Alert>}
      {p.status === 'accepted' && !done && <Alert tone="ok">Proposta aceita em {fmtDateTime(p.acceptedAt)} por {p.acceptedByName}.</Alert>}
      {p.status === 'rejected' && !done && <Alert>Esta proposta foi recusada.</Alert>}
      {p.status === 'expired' && <Alert tone="warn">Esta proposta expirou. Fale com a {p.agencyName} para receber uma nova.</Alert>}

      <Card title="Serviços">
        <ul className="ds-list">
          {p.items.map((i, idx) => (
            <li key={idx}>
              <span>
                <strong style={{ fontWeight: 500 }}>{i.name}</strong>
                {i.quantity !== 1 && <span className="ds-text-2"> × {String(i.quantity).replace('.', ',')}</span>}
                {i.description && <div className="ds-stat-hint">{i.description}</div>}
              </span>
              <span className="ds-row" style={{ gap: 8 }}>
                <Badge>{i.recurrence === 'recurring' ? per : 'único'}</Badge>
                <span className="ds-num">{brl(i.totalCents)}</span>
              </span>
            </li>
          ))}
        </ul>
        <dl className="ds-dl">
          {p.discountCents > 0 && (
            <>
              <dt>Desconto</dt>
              <dd>− {brl(p.discountCents)}</dd>
            </>
          )}
          <dt>Investimento {per}</dt>
          <dd style={{ fontWeight: 600, fontSize: 18 }}>{brl(p.recurringTotalCents)}</dd>
          {p.oneTimeTotalCents > 0 && (
            <>
              <dt>Investimento único</dt>
              <dd style={{ fontWeight: 600 }}>{brl(p.oneTimeTotalCents)}</dd>
            </>
          )}
        </dl>
        {p.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{p.notes}</p>}
        <div>
          <a className="ds-btn" href={`/api/public/proposals/${token}/pdf`}>
            Baixar PDF
          </a>
        </div>
      </Card>

      {open && !done && (
        <Card title="Sua resposta">
          {error && <Alert tone="danger">{error}</Alert>}
          {rejecting ? (
            <div className="ds-stack">
              <Textarea label="Quer contar o motivo? (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="ds-row">
                <Button disabled={busy} onClick={() => void act('reject')}>
                  Recusar proposta
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  Voltar
                </Button>
              </div>
            </div>
          ) : (
            <div className="ds-stack">
              <Input label="Seu nome completo" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              <label className="ds-check">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                Li e concordo com os serviços, valores e condições desta proposta.
              </label>
              <p className="ds-stat-hint">Ao aceitar, registramos seu nome, data, hora e endereço IP como comprovante do aceite eletrônico.</p>
              <div className="ds-row">
                <Button variant="primary" disabled={busy || !agree || name.trim().length < 3} onClick={() => void act('accept')}>
                  Aceitar proposta
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(true)}>
                  Recusar
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </main>
  );
}
