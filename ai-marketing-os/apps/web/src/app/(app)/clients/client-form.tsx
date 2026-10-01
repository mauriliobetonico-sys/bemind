'use client';

import { useState, type FormEvent } from 'react';
import { CLIENT_STATUSES, PLANS } from '@aimos/shared';
import { ApiError, fieldErrors } from '@/lib/api';
import { statusLabel } from '@/lib/labels';
import { Alert, Button, Input, Select, Textarea } from '@/design-system/components';

export interface ClientFormValues {
  legalName: string;
  tradeName: string;
  cnpj: string;
  responsibleName: string;
  phone: string;
  email: string;
  segment: string;
  niche: string;
  plan: string;
  status: string;
  monthlyFee: string;
  startDate: string;
  dueDay: string;
  notes: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  inviteUser: boolean;
}

export const emptyClient: ClientFormValues = {
  legalName: '',
  tradeName: '',
  cnpj: '',
  responsibleName: '',
  phone: '',
  email: '',
  segment: '',
  niche: '',
  plan: 'PRO',
  status: 'onboarding',
  monthlyFee: '',
  startDate: '',
  dueDay: '',
  notes: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  zip: '',
  inviteUser: true,
};

/** Converte "3.500,00" ou "3500.5" em centavos. */
export function parseMoney(v: string): number {
  const normalized = v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function toPayload(v: ClientFormValues, mode: 'create' | 'edit') {
  const address = { street: v.street, number: v.number, complement: v.complement, district: v.district, city: v.city, state: v.state.toUpperCase(), zip: v.zip };
  const payload: Record<string, unknown> = {
    legalName: v.legalName,
    tradeName: v.tradeName,
    responsibleName: v.responsibleName,
    email: v.email,
    phone: v.phone,
    segment: v.segment,
    niche: v.niche,
    plan: v.plan,
    status: v.status,
    monthlyFeeCents: parseMoney(v.monthlyFee || '0'),
    notes: v.notes,
    address,
  };
  if (v.cnpj.trim()) payload.cnpj = v.cnpj;
  if (v.startDate) payload.startDate = v.startDate;
  if (v.dueDay) payload.dueDay = Number(v.dueDay);
  if (mode === 'create') payload.inviteUser = v.inviteUser;
  return payload;
}

export function ClientForm({
  initial,
  mode,
  onSubmit,
  submitLabel,
}: {
  initial: ClientFormValues;
  mode: 'create' | 'edit';
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  submitLabel: string;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ClientFormValues) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await onSubmit(toPayload(v, mode));
    } catch (err) {
      setErrors(fieldErrors(err));
      setMessage(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => errors[k];

  return (
    <form onSubmit={submit} className="ds-stack" style={{ gap: 'var(--space-4)' }} noValidate>
      {message && <Alert tone="danger">{message}</Alert>}
      <section className="ds-card">
        <h2 className="ds-card-title">Empresa</h2>
        <div className="ds-form-grid">
          <Input label="Nome fantasia" required value={v.tradeName} onChange={set('tradeName')} error={err('tradeName')} />
          <Input label="Razão social" required value={v.legalName} onChange={set('legalName')} error={err('legalName')} />
          <Input label="CNPJ" inputMode="numeric" placeholder="00.000.000/0000-00" value={v.cnpj} onChange={set('cnpj')} error={err('cnpj')} />
          <Input label="Segmento" value={v.segment} onChange={set('segment')} error={err('segment')} />
          <Input label="Nicho" value={v.niche} onChange={set('niche')} error={err('niche')} />
        </div>
      </section>
      <section className="ds-card">
        <h2 className="ds-card-title">Contato</h2>
        <div className="ds-form-grid">
          <Input label="Responsável" required value={v.responsibleName} onChange={set('responsibleName')} error={err('responsibleName')} />
          <Input label="E-mail" type="email" required value={v.email} onChange={set('email')} error={err('email')} hint={mode === 'create' ? 'Recebe o convite de acesso ao portal.' : undefined} />
          <Input label="Telefone" type="tel" value={v.phone} onChange={set('phone')} error={err('phone')} />
        </div>
        <div className="ds-form-grid">
          <Input label="Logradouro" value={v.street} onChange={set('street')} />
          <Input label="Número" value={v.number} onChange={set('number')} />
          <Input label="Complemento" value={v.complement} onChange={set('complement')} />
          <Input label="Bairro" value={v.district} onChange={set('district')} />
          <Input label="Cidade" value={v.city} onChange={set('city')} />
          <Input label="UF" maxLength={2} value={v.state} onChange={set('state')} error={err('address.state')} />
          <Input label="CEP" value={v.zip} onChange={set('zip')} error={err('address.zip')} />
        </div>
      </section>
      <section className="ds-card">
        <h2 className="ds-card-title">Comercial</h2>
        <div className="ds-form-grid">
          <Select label="Plano" value={v.plan} onChange={set('plan')} options={PLANS.map((p) => ({ value: p, label: p }))} />
          <Select label="Status" value={v.status} onChange={set('status')} options={CLIENT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
          <Input label="Valor mensal (R$)" inputMode="decimal" placeholder="3.500,00" value={v.monthlyFee} onChange={set('monthlyFee')} error={err('monthlyFeeCents')} />
          <Input label="Dia de vencimento" type="number" min={1} max={28} value={v.dueDay} onChange={set('dueDay')} error={err('dueDay')} />
          <Input label="Data de entrada" type="date" value={v.startDate} onChange={set('startDate')} error={err('startDate')} />
          <Textarea label="Observações" className="ds-span-2" value={v.notes} onChange={set('notes')} error={err('notes')} />
        </div>
        {mode === 'create' && (
          <label className="ds-check">
            <input type="checkbox" checked={v.inviteUser} onChange={(e) => setV((p) => ({ ...p, inviteUser: e.target.checked }))} />
            Criar o acesso do cliente e enviar o e-mail de boas-vindas (link seguro para criar a senha)
          </label>
        )}
      </section>
      <div className="ds-row">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Salvando…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
