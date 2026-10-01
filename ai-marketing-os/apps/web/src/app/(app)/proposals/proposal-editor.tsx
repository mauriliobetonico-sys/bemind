'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { computeProposalTotals, PERIODICITIES, PERIODICITY_LABELS, type ProposalItemInput } from '@aimos/shared';
import { ApiError, brl, fieldErrors } from '@/lib/api';
import { parseMoney } from '../clients/client-form';
import { Alert, Button, Card, Input, Select, Textarea } from '@/design-system/components';

interface Row {
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
  recurrence: 'recurring' | 'one_time';
}

export interface ProposalDraft {
  title: string;
  validUntil: string;
  periodicity: (typeof PERIODICITIES)[number];
  discountType: 'none' | 'percent' | 'amount';
  discountValue: number;
  notes: string | null;
  internalNotes: string | null;
  items: ProposalItemInput[];
}

const toRow = (i: ProposalItemInput): Row => ({
  name: i.name,
  description: i.description ?? '',
  quantity: String(i.quantity).replace('.', ','),
  unitPrice: (i.unitPriceCents / 100).toFixed(2).replace('.', ','),
  recurrence: i.recurrence,
});
const emptyRow = (): Row => ({ name: '', description: '', quantity: '1', unitPrice: '', recurrence: 'recurring' });
const num = (v: string) => Number(v.replace(',', '.'));

/** Editor de proposta: o total mostrado usa o MESMO cálculo do servidor. */
export function ProposalEditor({
  initial,
  submitLabel,
  onSubmit,
  header,
}: {
  initial?: ProposalDraft;
  submitLabel: string;
  onSubmit: (body: ProposalDraft) => Promise<void>;
  header?: React.ReactNode;
}) {
  const inFifteen = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  const [v, setV] = useState({
    title: initial?.title ?? '',
    validUntil: initial?.validUntil ?? inFifteen,
    periodicity: initial?.periodicity ?? 'monthly',
    discountType: initial?.discountType ?? 'none',
    discountValue: initial ? (initial.discountType === 'amount' ? (initial.discountValue / 100).toFixed(2).replace('.', ',') : String(initial.discountValue)) : '0',
    notes: initial?.notes ?? '',
    internalNotes: initial?.internalNotes ?? '',
  });
  const [rows, setRows] = useState<Row[]>(initial?.items.map(toRow) ?? [emptyRow()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items: ProposalItemInput[] = rows
    .filter((r) => r.name.trim())
    .map((r) => ({ name: r.name.trim(), description: r.description || null, quantity: num(r.quantity) || 0, unitPriceCents: parseMoney(r.unitPrice || '0') || 0, recurrence: r.recurrence }));
  const discountValue = v.discountType === 'amount' ? parseMoney(v.discountValue || '0') || 0 : num(v.discountValue) || 0;
  const totals = useMemo(() => computeProposalTotals(items, v.discountType as 'none', discountValue), [items, v.discountType, discountValue]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await onSubmit({
        title: v.title,
        validUntil: v.validUntil,
        periodicity: v.periodicity as ProposalDraft['periodicity'],
        discountType: v.discountType as ProposalDraft['discountType'],
        discountValue,
        notes: v.notes || null,
        internalNotes: v.internalNotes || null,
        items,
      });
    } catch (err) {
      setErrors(fieldErrors(err));
      setMessage(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="ds-stack" style={{ gap: 'var(--space-4)' }} noValidate>
      {message && <Alert tone="danger">{message}</Alert>}
      <Card title="Proposta">
        {header}
        <div className="ds-form-grid">
          <Input label="Título" className="ds-span-2" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} error={errors.title} />
          <Input label="Válida até" type="date" value={v.validUntil} onChange={(e) => setV({ ...v, validUntil: e.target.value })} error={errors.validUntil} />
          <Select label="Recorrência" value={v.periodicity} onChange={(e) => setV({ ...v, periodicity: e.target.value as typeof v.periodicity })} options={PERIODICITIES.map((p) => ({ value: p, label: PERIODICITY_LABELS[p] }))} />
        </div>
      </Card>

      <Card title="Serviços">
        <div className="ds-stack" style={{ gap: 'var(--space-3)' }}>
          {rows.map((r, i) => (
            <div key={i} className="ds-card" style={{ background: 'var(--surface-2)', padding: 'var(--space-3)' }}>
              <div className="ds-form-grid">
                <Input label="Serviço" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                <Select
                  label="Tipo"
                  value={r.recurrence}
                  onChange={(e) => setRow(i, { recurrence: e.target.value as Row['recurrence'] })}
                  options={[
                    { value: 'recurring', label: 'Recorrente' },
                    { value: 'one_time', label: 'Único (setup)' },
                  ]}
                />
                <Input label="Quantidade" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} />
                <Input label="Valor unitário (R$)" inputMode="decimal" placeholder="1.500,00" value={r.unitPrice} onChange={(e) => setRow(i, { unitPrice: e.target.value })} />
                <Input label="Descrição (opcional)" className="ds-span-2" value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} />
              </div>
              <div className="ds-row" style={{ justifyContent: 'space-between' }}>
                <span className="ds-stat-hint">Total do item: {brl(Math.round((num(r.quantity) || 0) * (parseMoney(r.unitPrice || '0') || 0)))}</span>
                {rows.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>
                    Remover serviço
                  </Button>
                )}
              </div>
            </div>
          ))}
          {errors.items && <Alert tone="danger">{errors.items}</Alert>}
          <div>
            <Button size="sm" onClick={() => setRows([...rows, emptyRow()])}>
              Adicionar serviço
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Desconto, observações e totais">
        <div className="ds-form-grid">
          <Select
            label="Desconto (sobre o recorrente)"
            value={v.discountType}
            onChange={(e) => setV({ ...v, discountType: e.target.value as typeof v.discountType })}
            options={[
              { value: 'none', label: 'Sem desconto' },
              { value: 'percent', label: 'Percentual (%)' },
              { value: 'amount', label: 'Valor (R$)' },
            ]}
          />
          {v.discountType !== 'none' && (
            <Input label={v.discountType === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'} inputMode="decimal" value={v.discountValue} onChange={(e) => setV({ ...v, discountValue: e.target.value })} error={errors.discountValue} />
          )}
          <Textarea label="Observações para o cliente" className="ds-span-2" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          <Textarea label="Notas internas (o cliente não vê)" className="ds-span-2" value={v.internalNotes} onChange={(e) => setV({ ...v, internalNotes: e.target.value })} />
        </div>
        <dl className="ds-dl" style={{ maxWidth: 520 }}>
          <dt>Subtotal recorrente</dt>
          <dd className="ds-num" style={{ textAlign: 'left' }}>
            {brl(totals.recurringSubtotalCents)}
          </dd>
          {totals.discountCents > 0 && (
            <>
              <dt>Desconto</dt>
              <dd>− {brl(totals.discountCents)}</dd>
            </>
          )}
          <dt>Recorrente ({PERIODICITY_LABELS[v.periodicity as keyof typeof PERIODICITY_LABELS].toLowerCase()})</dt>
          <dd style={{ fontWeight: 600 }}>{brl(totals.recurringTotalCents)}</dd>
          <dt>Único (setup)</dt>
          <dd style={{ fontWeight: 600 }}>{brl(totals.oneTimeTotalCents)}</dd>
        </dl>
      </Card>
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Salvando…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
