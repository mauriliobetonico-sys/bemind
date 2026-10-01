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
  'project.created': 'Projeto criado',
  'demand.created': 'Nova demanda aberta',
  'demand.status_changed': 'Status da demanda atualizado',
  'briefing.saved': 'Briefing registrado',
  'deliverable.created': 'Entregável criado',
  'deliverable.submitted_for_qa': 'Entregável enviado para QA',
  'deliverable.qa_rejected': 'QA devolveu para correção',
  'deliverable.new_version': 'Nova versão em produção',
  'qa.approved': 'QA aprovado',
  'approval.requested': 'Aprovação solicitada ao cliente',
  'approval.approved': 'Cliente aprovou',
  'approval.changes_requested': 'Cliente pediu alteração',
  'files.uploaded': 'Arquivos enviados',
  'brand.asset_added': 'Item adicionado ao Brand Vault',
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

export const demandTone: Record<string, Tone> = {
  submitted: 'info',
  planning: 'info',
  in_production: 'neutral',
  in_review: 'neutral',
  awaiting_approval: 'warn',
  changes_requested: 'danger',
  approved: 'ok',
  delivered: 'ok',
  cancelled: 'neutral',
};
export const deliverableTone: Record<string, Tone> = {
  draft: 'neutral',
  internal_review: 'info',
  awaiting_client: 'warn',
  changes_requested: 'danger',
  approved: 'ok',
};
export const priorityTone: Record<string, Tone> = { low: 'neutral', normal: 'neutral', high: 'warn', urgent: 'danger' };

export const proposalTone: Record<string, Tone> = { draft: 'neutral', sent: 'info', viewed: 'info', accepted: 'ok', rejected: 'danger', expired: 'neutral' };
export const invoiceTone: Record<string, Tone> = { open: 'info', overdue: 'danger', paid: 'ok', cancelled: 'neutral' };
export const INVOICE_STATUS_LABELS: Record<string, string> = { open: 'Em aberto', overdue: 'Vencida', paid: 'Paga', cancelled: 'Cancelada' };
export const contractTone: Record<string, Tone> = { active: 'ok', suspended: 'warn', ended: 'neutral', cancelled: 'danger' };
