'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ACTION_LABELS } from '@aimos/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { Alert, Button, Card, Input, PageHeader, Skeleton, Textarea } from '@/design-system/components';

interface Settings {
  agencyName: string;
  agencyDocument: string | null;
  agencyAddress: string | null;
  agencyEmail: string | null;
  agencyPhone: string | null;
  paymentInstructions: string | null;
  proposalFooter: string | null;
  marginAlertPercent: number;
  invoiceLeadDays: number;
}
interface Policy {
  action: string;
  description: string;
  requiresApproval: boolean;
  allowSelfApproval: boolean;
}

export default function SettingsPage() {
  const { can } = useAuth();
  const settings = useApi<Settings>('/settings/agency');
  const policies = useApi<{ items: Policy[] }>('/action-policies');
  const [v, setV] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  useEffect(() => {
    if (settings.data) setV(settings.data);
  }, [settings.data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!v) return;
    setMsg(null);
    try {
      await api('/settings/agency', { method: 'PUT', body: { ...v, marginAlertPercent: Number(v.marginAlertPercent), invoiceLeadDays: Number(v.invoiceLeadDays) } });
      setMsg({ tone: 'ok', text: 'Configurações salvas.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha ao salvar' });
    }
  }

  const setPolicy = async (p: Policy, patch: Partial<Policy>) => {
    try {
      await api(`/action-policies/${p.action}`, { method: 'PUT', body: { requiresApproval: patch.requiresApproval ?? p.requiresApproval, allowSelfApproval: patch.allowSelfApproval ?? p.allowSelfApproval } });
      await policies.reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha' });
    }
  };
  const set = (k: keyof Settings) => (e: { target: { value: string } }) => setV((p) => (p ? { ...p, [k]: e.target.value } : p));
  const superAdmin = can('platform:settings');

  return (
    <>
      <PageHeader eyebrow="Agência" title="Configurações" />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {!v ? (
        <Skeleton height={300} />
      ) : (
        <form onSubmit={save} className="ds-stack" style={{ gap: 'var(--space-4)' }}>
          <Card title="Dados da agência (propostas, PDFs e e-mails)">
            <div className="ds-form-grid">
              <Input label="Nome" value={v.agencyName} onChange={set('agencyName')} />
              <Input label="CNPJ" value={v.agencyDocument ?? ''} onChange={set('agencyDocument')} />
              <Input label="E-mail" value={v.agencyEmail ?? ''} onChange={set('agencyEmail')} />
              <Input label="Telefone" value={v.agencyPhone ?? ''} onChange={set('agencyPhone')} />
              <Input label="Endereço" className="ds-span-2" value={v.agencyAddress ?? ''} onChange={set('agencyAddress')} />
              <Textarea label="Rodapé das propostas" className="ds-span-2" value={v.proposalFooter ?? ''} onChange={set('proposalFooter')} />
            </div>
          </Card>
          <Card title="Cobrança e alertas">
            <div className="ds-form-grid">
              <Textarea label="Instruções de pagamento (vão nas faturas: chave PIX, dados bancários…)" className="ds-span-2" value={v.paymentInstructions ?? ''} onChange={set('paymentInstructions')} />
              <Input label="Emitir faturas com quantos dias de antecedência" type="number" min={0} max={60} value={String(v.invoiceLeadDays)} onChange={set('invoiceLeadDays')} />
              <Input label="Alerta de margem abaixo de (%)" type="number" min={-100} max={100} value={String(v.marginAlertPercent)} onChange={set('marginAlertPercent')} />
            </div>
          </Card>
          <div>
            <Button type="submit" variant="primary">
              Salvar
            </Button>
          </div>
        </form>
      )}

      <Card title="Ações críticas (aprovação humana)">
        {!superAdmin && <p className="ds-stat-hint">Somente o super administrador altera estas regras.</p>}
        {!policies.data ? (
          <Skeleton height={120} />
        ) : (
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">Ação</th>
                  <th scope="col">Exige aprovação</th>
                  <th scope="col">Quem pediu pode aprovar</th>
                </tr>
              </thead>
              <tbody>
                {policies.data.items.map((p) => (
                  <tr key={p.action}>
                    <td>{ACTION_LABELS[p.action] ?? p.description}</td>
                    <td>
                      <label className="ds-check" style={{ minHeight: 0 }}>
                        <input type="checkbox" disabled={!superAdmin} checked={p.requiresApproval} onChange={(e) => void setPolicy(p, { requiresApproval: e.target.checked })} />
                        {p.requiresApproval ? 'Sim' : 'Não'}
                      </label>
                    </td>
                    <td>
                      <label className="ds-check" style={{ minHeight: 0 }}>
                        <input type="checkbox" disabled={!superAdmin || !p.requiresApproval} checked={p.allowSelfApproval} onChange={(e) => void setPolicy(p, { allowSelfApproval: e.target.checked })} />
                        {p.allowSelfApproval ? 'Sim (segundo passo explícito)' : 'Não (outra pessoa)'}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
