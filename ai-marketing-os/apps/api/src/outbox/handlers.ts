import { withContext, SYSTEM } from '../db/pool';
import type { AppContext } from '../context';
import { issuePasswordToken } from '../modules/auth/password-tokens';
import { resetEmail, staffInviteEmail, welcomeEmail } from '../mail/templates';
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

    // Eventos de domínio sem efeito colateral nesta fase (consumidos pelas fases 2+).
    'client.created': async () => undefined,
    'client.updated': async () => undefined,
  };
}
