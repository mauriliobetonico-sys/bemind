'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from '@aimos/shared';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '@/design-system/components';

interface Notification {
  id: string;
  clientName: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const CATEGORY_SHORT: Record<NotificationCategory, string> = {
  demand: 'Demanda',
  approval: 'Aprovação',
  deadline: 'Prazo',
  meeting: 'Reunião',
  finance: 'Financeiro',
  report: 'Relatório',
  ai: 'Agentes',
  tools: 'Ferramentas',
};

/** Categorias que fazem sentido para cada perfil (o cliente não recebe avisos de agentes/ferramentas). */
const CLIENT_CATEGORIES: NotificationCategory[] = ['demand', 'approval', 'meeting', 'finance', 'report'];

export default function NotificationsPage() {
  const { me } = useAuth();
  const router = useRouter();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const list = useApi<{ items: Notification[] }>(`/notifications?limit=100${onlyUnread ? '&unread=true' : ''}`);
  const prefs = useApi<{ email: Record<NotificationCategory, boolean> }>('/notifications/preferences');
  const [email, setEmail] = useState<Record<string, boolean> | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  useEffect(() => {
    if (prefs.data) setEmail(prefs.data.email);
  }, [prefs.data]);
  const categories = me?.isStaff ? NOTIFICATION_CATEGORIES : CLIENT_CATEGORIES;

  const open = async (n: Notification) => {
    if (!n.readAt) await api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => undefined);
    if (n.link) router.push(n.link);
    else await list.reload();
  };
  const readAll = async () => {
    await api('/notifications/read', { method: 'POST', body: { all: true } });
    await list.reload();
  };
  const toggle = async (c: NotificationCategory, value: boolean) => {
    setEmail((e) => ({ ...(e ?? {}), [c]: value }));
    try {
      await api('/notifications/preferences', { method: 'PUT', body: { email: { [c]: value } } });
      setMsg({ tone: 'ok', text: 'Preferência salva.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Falha ao salvar.' });
    }
  };

  const unread = list.data?.items.filter((n) => !n.readAt).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Sua conta"
        title="Notificações"
        actions={
          unread > 0 ? (
            <Button size="sm" onClick={() => void readAll()}>
              Marcar todas como lidas
            </Button>
          ) : undefined
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="ds-grid ds-split" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
        <Card
          title="Recentes"
          action={
            <label className="ds-check" style={{ minHeight: 0 }}>
              <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Só não lidas
            </label>
          }
        >
          {list.error && <Alert tone="danger">{list.error.message}</Alert>}
          {!list.data ? (
            <Skeleton height={240} />
          ) : list.data.items.length === 0 ? (
            <EmptyState>{onlyUnread ? 'Tudo lido.' : 'Nenhuma notificação ainda.'}</EmptyState>
          ) : (
            <ul className="ds-list">
              {list.data.items.map((n) => (
                <li key={n.id} style={{ alignItems: 'flex-start' }}>
                  <button
                    type="button"
                    onClick={() => void open(n)}
                    style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', cursor: 'pointer', flex: 1, minWidth: 0 }}
                  >
                    <span className="ds-stack" style={{ gap: 2 }}>
                      <span style={{ fontWeight: n.readAt ? 400 : 600 }}>{n.title}</span>
                      {n.body && <span className="ds-text-2" style={{ fontSize: 14 }}>{n.body}</span>}
                      <span className="ds-stat-hint">
                        {me?.isStaff ? `${n.clientName} · ` : ''}
                        {fmtDateTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                  <span className="ds-row" style={{ gap: 6 }}>
                    <Badge>{CATEGORY_SHORT[n.category]}</Badge>
                    {!n.readAt && <Badge tone="info">nova</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Receber também por e-mail">
          <p className="ds-stat-hint">As notificações aparecem sempre aqui. Escolha quais também chegam por e-mail. Convites e redefinição de senha são sempre enviados por e-mail.</p>
          {!email ? (
            <Skeleton height={160} />
          ) : (
            <div className="ds-stack" style={{ gap: 8 }}>
              {categories.map((c) => (
                <label key={c} className="ds-check">
                  <input type="checkbox" checked={email[c] ?? true} onChange={(e) => void toggle(c, e.target.checked)} /> {NOTIFICATION_CATEGORY_LABELS[c]}
                </label>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
