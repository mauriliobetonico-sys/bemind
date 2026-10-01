'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { Alert, Avatar, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '@/design-system/components';

interface User {
  id: string;
  name: string;
  email: string;
  globalRole: string | null;
  status: 'invited' | 'active' | 'disabled';
  lastLoginAt: string | null;
  memberships: { tenantId: string; tenantName: string; roleKey: string }[];
}
interface Tenant {
  id: string;
  name: string;
  kind: string;
}

const STATUS = { invited: { label: 'Convidado', tone: 'warn' }, active: { label: 'Ativo', tone: 'ok' }, disabled: { label: 'Desativado', tone: 'danger' } } as const;

export default function UsersPage() {
  const { me, can } = useAuth();
  const manage = can('users:manage');
  const users = useApi<{ items: User[] }>('/users');
  const tenants = useApi<{ items: Tenant[] }>(manage ? '/tenants' : null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', globalRole: '' });
  const [assign, setAssign] = useState<{ userId: string; tenantId: string; roleKey: string }>({ userId: '', tenantId: '', roleKey: 'OPERADOR' });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'ok', text: ok });
      await users.reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha na operação.' });
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api('/users', { method: 'POST', body: { name: form.name, email: form.email, globalRole: form.globalRole || null } }),
      `Convite enviado para ${form.email}.`,
    ).then(() => setForm({ name: '', email: '', globalRole: '' }));
  };

  const addMembership = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api(`/users/${assign.userId}/memberships`, { method: 'PUT', body: { tenantId: assign.tenantId, roleKey: assign.roleKey } }), 'Acesso atribuído.');
  };

  const clientTenants = (tenants.data?.items ?? []).filter((t) => t.kind === 'client');
  const staff = (users.data?.items ?? []).filter((u) => !u.memberships.some((m) => m.roleKey === 'CLIENTE') || u.globalRole);

  return (
    <>
      <PageHeader eyebrow="Acesso" title="Equipe e acessos" />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {manage && (
        <div className="ds-grid ds-grid-2">
          <Card title="Convidar pessoa da equipe">
            <form className="ds-stack" onSubmit={invite}>
              <Input label="Nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label="E-mail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <Select
                label="Papel global"
                value={form.globalRole}
                onChange={(e) => setForm({ ...form, globalRole: e.target.value })}
                options={[
                  { value: '', label: 'Nenhum (acesso por cliente: Gestor/Operador)' },
                  { value: 'ADMIN', label: 'Administrador da agência' },
                  ...(me?.user.globalRole === 'SUPER_ADMIN' ? [{ value: 'SUPER_ADMIN', label: 'Super administrador' }] : []),
                ]}
              />
              <Button type="submit" variant="primary">
                Enviar convite
              </Button>
            </form>
          </Card>
          <Card title="Atribuir acesso a um cliente">
            <form className="ds-stack" onSubmit={addMembership}>
              <Select
                label="Pessoa"
                value={assign.userId}
                onChange={(e) => setAssign({ ...assign, userId: e.target.value })}
                options={[{ value: '', label: 'Selecione' }, ...staff.filter((u) => !u.globalRole).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))]}
              />
              <Select
                label="Cliente"
                value={assign.tenantId}
                onChange={(e) => setAssign({ ...assign, tenantId: e.target.value })}
                options={[{ value: '', label: 'Selecione' }, ...clientTenants.map((t) => ({ value: t.id, label: t.name }))]}
              />
              <Select
                label="Papel"
                value={assign.roleKey}
                onChange={(e) => setAssign({ ...assign, roleKey: e.target.value })}
                options={[
                  { value: 'GESTOR', label: 'Gestor — lê e edita o cliente' },
                  { value: 'OPERADOR', label: 'Operador — somente leitura nesta fase' },
                ]}
              />
              <Button type="submit" disabled={!assign.userId || !assign.tenantId}>
                Atribuir
              </Button>
            </form>
          </Card>
        </div>
      )}

      {users.error && <Alert tone="danger">{users.error.message}</Alert>}
      {!users.data ? (
        <Skeleton height={240} />
      ) : users.data.items.length === 0 ? (
        <EmptyState>Nenhum usuário.</EmptyState>
      ) : (
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th scope="col">Pessoa</th>
                <th scope="col">Papel</th>
                <th scope="col">Acessos</th>
                <th scope="col">Status</th>
                <th scope="col">Último acesso</th>
                {manage && <th scope="col">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="ds-row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                      <Avatar name={u.name} />
                      <div>
                        <div style={{ fontWeight: 500 }}>{u.name}</div>
                        <div className="ds-stat-hint">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="ds-mono" style={{ fontSize: 13 }}>
                    {u.globalRole ?? (u.memberships[0]?.roleKey || '—')}
                  </td>
                  <td>
                    <div className="ds-row" style={{ gap: 6 }}>
                      {u.globalRole ? (
                        <Badge tone="info">todos os clientes</Badge>
                      ) : (
                        u.memberships.map((m) => (
                          <span key={m.tenantId} className="ds-row" style={{ gap: 4 }}>
                            <Badge>
                              {m.tenantName} · {m.roleKey}
                            </Badge>
                            {manage && m.roleKey !== 'CLIENTE' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Remover acesso de ${u.name} a ${m.tenantName}`}
                                onClick={() => void run(() => api(`/users/${u.id}/memberships/${m.tenantId}`, { method: 'DELETE' }), 'Acesso removido.')}
                              >
                                Remover
                              </Button>
                            )}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    <Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge>
                  </td>
                  <td className="ds-stat-hint">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('pt-BR') : '—'}</td>
                  {manage && (
                    <td>
                      <div className="ds-row" style={{ gap: 6 }}>
                        {u.status === 'invited' && (
                          <Button size="sm" onClick={() => void run(() => api(`/users/${u.id}/resend-invite`, { method: 'POST' }), 'Convite reenviado.')}>
                            Reenviar convite
                          </Button>
                        )}
                        {u.id !== me?.user.id && u.status !== 'disabled' && (
                          <Button size="sm" variant="danger" onClick={() => void run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { status: 'disabled' } }), 'Usuário desativado e sessões encerradas.')}>
                            Desativar
                          </Button>
                        )}
                        {u.status === 'disabled' && (
                          <Button size="sm" onClick={() => void run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { status: 'active' } }), 'Usuário reativado.')}>
                            Reativar
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
