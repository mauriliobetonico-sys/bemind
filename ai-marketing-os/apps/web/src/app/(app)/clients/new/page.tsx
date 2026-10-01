'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { PageHeader } from '@/design-system/components';
import { ClientForm, emptyClient } from '../client-form';

export default function NewClientPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader eyebrow="Onboarding" title="Novo cliente" />
      <p className="ds-text-2" style={{ maxWidth: 760 }}>
        Ao salvar, o sistema provisiona o ambiente isolado do cliente (tenant), cria o acesso ao portal e registra tudo no histórico e na auditoria.
      </p>
      <ClientForm
        initial={emptyClient}
        mode="create"
        submitLabel="Cadastrar e provisionar"
        onSubmit={async (payload) => {
          const client = await api<{ id: string }>('/clients', { method: 'POST', body: payload });
          router.push(`/clients/${client.id}`);
        }}
      />
    </>
  );
}
