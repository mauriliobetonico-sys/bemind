'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { DEMAND_TYPE_LABELS, DEMAND_TYPES, PRIORITIES, PRIORITY_LABELS } from '@aimos/shared';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { ClientPicker, useClientOptions } from '@/components/client-picker';
import { Alert, Button, Input, PageHeader, Select, Textarea } from '@/design-system/components';

export default function NewDemandPage() {
  const router = useRouter();
  const { staff } = useClientOptions();
  const [tenantId, setTenantId] = useState('');
  const [v, setV] = useState({ type: 'post', title: '', description: '', priority: 'normal', dueDate: '', refs: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (staff && !tenantId) return setMessage('Selecione o cliente.');
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const d = await api<{ id: string }>('/demands', {
        method: 'POST',
        tenantId: staff ? tenantId : null,
        body: { ...v, dueDate: v.dueDate || null },
      });
      router.push(`/demands/${d.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setMessage(err instanceof ApiError ? err.message : 'Não foi possível enviar.');
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Demandas" title="Nova demanda" />
      <p className="ds-text-2" style={{ maxWidth: 720 }}>
        Conte o que você precisa. A equipe recebe na hora, monta o briefing e acompanha a produção até a sua aprovação.
      </p>
      <form className="ds-card" onSubmit={submit} noValidate style={{ maxWidth: 860 }}>
        {message && <Alert tone="danger">{message}</Alert>}
        <div className="ds-form-grid">
          {staff && <ClientPicker value={tenantId} onChange={setTenantId} />}
          <Select label="Tipo" value={v.type} onChange={set('type')} options={DEMAND_TYPES.map((t) => ({ value: t, label: DEMAND_TYPE_LABELS[t] }))} />
          <Input label="Título" className="ds-span-2" required value={v.title} onChange={set('title')} error={errors.title} placeholder="Ex.: Campanha de Black Friday" />
          <Textarea label="Descrição" className="ds-span-2" required value={v.description} onChange={set('description')} error={errors.description} placeholder="Objetivo, público, formatos, onde vai ser publicado…" />
          <Select label="Prioridade" value={v.priority} onChange={set('priority')} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
          <Input label="Prazo desejado" type="date" value={v.dueDate} onChange={set('dueDate')} error={errors.dueDate} />
          <Textarea label="Referências" className="ds-span-2" value={v.refs} onChange={set('refs')} placeholder="Links, perfis, campanhas que você gosta" />
          <Textarea label="Observações" className="ds-span-2" value={v.notes} onChange={set('notes')} />
        </div>
        <p className="ds-stat-hint">Arquivos de apoio podem ser anexados na página da demanda, depois de enviada.</p>
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar demanda'}
          </Button>
        </div>
      </form>
    </>
  );
}
