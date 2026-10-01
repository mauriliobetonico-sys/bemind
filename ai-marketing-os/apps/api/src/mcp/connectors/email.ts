import { z } from 'zod';
import { notificationEmail } from '../../mail/templates';
import { defineTool, type ConnectorDef } from '../registry';

export const emailConnector: ConnectorDef = {
  key: 'email',
  name: 'E-mail para o cliente',
  description: 'Envia e-mails aos usuários do portal deste cliente pelo SMTP da plataforma. Os destinatários são definidos pelo servidor — nunca por quem pede.',
  availability: 'available',
  fields: [],
};

export const sendClientEmailTool = defineTool({
  name: 'email.send_to_client',
  connector: 'email',
  title: 'Enviar e-mail ao cliente',
  description: 'Envia uma mensagem aos usuários ativos do portal deste cliente.',
  risk: 'HIGH',
  allowedAgents: ['customer_success'],
  permission: 'mcp:use',
  rateLimitPerMinute: 5,
  params: z.strictObject({
    subject: z.string().trim().min(3).max(150),
    message: z.string().trim().min(10).max(8000),
  }),
  async execute(ctx, p) {
    if (!ctx.app.mailer.configured) throw new Error('SMTP não configurado (integration pending)');
    const recipients = await ctx.withTenant(async (tx) =>
      (
        await tx.query<{ email: string; name: string }>(
          `SELECT u.email, u.name FROM tenant_users tu JOIN users u ON u.id = tu.user_id
            WHERE tu.tenant_id = $1 AND tu.role_key = 'CLIENTE' AND u.status = 'active'`,
          [ctx.tenantId],
        )
      ).rows,
    );
    if (!recipients.length) throw new Error('Este cliente não tem usuários ativos no portal');
    for (const r of recipients) {
      await ctx.app.mailer.send(notificationEmail({ to: r.email, title: p.subject, intro: `Olá, ${r.name}!\n\n${p.message}` }));
    }
    return { summary: `E-mail "${p.subject}" enviado para ${recipients.length} destinatário(s)`, data: { recipients: recipients.length } };
  },
});
