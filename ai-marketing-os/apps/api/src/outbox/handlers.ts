import { withContext, SYSTEM } from '../db/pool';
import type { AppContext } from '../context';
import { issuePasswordToken } from '../modules/auth/password-tokens';
import { notificationEmail, resetEmail, staffInviteEmail, welcomeEmail } from '../mail/templates';
import { scanStream } from '../storage/clamav';
import type { Tx } from '../db/pool';
import type { OutboxHandler } from './outbox';
import { proposalToken } from '../modules/commercial/proposals';
import { getAgencySettings } from '../modules/finance/settings';
import { ACTION_LABELS } from '@aimos/shared';

const brl = (c: number | string) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

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

  async function invoiceEmail(event: { tenant_id: string | null; payload: Record<string, unknown> }, kind: 'issued' | 'overdue') {
    const { invoiceId } = event.payload as { invoiceId: string };
    if (!event.tenant_id) return;
    const tenantId = event.tenant_id;
    const messages = await withContext(ctx.pool, SYSTEM, async (tx) => {
      const inv = (
        await tx.query<{ number: string; description: string; amount: string; due: string; status: string; paid: string }>(
          `SELECT number, description, amount_cents AS amount, to_char(due_date, 'YYYY-MM-DD') AS due, status,
                  (SELECT coalesce(sum(amount_cents), 0) FROM payments WHERE invoice_id = invoices.id) AS paid
             FROM invoices WHERE id = $1 AND tenant_id = $2`,
          [invoiceId, tenantId],
        )
      ).rows[0];
      if (!inv || inv.status !== 'open') return [];
      const agency = await getAgencySettings(tx);
      const balance = Number(inv.amount) - Number(inv.paid);
      return (await billingRecipients(tx, tenantId)).map((r) =>
        notificationEmail({
          to: r.email,
          title: kind === 'issued' ? `Fatura ${inv.number}` : `Fatura ${inv.number} vencida`,
          intro:
            kind === 'issued'
              ? `Olá, ${r.name}! Sua fatura de ${agency.agencyName} está disponível.`
              : `Olá, ${r.name}! Não identificamos o pagamento da fatura ${inv.number}, vencida em ${dmy(inv.due)}. Se já pagou, desconsidere.`,
          details: [
            ['Referente a', inv.description],
            ['Valor', brl(balance)],
            ['Vencimento', dmy(inv.due)],
            ...(agency.paymentInstructions ? ([['Como pagar', agency.paymentInstructions]] as [string, string][]) : []),
          ],
          cta: { url: `${base}/billing`, label: 'Ver no portal' },
        }),
      );
    });
    for (const m of messages) await ctx.mailer.send(m);
  }

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

    // ---------------------------------------------------------------- fase 3
    /** PROPOSTA ENVIADA → e-mail ao contato do cliente com o link assinado. */
    'proposal.sent': async (event) => {
      const { proposalId } = event.payload as { proposalId: string };
      const message = await withContext(ctx.pool, SYSTEM, async (tx) => {
        const p = (
          await tx.query<{ number: string; title: string; status: string; nonce: string | null; valid_until: string; recurring: string; one_time: string; periodicity: string; contact: string; responsible: string; trade_name: string }>(
            `SELECT p.number, p.title, p.status, p.public_token_nonce AS nonce, to_char(p.valid_until, 'YYYY-MM-DD') AS valid_until,
                    p.recurring_total_cents AS recurring, p.one_time_total_cents AS one_time, p.periodicity,
                    c.email AS contact, c.responsible_name AS responsible, c.trade_name
               FROM proposals p JOIN clients c ON c.tenant_id = p.tenant_id WHERE p.id = $1 AND p.tenant_id = $2`,
            [proposalId, event.tenant_id],
          )
        ).rows[0];
        if (!p || !p.nonce || !['sent', 'viewed'].includes(p.status)) return null;
        const agency = await getAgencySettings(tx);
        const url = `${base}/p/${proposalToken(ctx.env.APP_SECRET, proposalId, p.nonce)}`;
        return notificationEmail({
          to: p.contact,
          title: `Proposta ${p.number} — ${p.title}`,
          intro: `Olá, ${p.responsible}! A ${agency.agencyName} preparou uma proposta para a ${p.trade_name}.`,
          details: [
            ['Investimento recorrente', brl(p.recurring)],
            ...(Number(p.one_time) > 0 ? ([['Investimento único', brl(p.one_time)]] as [string, string][]) : []),
            ['Válida até', dmy(p.valid_until)],
          ],
          cta: { url, label: 'Ver proposta' },
          footer: 'Pelo link você vê todos os detalhes, baixa o PDF e pode aceitar ou recusar a proposta.',
        });
      });
      if (message) await ctx.mailer.send(message);
    },

    /** PROPOSTA RESPONDIDA → aviso para quem criou e para os administradores. */
    'proposal.answered': async (event) => {
      const { proposalId } = event.payload as { proposalId: string };
      const messages = await withContext(ctx.pool, SYSTEM, async (tx) => {
        const p = (
          await tx.query<{ number: string; title: string; status: string; accepted_by_name: string | null; rejection_reason: string | null; trade_name: string; created_by: string | null }>(
            `SELECT p.number, p.title, p.status, p.accepted_by_name, p.rejection_reason, c.trade_name, p.created_by
               FROM proposals p JOIN clients c ON c.tenant_id = p.tenant_id WHERE p.id = $1 AND p.tenant_id = $2`,
            [proposalId, event.tenant_id],
          )
        ).rows[0];
        if (!p || !['accepted', 'rejected'].includes(p.status)) return [];
        const to = (
          await tx.query<{ email: string }>(
            `SELECT DISTINCT email FROM users WHERE status = 'active' AND (global_role IN ('SUPER_ADMIN', 'ADMIN') OR id = $1)`,
            [p.created_by],
          )
        ).rows;
        const accepted = p.status === 'accepted';
        return to.map((u) =>
          notificationEmail({
            to: u.email,
            title: accepted ? `Proposta aceita — ${p.trade_name}` : `Proposta recusada — ${p.trade_name}`,
            intro: accepted
              ? `${p.accepted_by_name ?? 'O cliente'} aceitou a proposta ${p.number} (${p.title}). O contrato foi criado e a cobrança iniciada.`
              : `A proposta ${p.number} (${p.title}) foi recusada.`,
            details: p.rejection_reason ? [['Motivo', p.rejection_reason]] : [],
            cta: { url: `${base}/proposals/${proposalId}`, label: 'Abrir proposta' },
          }),
        );
      });
      for (const m of messages) await ctx.mailer.send(m);
    },

    /** CONTRATO ATIVADO → confirmação ao cliente. */
    'contract.activated': async (event) => {
      const { contractId } = event.payload as { contractId: string };
      const messages = await withContext(ctx.pool, SYSTEM, async (tx) => {
        const k = (
          await tx.query<{ number: string; title: string; recurring: string; setup: string; periodicity: string; start: string }>(
            `SELECT number, title, recurring_amount_cents AS recurring, setup_amount_cents AS setup, periodicity, to_char(start_date, 'YYYY-MM-DD') AS start
               FROM contracts WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
            [contractId, event.tenant_id],
          )
        ).rows[0];
        if (!k || !event.tenant_id) return [];
        const recipients = await billingRecipients(tx, event.tenant_id);
        return recipients.map((r) =>
          notificationEmail({
            to: r.email,
            title: `Contrato ${k.number} ativo`,
            intro: `Olá, ${r.name}! Seu contrato "${k.title}" está ativo a partir de ${dmy(k.start)}.`,
            details: [['Valor recorrente', brl(k.recurring)], ...(Number(k.setup) > 0 ? ([['Setup', brl(k.setup)]] as [string, string][]) : [])],
            footer: 'As faturas chegam por e-mail e ficam disponíveis no portal.',
          }),
        );
      });
      for (const m of messages) await ctx.mailer.send(m);
    },

    /** FATURA EMITIDA / VENCIDA → e-mail ao cliente com instruções de pagamento. */
    'invoice.issued': async (event) => invoiceEmail(event, 'issued'),
    'invoice.overdue': async (event) => invoiceEmail(event, 'overdue'),

    /** AÇÃO CRÍTICA PEDIDA → aviso aos aprovadores (HITL). */
    'action.requested': async (event) => {
      const { actionId } = event.payload as { actionId: string };
      const messages = await withContext(ctx.pool, SYSTEM, async (tx) => {
        const a = (
          await tx.query<{ action: string; reason: string; status: string; requester: string | null; tenant_name: string }>(
            `SELECT a.action, a.reason, a.status, u.name AS requester, t.name AS tenant_name
               FROM pending_actions a JOIN tenants t ON t.id = a.tenant_id LEFT JOIN users u ON u.id = a.requested_by WHERE a.id = $1`,
            [actionId],
          )
        ).rows[0];
        if (!a || a.status !== 'pending') return [];
        const approvers = (await tx.query<{ email: string }>(`SELECT email FROM users WHERE status = 'active' AND global_role IN ('SUPER_ADMIN', 'ADMIN')`)).rows;
        return approvers.map((u) =>
          notificationEmail({
            to: u.email,
            title: 'Aprovação necessária',
            intro: `${a.requester ?? 'Alguém da equipe'} pediu: ${ACTION_LABELS[a.action] ?? a.action} (${a.tenant_name}).`,
            details: [['Motivo', a.reason]],
            cta: { url: `${base}/finance/actions`, label: 'Revisar pedido' },
            footer: 'Nada é executado até a sua decisão.',
          }),
        );
      });
      for (const m of messages) await ctx.mailer.send(m);
    },

    // Eventos de domínio sem efeito colateral nesta fase (consumidos pelas próximas fases).
    'client.created': async () => undefined,
    'client.updated': async () => undefined,
  };
}

/** Destinatários de cobrança: usuários CLIENTE ativos; sem usuário, o e-mail de contato do cadastro. */
async function billingRecipients(tx: Tx, tenantId: string) {
  const users = await tenantClientUsers(tx, tenantId);
  if (users.length) return users;
  return (await tx.query<{ email: string; name: string }>(`SELECT email, responsible_name AS name FROM clients WHERE tenant_id = $1`, [tenantId])).rows;
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
