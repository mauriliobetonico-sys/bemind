'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { ClientPicker } from '@/components/client-picker';
import { PageHeader } from '@/design-system/components';
import { ProposalEditor } from '../proposal-editor';

export default function NewProposalPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState('');
  return (
    <>
      <PageHeader eyebrow="Propostas" title="Nova proposta" />
      <p className="ds-text-2" style={{ maxWidth: 760 }}>
        Para um prospect, cadastre antes o cliente com status “Prospect” e sem convite de acesso — o acesso é liberado automaticamente quando o primeiro pagamento for confirmado.
      </p>
      <ProposalEditor
        submitLabel="Salvar rascunho"
        header={<ClientPicker value={tenantId} onChange={setTenantId} />}
        onSubmit={async (body) => {
          if (!tenantId) throw new ApiError(400, 'bad_request', 'Selecione o cliente');
          const p = await api<{ id: string }>('/proposals', { method: 'POST', tenantId, body });
          router.push(`/proposals/${p.id}`);
        }}
      />
    </>
  );
}
