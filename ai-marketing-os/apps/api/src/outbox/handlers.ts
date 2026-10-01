import { withContext, SYSTEM } from '../db/pool';
import type { AppContext } from '../context';
import { issuePasswordToken } from '../modules/auth/password-tokens';
import { notificationEmail, resetEmail, staffInviteEmail, welcomeEmail } from '../mail/templates';
import { scanStream } from '../storage/clamav';
import type { Tx } from '../db/pool';
import type { OutboxHandler } from './outbox';
import type { MailMessage } from '../mail/mailer';
import { proposalToken } from '../modules/commercial/proposals';
import { getAgencySettings } from '../modules/finance/settings';
import { ACTION_LABELS } from '@aimos/shared';
import { executeRun } from '../ai/runs';
import { tenantCtx } from '../ai/gateway';
import { toVectorLiteral } from '../ai/embeddings';
import { executeToolCall } from '../mcp/hub';
import { runWorkflows } from '../automation/workflows';
import { generateDailyReport, sendDailyReport } from '../automation/daily-report';
import { runReminders } from '../automation/jobs';
import { AGENT_LABELS, type AgentKey } from '@aimos/shared';
import { admins, billingRecipients, clientUsers, deliver, teamFor, userById } from '../notifications/notify';
import { RISK_LABELS, type RiskLevel } from '@aimos/shared';

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
    await withContext(ctx.pool, SYSTEM, async (tx) => {
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
      return deliver(tx, {
        tenantId,
        recipients: await billingRecipients(tx, tenantId),
        category: 'finance',
        title: kind === 'issued' ? `Fatura ${inv.number} disponível` : `Fatura ${inv.number} vencida`,
        body: `${inv.description} · ${brl(balance)} · vence ${dmy(inv.due)}`,
        link: '/billing',
        data: { invoiceId },
        email: (r) => notificationEmail({
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
      });
    });
  }

  return {
    // Execução de agente (fila). Erros transitórios voltam para o outbox com backoff.
    'agent.run': async (event) => {
      const { runId } = event.payload as { runId: string };
      if (!event.tenant_id) throw new Error('agent.run sem tenant');
      await executeRun(ctx, event.tenant_id, runId, { lastAttempt: event.attempts >= ctx.env.OUTBOX_MAX_ATTEMPTS });
    },
    // Embedding de uma memória aprovada (busca semântica). Sem chave: nada a fazer.
    'memory.embed': async (event) => {
      const { memoryId } = event.payload as { memoryId: string };
      if (!event.tenant_id || !ctx.ai.embedder.configured) return;
      const tenantId = event.tenant_id;
      const mem = await withContext(ctx.pool, tenantCtx(tenantId), async (tx) =>
        (await tx.query<{ content: string }>(`SELECT content FROM agent_memories WHERE id = $1 AND status = 'approved'`, [memoryId])).rows[0],
      );
      if (!mem) return;
      const [vec] = await ctx.ai.embedder.embed([mem.content]);
      if (!vec) return;
      await withContext(ctx.pool, tenantCtx(tenantId), (tx) =>
        tx.query('UPDATE agent_memories SET embedding = $2::vector, embedding_model = $3 WHERE id = $1', [memoryId, toVectorLiteral(vec), ctx.ai.embedder.model]),
      );
    },
    /** E-mail de notificação já montado (enfileirado por deliver). Retry próprio, sem duplicar a notificação interna. */
    'mail.send': async (event) => {
      await ctx.mailer.send(event.payload as unknown as MailMessage);
    },
    // Chamada de ferramenta autorizada (MCP Hub). Transitórias voltam com backoff.
    'mcp.call': async (event) => {
      const { callId } = event.payload as { callId: string };
      if (!event.tenant_id) throw new Error('mcp.call sem tenant');
      await executeToolCall(ctx, event.tenant_id, callId, { lastAttempt: event.attempts >= ctx.env.OUTBOX_MAX_ATTEMPTS });
    },
    // Avisa quem pode aprovar: SUPER_ADMIN/ADMIN e gestores do cliente.
    'mcp.approval_requested': async (event) => {
      const { callId } = event.payload as { callId: string };
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const c = (
          await tx.query<{ tool: string; risk: RiskLevel; reason: string | null; agent: string | null; requester: string | null; client: string; status: string }>(
            `SELECT c.tool, c.risk, c.reason, c.requested_by_agent AS agent, u.name AS requester, t.name AS client, c.status
               FROM mcp_tool_calls c JOIN tenants t ON t.id = c.tenant_id LEFT JOIN users u ON u.id = c.requested_by_user
              WHERE c.id = $1 AND c.tenant_id = $2`,
            [callId, event.tenant_id],
          )
        ).rows[0];
        if (!c || c.status !== 'pending_approval') return [];
        return deliver(tx, {
          tenantId: event.tenant_id!,
          recipients: await teamFor(tx, event.tenant_id!),
          category: 'tools',
          title: `Aprovar ${c.tool} — ${c.client}`,
          body: `Risco ${RISK_LABELS[c.risk].toLowerCase()}${c.reason ? ` · ${c.reason}` : ''}`,
          link: '/tool-calls',
          data: { callId },
          email: (a) => notificationEmail({
            to: a.email,
            title: `Aprovação de ferramenta — ${c.client}`,
            intro: `${c.agent ? `O agente ${c.agent}` : c.requester ?? 'Alguém da equipe'} pediu para executar uma ação que precisa da sua decisão.`,
            details: [['Ferramenta', c.tool], ['Risco', RISK_LABELS[c.risk]], ...(c.reason ? ([['Motivo', c.reason]] as [string, string][]) : [])],
            cta: { url: `${base}/tool-calls`, label: 'Revisar e decidir' },
          }),
        });
      });
    },
    // ---------------------------------------------------------------- fase 6
    /** Relatório diário de UM cliente (enfileirado pela rotina diária ou manualmente). */
    'report.generate': async (event) => {
      const { date, force, send, createdBy } = event.payload as { date: string; force?: boolean; send?: boolean; createdBy?: string };
      if (!event.tenant_id) throw new Error('report.generate sem tenant');
      await generateDailyReport(ctx, event.tenant_id, date, { send: send ?? true, force: !!force, createdBy: createdBy ?? null });
    },
    'report.send': async (event) => {
      if (!event.tenant_id) return;
      await sendDailyReport(ctx, event.tenant_id, (event.payload as { reportId: string }).reportId);
    },
    'reminders.run': async (event) => {
      await runReminders(ctx, (event.payload as { date: string }).date);
    },
    /** Status da demanda: avisa o cliente do início e da conclusão; dispara workflows de entrega. */
    'demand.status_changed': async (event) => {
      const { demandId, to } = event.payload as { demandId: string; from: string; to: string };
      if (!event.tenant_id || !['in_production', 'delivered'].includes(to)) return;
      const tenantId = event.tenant_id;
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const d = (
          await tx.query<{ title: string; type: string; status: string; client: string }>(
            `SELECT d.title, d.type, d.status, t.name AS client FROM demands d JOIN tenants t ON t.id = d.tenant_id WHERE d.id = $1 AND d.tenant_id = $2`,
            [demandId, tenantId],
          )
        ).rows[0];
        if (!d || d.status !== to) return [];
        if (to === 'delivered') {
          await runWorkflows(tx, ctx, tenantId, 'demand.delivered', `demand.delivered:${demandId}`, { demandId, demandTitle: d.title, demandType: d.type, clientName: d.client });
        }
        const started = to === 'in_production';
        return deliver(tx, {
          tenantId,
          recipients: await clientUsers(tx, tenantId),
          category: 'demand',
          title: started ? `Trabalho iniciado: ${d.title}` : `Trabalho concluído: ${d.title}`,
          body: started ? 'A equipe começou a produção.' : 'A demanda foi entregue.',
          link: `/demands/${demandId}`,
          data: { demandId },
          email: (r) =>
            notificationEmail({
              to: r.email,
              title: started ? 'Trabalho iniciado' : 'Trabalho concluído',
              intro: started ? `Olá, ${r.name}! Começamos a produção de "${d.title}".` : `Olá, ${r.name}! "${d.title}" foi entregue.`,
              cta: { url: `${base}/demands/${demandId}`, label: 'Acompanhar' },
            }),
        });
      });
    },
    /** Pagamento registrado → confirmação ao cliente. */
    'payment.received': async (event) => {
      const { invoiceId, amountCents } = event.payload as { invoiceId: string; amountCents: number };
      if (!event.tenant_id) return;
      const tenantId = event.tenant_id;
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const inv = (await tx.query<{ number: string; status: string }>(`SELECT number, status FROM invoices WHERE id = $1 AND tenant_id = $2`, [invoiceId, tenantId])).rows[0];
        if (!inv) return [];
        const paid = inv.status === 'paid';
        return deliver(tx, {
          tenantId,
          recipients: await billingRecipients(tx, tenantId),
          category: 'finance',
          title: paid ? `Pagamento confirmado — fatura ${inv.number}` : `Pagamento parcial recebido — fatura ${inv.number}`,
          body: brl(amountCents),
          link: '/billing',
          data: { invoiceId },
          email: (r) =>
            notificationEmail({
              to: r.email,
              title: paid ? 'Pagamento confirmado' : 'Pagamento parcial recebido',
              intro: `Olá, ${r.name}! Recebemos ${brl(amountCents)} referente à fatura ${inv.number}. Obrigado!`,
              cta: { url: `${base}/billing`, label: 'Ver faturas' },
            }),
        });
      });
    },
    /** Reunião agendada no calendário (visível ao cliente) → cliente e equipe avisados. */
    'calendar.event_created': async (event) => {
      const { eventId } = event.payload as { eventId: string };
      if (!event.tenant_id) return;
      const tenantId = event.tenant_id;
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const e = (
          await tx.query<{ title: string; kind: string; visibility: string; starts: string }>(
            `SELECT title, kind, visibility, to_char(starts_at AT TIME ZONE $3, 'DD/MM HH24:MI') AS starts FROM calendar_events WHERE id = $1 AND tenant_id = $2`,
            [eventId, tenantId, ctx.env.APP_TIMEZONE],
          )
        ).rows[0];
        if (!e || e.kind !== 'meeting') return [];
        const recipients = [...(e.visibility === 'client' ? await clientUsers(tx, tenantId) : []), ...(await teamFor(tx, tenantId))];
        return deliver(tx, {
          tenantId,
          recipients,
          category: 'meeting',
          title: `Reunião: ${e.title}`,
          body: e.starts,
          link: '/calendar',
          data: { eventId },
          email: (r) => notificationEmail({ to: r.email, title: 'Reunião agendada', intro: `Olá, ${r.name}! Reunião "${e.title}" em ${e.starts}.`, cta: { url: `${base}/calendar`, label: 'Ver calendário' } }),
        });
      });
    },
    /** Agentes: plano concluído ou execução com problema → quem acionou (equipe). Só notificação interna. */
    'ai.run_finished': async (event) => {
      const { runId, outcome } = event.payload as { runId: string; outcome: 'plan_completed' | 'failed' | 'blocked' };
      if (!event.tenant_id) return;
      const tenantId = event.tenant_id;
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const r = (
          await tx.query<{ agent_key: AgentKey; demand_id: string | null; requested_by: string | null; error: string | null; title: string | null }>(
            `SELECT r.agent_key, r.demand_id, r.requested_by, r.error, d.title FROM agent_runs r LEFT JOIN demands d ON d.tenant_id = r.tenant_id AND d.id = r.demand_id
              WHERE r.id = $1 AND r.tenant_id = $2`,
            [runId, tenantId],
          )
        ).rows[0];
        if (!r) return;
        await deliver(tx, {
          tenantId,
          recipients: r.requested_by ? await userById(tx, r.requested_by) : await teamFor(tx, tenantId),
          category: 'ai',
          title: outcome === 'plan_completed' ? `Agentes concluíram: ${r.title ?? 'demanda'}` : `${AGENT_LABELS[r.agent_key]} não concluiu: ${r.title ?? ''}`.trim(),
          body: outcome === 'plan_completed' ? 'Rascunhos prontos para revisão humana.' : r.error,
          link: r.demand_id ? `/demands/${r.demand_id}` : '/agents',
          data: { runId },
        });
      });
    },
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
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const a = await approvalInfo(tx, approvalId, event.tenant_id);
        if (!a || a.status !== 'pending') return [];
        return deliver(tx, {
          tenantId: a.tenant_id,
          recipients: await clientUsers(tx, a.tenant_id),
          category: 'approval',
          title: `Aprovação solicitada: ${a.deliverable_title}`,
          body: `Demanda: ${a.demand_title}`,
          link: '/approvals',
          data: { approvalId, demandId: a.demand_id },
          email: (r) => notificationEmail({
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
        });
      });
    },

    /** CLIENTE DECIDIU → e-mail para quem pediu a aprovação. */
    'approval.decided': async (event) => {
      const { approvalId } = event.payload as { approvalId: string };
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const a = await approvalInfo(tx, approvalId, event.tenant_id);
        if (!a || a.status === 'pending') return [];
        const approved = a.status === 'approved';
        // Workflows do cliente ("cliente aprovou → …") — só pedem ações ao MCP Hub.
        await runWorkflows(tx, ctx, a.tenant_id, approved ? 'approval.approved' : 'approval.changes_requested', `approval:${approvalId}`, {
          demandId: a.demand_id,
          demandTitle: a.demand_title,
          demandType: a.demand_type,
          deliverableId: a.deliverable_id,
          deliverableTitle: a.deliverable_title,
          clientName: a.client_name,
          reason: a.reason ?? '',
        });
        return deliver(tx, {
          tenantId: a.tenant_id,
          recipients: [...(await userById(tx, a.requested_by)), ...(await teamFor(tx, a.tenant_id)).filter(() => !a.requested_by)],
          category: 'approval',
          title: approved ? `Aprovado: ${a.deliverable_title}` : `Alteração pedida: ${a.deliverable_title}`,
          body: approved ? `${a.client_name} aprovou.` : `${a.client_name}: ${a.reason ?? ''}`,
          link: `/demands/${a.demand_id}`,
          data: { approvalId, demandId: a.demand_id },
          email: (r) => notificationEmail({
          to: r.email,
          title: approved ? 'Entregável aprovado' : 'Alteração solicitada',
          intro: approved
            ? `${a.client_name} aprovou "${a.deliverable_title}".`
            : `${a.client_name} pediu alterações em "${a.deliverable_title}".`,
          details: [['Demanda', a.demand_title], ...(a.reason ? ([['Motivo', a.reason]] as [string, string][]) : [])],
          cta: { url: `${base}/demands/${a.demand_id}`, label: 'Abrir demanda' },
        }),
        });
      });
    },

    /** DEMANDA CRIADA → aviso para a equipe responsável (gestores do cliente e administradores). */
    'demand.created': async (event) => {
      const { demandId } = event.payload as { demandId: string };
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const d = (
          await tx.query<{ title: string; type: string; priority: string; due: string | null; client_name: string; requester: string | null }>(
            `SELECT d.title, d.type, d.priority, to_char(d.due_date, 'DD/MM/YYYY') AS due, t.name AS client_name, u.name AS requester
               FROM demands d JOIN tenants t ON t.id = d.tenant_id LEFT JOIN users u ON u.id = d.requested_by
              WHERE d.id = $1 AND d.tenant_id = $2`,
            [demandId, event.tenant_id],
          )
        ).rows[0];
        if (!d) return [];
        await runWorkflows(tx, ctx, event.tenant_id!, 'demand.created', `demand.created:${demandId}`, {
          demandId,
          demandTitle: d.title,
          demandType: d.type,
          clientName: d.client_name,
        });
        return deliver(tx, {
          tenantId: event.tenant_id!,
          recipients: await teamFor(tx, event.tenant_id!),
          category: 'demand',
          title: `Nova demanda — ${d.client_name}`,
          body: d.title,
          link: `/demands/${demandId}`,
          data: { demandId },
          email: (s) => notificationEmail({
            to: s.email,
            title: `Nova demanda — ${d.client_name}`,
            intro: `${d.requester ?? 'O cliente'} abriu uma nova demanda.`,
            details: [['Título', d.title], ['Tipo', d.type], ['Prioridade', d.priority], ...(d.due ? ([['Prazo', d.due]] as [string, string][]) : [])],
            cta: { url: `${base}/demands/${demandId}`, label: 'Abrir demanda' },
          }),
        });
      });
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
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const p = (
          await tx.query<{ number: string; title: string; status: string; accepted_by_name: string | null; rejection_reason: string | null; trade_name: string; created_by: string | null }>(
            `SELECT p.number, p.title, p.status, p.accepted_by_name, p.rejection_reason, c.trade_name, p.created_by
               FROM proposals p JOIN clients c ON c.tenant_id = p.tenant_id WHERE p.id = $1 AND p.tenant_id = $2`,
            [proposalId, event.tenant_id],
          )
        ).rows[0];
        if (!p || !['accepted', 'rejected'].includes(p.status)) return [];
        const accepted = p.status === 'accepted';
        return deliver(tx, {
          tenantId: event.tenant_id!,
          recipients: [...(await admins(tx)), ...(await userById(tx, p.created_by))],
          category: 'finance',
          title: accepted ? `Proposta aceita — ${p.trade_name}` : `Proposta recusada — ${p.trade_name}`,
          body: `${p.number} · ${p.title}`,
          link: `/proposals/${proposalId}`,
          data: { proposalId },
          email: (u) => notificationEmail({
            to: u.email,
            title: accepted ? `Proposta aceita — ${p.trade_name}` : `Proposta recusada — ${p.trade_name}`,
            intro: accepted
              ? `${p.accepted_by_name ?? 'O cliente'} aceitou a proposta ${p.number} (${p.title}). O contrato foi criado e a cobrança iniciada.`
              : `A proposta ${p.number} (${p.title}) foi recusada.`,
            details: p.rejection_reason ? [['Motivo', p.rejection_reason]] : [],
            cta: { url: `${base}/proposals/${proposalId}`, label: 'Abrir proposta' },
          }),
        });
      });
    },

    /** CONTRATO ATIVADO → confirmação ao cliente. */
    'contract.activated': async (event) => {
      const { contractId } = event.payload as { contractId: string };
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const k = (
          await tx.query<{ number: string; title: string; recurring: string; setup: string; periodicity: string; start: string }>(
            `SELECT number, title, recurring_amount_cents AS recurring, setup_amount_cents AS setup, periodicity, to_char(start_date, 'YYYY-MM-DD') AS start
               FROM contracts WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
            [contractId, event.tenant_id],
          )
        ).rows[0];
        if (!k || !event.tenant_id) return [];
        return deliver(tx, {
          tenantId: event.tenant_id,
          recipients: await billingRecipients(tx, event.tenant_id),
          category: 'finance',
          title: `Contrato ${k.number} ativo`,
          body: k.title,
          link: '/billing',
          data: { contractId },
          email: (r) => notificationEmail({
            to: r.email,
            title: `Contrato ${k.number} ativo`,
            intro: `Olá, ${r.name}! Seu contrato "${k.title}" está ativo a partir de ${dmy(k.start)}.`,
            details: [['Valor recorrente', brl(k.recurring)], ...(Number(k.setup) > 0 ? ([['Setup', brl(k.setup)]] as [string, string][]) : [])],
            footer: 'As faturas chegam por e-mail e ficam disponíveis no portal.',
          }),
        });
      });
    },

    /** FATURA EMITIDA / VENCIDA → e-mail ao cliente com instruções de pagamento. */
    'invoice.issued': async (event) => invoiceEmail(event, 'issued'),
    'invoice.overdue': async (event) => invoiceEmail(event, 'overdue'),

    /** AÇÃO CRÍTICA PEDIDA → aviso aos aprovadores (HITL). */
    'action.requested': async (event) => {
      const { actionId } = event.payload as { actionId: string };
      await withContext(ctx.pool, SYSTEM, async (tx) => {
        const a = (
          await tx.query<{ tenant_id: string; action: string; reason: string; status: string; requester: string | null; tenant_name: string }>(
            `SELECT a.tenant_id, a.action, a.reason, a.status, u.name AS requester, t.name AS tenant_name
               FROM pending_actions a JOIN tenants t ON t.id = a.tenant_id LEFT JOIN users u ON u.id = a.requested_by WHERE a.id = $1`,
            [actionId],
          )
        ).rows[0];
        if (!a || a.status !== 'pending') return [];
        return deliver(tx, {
          tenantId: a.tenant_id,
          recipients: await admins(tx),
          category: 'finance',
          title: `Aprovação necessária: ${ACTION_LABELS[a.action] ?? a.action}`,
          body: `${a.tenant_name} · ${a.reason}`,
          link: '/finance/actions',
          data: { actionId },
          email: (u) => notificationEmail({
            to: u.email,
            title: 'Aprovação necessária',
            intro: `${a.requester ?? 'Alguém da equipe'} pediu: ${ACTION_LABELS[a.action] ?? a.action} (${a.tenant_name}).`,
            details: [['Motivo', a.reason]],
            cta: { url: `${base}/finance/actions`, label: 'Revisar pedido' },
            footer: 'Nada é executado até a sua decisão.',
          }),
        });
      });
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
  deliverable_id: string;
  deliverable_title: string;
  demand_type: string;
  requested_by: string | null;
  demand_id: string;
  demand_title: string;
  client_name: string;
  requester_email: string | null;
}

async function approvalInfo(tx: Tx, approvalId: string, tenantId: string | null): Promise<ApprovalInfo | undefined> {
  return (
    await tx.query<ApprovalInfo>(
      `SELECT a.tenant_id, a.status, a.version, a.message, a.reason, v.id AS deliverable_id, v.title AS deliverable_title, d.id AS demand_id,
              d.type AS demand_type, a.requested_by,
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
