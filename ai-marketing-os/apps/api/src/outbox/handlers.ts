import { withContext, SYSTEM } from '../db/pool';
import type { AppContext } from '../context';
import { issuePasswordToken } from '../modules/auth/password-tokens';
import { notificationEmail, resetEmail, staffInviteEmail, welcomeEmail } from '../mail/templates';
import { scanStream } from '../storage/clamav';
import type { Tx } from '../db/pool';
import type { OutboxHandler } from './outbox';

/** Serviços exibidos no e-mail de boas-vindas por plano (até o módulo de contratos, fase 3). */
const PLAN_SERVICES: Record<string, string[]> = {
  START: ['Social media', 'Calendário editorial'],
  PRO: ['Social media', 'Calendário editorial', 'Design', 'Copywriting'],
  BUSINESS: ['Social media', 'Design', 'Copywriting', 'Vídeo', 'Tráfego pago'],
  ENTERPRISE: ['Equipe completa de agentes', 'Tráfego pago', 'Analytics', 'Customer success dedicado'],
};

/**
 * Handlers do outbox. O token de senha é gerado AQUI, no momento do envio:
 * nunca fica em claro no banco, e um retry invalida o link anterior.
 */
export function outboxHandlers(ctx: AppContext): Record<string, OutboxHandler> {
  const base = ctx.env.APP_URL.replace(/\/$/, '');
  const link = (path: string, token: string) => `${ctx.env.APP_URL.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;

  return {
    'user.invite': async (event) => {
      const { userId, template, clientId } = event.payload as { userId: string; template: string; clientId?: string };
      const message = await withContext(ctx.pool, SYSTEM, async (tx) => {
        const user = (
          await tx.query<{ email: string; name: string; status: string }>('SELECT email, name, status FROM users WHERE id = $1', [userId])
        ).rows[0];
        if (!user || user.status !== 'invited') return null; // já ativado ou removido: nada a enviar
        const ttlHours = ctx.env.INVITE_TTL_HOURS;
        const token = await issuePasswordToken(tx, userId, 'invite', ttlHours * 3600_000);
        const setPasswordUrl = link('/set-password', token);

        if (template === 'client_welcome' && clientId) {
          const client = (
            await tx.query<{ trade_name: string; plan: string; tenant_id: string }>(
              'SELECT trade_name, plan, tenant_id FROM clients WHERE id = $1',
              [clientId],
            )
          ).rows[0];
          if (!client || client.tenant_id !== event.tenant_id) throw new Error('cliente do convite não encontrado no tenant do evento');
          return welcomeEmail({
            to: user.email,
            companyName: client.trade_name,
            userName: user.name,
            platformUrl: ctx.env.APP_URL,
            setPasswordUrl,
            plan: client.plan,
            services: PLAN_SERVICES[client.plan] ?? [],
            supportEmail: ctx.env.SUPPORT_EMAIL,
            expiresHours: ttlHours,
          });
        }
        return staffInviteEmail({ to: user.email, userName: user.name, setPasswordUrl, expiresHours: ttlHours });
      });
      if (message) await ctx.mailer.send(message);
    },

    'user.password_reset': async (event) => {
      const { userId } = event.payload as { userId: string };
      const message = await withContext(ctx.pool, SYSTEM, async (tx) => {
        const user = (
          await tx.query<{ email: string; name: string; status: string }>('SELECT email, name, status FROM users WHERE id = $1', [userId])
        ).rows[0];
        if (!user || user.status !== 'active') return null;
        const minutes = ctx.env.RESET_TTL_MINUTES;
        const token = await issuePasswordToken(tx, userId, 'reset', minutes * 60_000);
        return resetEmail({ to: user.email, userName: user.name, resetUrl: link('/set-password', token), expiresMinutes: minutes });
      });
      if (message) await ctx.mailer.send(message);
    },

    // ---------------------------------------------------------------- fase 2
    /** APROVAÇÃO SOLICITADA → e-mail para os usuários CLIENTE ativos do tenant. */
    'approval.requested': async (event) => {
      const { approvalId } = event.payload as { approvalId: string };
      const messages = await withContext(ctx.pool, SYSTEM, async (tx) => {
        const a = await approvalInfo(tx, approvalId, event.tenant_id);
        if (!a || a.status !== 'pending') return [];
        const recipients = await tenantClientUsers(tx, a.tenant_id);
        return recipients.map((r) =>
          notificationEmail({
            to: r.email,
            title: 'Aprovação solicitada',
            intro: `Olá, ${r.name}! A equipe preparou um entregável para a ${a.client_name} e precisa da sua aprovação.`,
            details: [
              ['Demanda', a.demand_title],
              ['Entregável', `${a.deliverable_title} (versão ${a.version})`],
              ...(a.message ? ([['Mensagem', a.message]] as [string, string][]) : []),
            ],
            cta: { url: `${base}/approvals`, label: 'Ver e aprovar' },
            footer: 'Você pode aprovar ou pedir alterações explicando o que gostaria de mudar.',
          }),
        );
      });
      for (const m of messages) await ctx.mailer.send(m);
    },

    /** CLIENTE DECIDIU → e-mail para quem pediu a aprovação. */
    'approval.decided': async (event) => {
      const { approvalId } = event.payload as { approvalId: string };
      const message = await withContext(ctx.pool, SYSTEM, async (tx) => {
        const a = await approvalInfo(tx, approvalId, event.tenant_id);
        if (!a || a.status === 'pending' || !a.requester_email) return null;
        const approved = a.status === 'approved';
        return notificationEmail({
          to: a.requester_email,
          title: approved ? 'Entregável aprovado' : 'Alteração solicitada',
          intro: approved
            ? `${a.client_name} aprovou "${a.deliverable_title}".`
            : `${a.client_name} pediu alterações em "${a.deliverable_title}".`,
          details: [['Demanda', a.demand_title], ...(a.reason ? ([['Motivo', a.reason]] as [string, string][]) : [])],
          cta: { url: `${base}/demands/${a.demand_id}`, label: 'Abrir demanda' },
        });
      });
      if (message) await ctx.mailer.send(message);
    },

    /** DEMANDA CRIADA → aviso para a equipe responsável (gestores do cliente e administradores). */
    'demand.created': async (event) => {
      const { demandId } = event.payload as { demandId: string };
      const messages = await withContext(ctx.pool, SYSTEM, async (tx) => {
        const d = (
          await tx.query<{ title: string; type: string; priority: string; due: string | null; client_name: string; requester: string | null }>(
            `SELECT d.title, d.type, d.priority, to_char(d.due_date, 'DD/MM/YYYY') AS due, t.name AS client_name, u.name AS requester
               FROM demands d JOIN tenants t ON t.id = d.tenant_id LEFT JOIN users u ON u.id = d.requested_by
              WHERE d.id = $1 AND d.tenant_id = $2`,
            [demandId, event.tenant_id],
          )
        ).rows[0];
        if (!d) return [];
        const staff = (
          await tx.query<{ email: string; name: string }>(
            `SELECT DISTINCT u.email, u.name FROM users u
               LEFT JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = $1 AND tu.role_key = 'GESTOR'
              WHERE u.status = 'active' AND (u.global_role IS NOT NULL OR tu.user_id IS NOT NULL)`,
            [event.tenant_id],
          )
        ).rows;
        return staff.map((s) =>
          notificationEmail({
            to: s.email,
            title: `Nova demanda — ${d.client_name}`,
            intro: `${d.requester ?? 'O cliente'} abriu uma nova demanda.`,
            details: [['Título', d.title], ['Tipo', d.type], ['Prioridade', d.priority], ...(d.due ? ([['Prazo', d.due]] as [string, string][]) : [])],
            cta: { url: `${base}/demands/${demandId}`, label: 'Abrir demanda' },
          }),
        );
      });
      for (const m of messages) await ctx.mailer.send(m);
    },

    /** Varredura antivírus (ClamAV). Arquivo só pode ser baixado após 'clean'. */
    'file.uploaded': async (event) => {
      const { fileId } = event.payload as { fileId: string };
      if (!ctx.env.CLAMAV_HOST || !event.tenant_id) return;
      const tenantId = event.tenant_id;
      let result: Awaited<ReturnType<typeof scanStream>>;
      try {
        result = await scanStream(ctx.env.CLAMAV_HOST, ctx.env.CLAMAV_PORT, ctx.storage.open(tenantId, fileId));
      } catch (err) {
        // Última tentativa: marca erro (download continua bloqueado) em vez de ficar "pendente" para sempre.
        if (event.attempts >= ctx.env.OUTBOX_MAX_ATTEMPTS) {
          await withContext(ctx.pool, SYSTEM, (tx) => tx.query(`UPDATE files SET scan_status = 'error' WHERE id = $1 AND tenant_id = $2`, [fileId, tenantId]));
        }
        throw err;
      }
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        await tx.query(`UPDATE files SET scan_status = $3 WHERE id = $1 AND tenant_id = $2`, [fileId, tenantId, result.status]);
        if (result.status === 'infected') {
          await ctx.audit.recordIn(tx, { action: 'file.infected', result: 'denied', tenantId, resourceType: 'file', resourceId: fileId, metadata: { signature: result.signature } });
        }
      });
      if (result.status === 'infected') await ctx.storage.remove(tenantId, fileId);
    },

    // Eventos de domínio sem efeito colateral nesta fase (consumidos pelas próximas fases).
    'client.created': async () => undefined,
    'client.updated': async () => undefined,
  };
}

interface ApprovalInfo {
  tenant_id: string;
  status: string;
  version: number;
  message: string | null;
  reason: string | null;
  deliverable_title: string;
  demand_id: string;
  demand_title: string;
  client_name: string;
  requester_email: string | null;
}

async function approvalInfo(tx: Tx, approvalId: string, tenantId: string | null): Promise<ApprovalInfo | undefined> {
  return (
    await tx.query<ApprovalInfo>(
      `SELECT a.tenant_id, a.status, a.version, a.message, a.reason, v.title AS deliverable_title, d.id AS demand_id,
              d.title AS demand_title, t.name AS client_name, u.email AS requester_email
         FROM approvals a
         JOIN deliverables v ON v.tenant_id = a.tenant_id AND v.id = a.deliverable_id
         JOIN demands d ON d.tenant_id = v.tenant_id AND d.id = v.demand_id
         JOIN tenants t ON t.id = a.tenant_id
         LEFT JOIN users u ON u.id = a.requested_by AND u.status = 'active'
        WHERE a.id = $1 AND a.tenant_id = $2`,
      [approvalId, tenantId],
    )
  ).rows[0];
}

/** Destinatários de um tenant: SOMENTE usuários CLIENTE ativos daquele tenant. */
async function tenantClientUsers(tx: Tx, tenantId: string) {
  return (
    await tx.query<{ email: string; name: string }>(
      `SELECT u.email, u.name FROM tenant_users tu JOIN users u ON u.id = tu.user_id
        WHERE tu.tenant_id = $1 AND tu.role_key = 'CLIENTE' AND u.status = 'active'`,
      [tenantId],
    )
  ).rows;
}
