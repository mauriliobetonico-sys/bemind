'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CLIENT_STATUSES, type ClientStatus } from '@aimos/shared';
import { brl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { formatCnpj, statusLabel, statusTone } from '@/lib/labels';
import { Alert, Badge, Button, EmptyState, PageHeader, Select, Skeleton } from '@/design-system/components';

interface ClientItem {
  id: string;
  tradeName: string;
  legalName: string;
  cnpj: string | null;
  responsibleName: string;
  plan: string;
  status: ClientStatus;
  monthlyFeeCents: number;
  tenantStatus: string;
}

function ClientsList() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);

  const qs = new URLSearchParams({ limit: '100', ...(q && { q }), ...(status && { status }) }).toString();
  const { data, error, loading } = useApi<{ total: number; items: ClientItem[] }>(`/clients?${qs}`);

  const update = (next: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...next });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    router.replace(`/clients${p.size ? `?${p}` : ''}`);
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    update({ q: search.trim() });
  };

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Clientes"
        actions={can('tenants:manage') && <Link className="ds-btn ds-btn-primary" href="/clients/new">Novo cliente</Link>}
      />
      <div className="ds-row" style={{ alignItems: 'flex-end' }}>
        <form onSubmit={onSearch} className="ds-row" role="search" style={{ flex: 1, minWidth: 260, alignItems: 'flex-end' }}>
          <div className="ds-field" style={{ flex: 1 }}>
            <label className="ds-label" htmlFor="q">
              Buscar
            </label>
            <input id="q" className="ds-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, razão social, e-mail ou CNPJ" />
          </div>
          <Button type="submit">Buscar</Button>
        </form>
        <Select
          label="Status"
          value={status}
          onChange={(e) => update({ status: e.target.value })}
          options={[{ value: '', label: 'Todos' }, ...CLIENT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))]}
          style={{ minWidth: 180 }}
        />
      </div>

      {error && <Alert tone="danger">{error.message}</Alert>}
      {loading && !data ? (
        <Skeleton height={240} />
      ) : data && data.items.length === 0 ? (
        <div className="ds-card">
          <EmptyState>{q || status ? 'Nenhum cliente encontrado com esses filtros.' : 'Nenhum cliente cadastrado ainda.'}</EmptyState>
        </div>
      ) : (
        data && (
          <div className="ds-table-wrap ds-fade-in">
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">Cliente</th>
                  <th scope="col">CNPJ</th>
                  <th scope="col">Responsável</th>
                  <th scope="col">Plano</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="ds-num">
                    Mensalidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/clients/${c.id}`} style={{ fontWeight: 500 }}>
                        {c.tradeName}
                      </Link>
                      <div className="ds-stat-hint">{c.legalName}</div>
                    </td>
                    <td className="ds-mono" style={{ fontSize: 13 }}>
                      {formatCnpj(c.cnpj)}
                    </td>
                    <td>{c.responsibleName}</td>
                    <td className="ds-mono">{c.plan}</td>
                    <td>
                      <div className="ds-row" style={{ gap: 6 }}>
                        <Badge tone={statusTone[c.status]}>{statusLabel(c.status)}</Badge>
                        {c.tenantStatus === 'suspended' && <Badge tone="danger">acesso suspenso</Badge>}
                      </div>
                    </td>
                    <td className="ds-num">{brl(c.monthlyFeeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {data && <p className="ds-stat-hint">{data.total} cliente(s)</p>}
    </>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <ClientsList />
    </Suspense>
  );
}
