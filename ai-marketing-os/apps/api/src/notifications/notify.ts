import type { NotificationCategory } from '@aimos/shared';
import type { Tx } from '../db/pool';
import type { MailMessage } from '../mail/mailer';
import { enqueue } from '../outbox/outbox';

export interface Recipient {
  /** null = contato sem conta (só e-mail, ex.: cobrança antes do acesso ao portal). */
  id: string | null;
  email: string;
  name: string;
}

/**
 * Entrega uma notificação: grava a notificação interna de cada usuário e
 * enfileira os e-mails (evento 'mail.send', um por mensagem), respeitando a
 * preferência de e-mail de cada um por categoria. Os destinatários SEMPRE
 * vêm de consultas do servidor (helpers abaixo) — nunca de dados de quem
 * disparou o evento.
 *
 * O e-mail tem retry próprio: se o SMTP falhar, só o e-mail é repetido —
 * a notificação interna nunca é duplicada. Devolve quantos e-mails entraram na fila.
 */
export async function deliver(
  tx: Tx,
  n: {
    tenantId: string;
    recipients: Recipient[];
    category: NotificationCategory;
    title: string;
    body?: string | null;
    link?: string | null;
    data?: Record<string, unknown>;
    email?: (r: Recipient) => MailMessage | null;
  },
): Promise<number> {
  const seen = new Set<string>();
  const recipients = n.recipients.filter((r) => {
    const key = r.id ?? r.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ids = recipients.map((r) => r.id).filter((x): x is string => !!x);
  if (ids.length) {
    await tx.query(
      `INSERT INTO notifications (tenant_id, user_id, category, title, body, link, data)
       SELECT $1, u, $3, $4, $5, $6, $7 FROM unnest($2::uuid[]) AS u`,
      [n.tenantId, ids, n.category, n.title.slice(0, 200), n.body?.slice(0, 2000) ?? null, n.link ?? null, JSON.stringify(n.data ?? {})],
    );
  }
  if (!n.email) return 0;
  const optedOut = new Set(
    ids.length
      ? (await tx.query<{ user_id: string }>(`SELECT user_id FROM notification_preferences WHERE category = $1 AND NOT email AND user_id = ANY($2)`, [n.category, ids])).rows.map((r) => r.user_id)
      : [],
  );
  const mails = recipients
    .filter((r) => !r.id || !optedOut.has(r.id))
    .map((r) => n.email!(r))
    .filter((m): m is MailMessage => !!m);
  for (const m of mails) await enqueue(tx, { type: 'mail.send', tenantId: n.tenantId, payload: { ...m } });
  return mails.length;
}

/** Usuários CLIENTE ativos do tenant (somente daquele tenant). */
export async function clientUsers(tx: Tx, tenantId: string): Promise<Recipient[]> {
  return (
    await tx.query<Recipient>(
      `SELECT u.id, u.email, u.name FROM tenant_users tu JOIN users u ON u.id = tu.user_id
        WHERE tu.tenant_id = $1 AND tu.role_key = 'CLIENTE' AND u.status = 'active'`,
      [tenantId],
    )
  ).rows;
}

/** Equipe responsável pelo cliente: SUPER_ADMIN/ADMIN e gestores associados ao tenant. */
export async function teamFor(tx: Tx, tenantId: string): Promise<Recipient[]> {
  return (
    await tx.query<Recipient>(
      `SELECT DISTINCT u.id, u.email, u.name FROM users u
         LEFT JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = $1 AND tu.role_key = 'GESTOR'
        WHERE u.status = 'active' AND (u.global_role IN ('SUPER_ADMIN', 'ADMIN') OR tu.user_id IS NOT NULL)`,
      [tenantId],
    )
  ).rows;
}

/** Administradores globais (ações financeiras, políticas). */
export async function admins(tx: Tx): Promise<Recipient[]> {
  return (await tx.query<Recipient>(`SELECT id, email, name FROM users WHERE status = 'active' AND global_role IN ('SUPER_ADMIN', 'ADMIN')`)).rows;
}

export async function userById(tx: Tx, userId: string | null): Promise<Recipient[]> {
  if (!userId) return [];
  return (await tx.query<Recipient>(`SELECT id, email, name FROM users WHERE id = $1 AND status = 'active'`, [userId])).rows;
}

/** Cobrança: usuários CLIENTE; sem usuário ainda, o e-mail de contato do cadastro (só e-mail). */
export async function billingRecipients(tx: Tx, tenantId: string): Promise<Recipient[]> {
  const users = await clientUsers(tx, tenantId);
  if (users.length) return users;
  return (await tx.query<{ email: string; name: string }>(`SELECT email, responsible_name AS name FROM clients WHERE tenant_id = $1`, [tenantId])).rows.map((r) => ({ id: null, ...r }));
}
