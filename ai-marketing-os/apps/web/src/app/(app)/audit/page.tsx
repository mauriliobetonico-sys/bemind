'use client';

import { useState } from 'react';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, EmptyState, PageHeader, Select, Skeleton } from '@/design-system/components';

interface AuditItem {
  id: string;
  action: string;
  result: 'success' | 'denied' | 'failure';
  resourceType: string | null;
  resourceId: string | null;
  tenantName: string | null;
  actorEmail: string | null;
  ip: string | null;
  createdAt: string;
}

const RESULT_TONE = { success: 'ok', denied: 'warn', failure: 'danger' } as const;
const RESULT_LABEL = { success: 'sucesso', denied: 'negado', failure: 'falha' } as const;

export default function AuditPage() {
  const [result, setResult] = useState('');
  const [action, setAction] = useState('');
  const qs = new URLSearchParams({ limit: '100', ...(result && { result }), ...(action && { action }) }).toString();
  const { data, error, loading, reload } = useApi<{ items: AuditItem[] }>(`/audit?${qs}`);

  return (
    <>
      <PageHeader eyebrow="Segurança" title="Auditoria" actions={<Button onClick={() => void reload()}>Atualizar</Button>} />
      <div className="ds-row" style={{ alignItems: 'flex-end' }}>
        <Select
          label="Ação"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          options={[
            { value: '', label: 'Todas' },
            { value: 'auth.', label: 'Autenticação' },
            { value: 'security.', label: 'Bloqueios de segurança' },
            { value: 'client.', label: 'Clientes' },
            { value: 'user.', label: 'Usuários e permissões' },
            { value: 'tenant.', label: 'Tenants' },
          ]}
          style={{ minWidth: 220 }}
        />
        <Select
          label="Resultado"
          value={result}
          onChange={(e) => setResult(e.target.value)}
          options={[
            { value: '', label: 'Todos' },
            { value: 'success', label: 'Sucesso' },
            { value: 'denied', label: 'Negado' },
            { value: 'failure', label: 'Falha' },
          ]}
          style={{ minWidth: 180 }}
        />
      </div>
      {error && <Alert tone="danger">{error.message}</Alert>}
      {loading && !data ? (
        <Skeleton height={300} />
      ) : data && data.items.length === 0 ? (
        <EmptyState>Nenhum registro com esses filtros.</EmptyState>
      ) : (
        data && (
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Ação</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Usuário</th>
                  <th scope="col">Tenant</th>
                  <th scope="col">Recurso</th>
                  <th scope="col">IP</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="ds-stat-hint" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(a.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td className="ds-mono" style={{ fontSize: 13 }}>
                      {a.action}
                    </td>
                    <td>
                      <Badge tone={RESULT_TONE[a.result]}>{RESULT_LABEL[a.result]}</Badge>
                    </td>
                    <td>{a.actorEmail ?? '—'}</td>
                    <td>{a.tenantName ?? '—'}</td>
                    <td className="ds-mono" style={{ fontSize: 12 }}>
                      {a.resourceType ? `${a.resourceType}:${a.resourceId?.slice(0, 8)}` : '—'}
                    </td>
                    <td className="ds-mono" style={{ fontSize: 12 }}>
                      {a.ip ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
