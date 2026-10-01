'use client';

import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { Select } from '@/design-system/components';

interface ClientOption {
  tenantId: string;
  tradeName: string;
}

/**
 * Seleção do cliente para quem atende vários (equipe). O servidor valida o
 * tenant escolhido; usuários com um único cliente nem veem este campo.
 */
export function useClientOptions() {
  const { me } = useAuth();
  const staff = !!me?.isStaff;
  const { data } = useApi<{ items: ClientOption[] }>(staff ? '/clients?limit=100' : null);
  return { staff, options: data?.items ?? [] };
}

export function ClientPicker({ value, onChange, label = 'Cliente', allowAll }: { value: string; onChange: (v: string) => void; label?: string; allowAll?: boolean }) {
  const { staff, options } = useClientOptions();
  if (!staff) return null;
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[{ value: '', label: allowAll ? 'Todos os clientes' : 'Selecione o cliente' }, ...options.map((o) => ({ value: o.tenantId, label: o.tradeName }))]}
      style={{ minWidth: 220 }}
    />
  );
}
