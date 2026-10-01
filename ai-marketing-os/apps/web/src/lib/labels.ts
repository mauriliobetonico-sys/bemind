import { CLIENT_STATUS_LABELS, type ClientStatus } from '@aimos/shared';
import type { Tone } from '@/design-system/components';

export const statusTone: Record<ClientStatus, Tone> = {
  prospect: 'info',
  onboarding: 'warn',
  active: 'ok',
  paused: 'neutral',
  churned: 'danger',
};

export const statusLabel = (s: string) => CLIENT_STATUS_LABELS[s as ClientStatus] ?? s;

const EVENT_LABELS: Record<string, string> = {
  'client.created': 'Cliente cadastrado e ambiente provisionado',
  'client.updated': 'Cadastro atualizado',
  'client.user_invited': 'Acesso do cliente criado — convite na fila de e-mail',
};
export const eventLabel = (type: string) => EVENT_LABELS[type] ?? type;

export const FIELD_LABELS: Record<string, string> = {
  legalName: 'razão social',
  tradeName: 'nome fantasia',
  cnpj: 'CNPJ',
  responsibleName: 'responsável',
  phone: 'telefone',
  email: 'e-mail',
  address: 'endereço',
  segment: 'segmento',
  niche: 'nicho',
  plan: 'plano',
  status: 'status',
  monthlyFeeCents: 'valor mensal',
  startDate: 'data de entrada',
  dueDay: 'vencimento',
  notes: 'observações',
};

export function formatCnpj(c: string | null) {
  if (!c) return '—';
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
