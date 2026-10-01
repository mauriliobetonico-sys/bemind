import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { defineTool, type ConnectorDef } from '../registry';
import { httpFailure, safeRequest } from '../http';

export const webhookConnector: ConnectorDef = {
  key: 'webhook',
  name: 'Webhook / n8n',
  description: 'Dispara um fluxo de automação (n8n, Make, Zapier ou sistema próprio) com um evento assinado por HMAC-SHA256.',
  availability: 'available',
  requirements: 'No n8n: crie um nó "Webhook" (método POST) e cole a URL de produção. Valide o cabeçalho X-AIMOS-Signature com o segredo.',
  fields: [
    { name: 'url', label: 'URL do webhook (POST)', type: 'url', secret: false, required: true },
    { name: 'secret', label: 'Segredo para assinatura (HMAC)', type: 'password', secret: true, required: true, help: 'Use um valor longo e aleatório; o fluxo valida a assinatura.' },
  ],
};

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export const triggerWebhookTool = defineTool({
  name: 'webhook.trigger',
  connector: 'webhook',
  title: 'Disparar automação (webhook)',
  description: 'Envia um evento para o fluxo de automação configurado deste cliente.',
  risk: 'MEDIUM',
  allowedAgents: ['orchestrator'],
  permission: 'mcp:use',
  rateLimitPerMinute: 20,
  params: z.strictObject({
    event: z.string().regex(/^[a-z0-9_.-]{2,60}$/, 'evento em minúsculas, sem espaços'),
    data: z.record(z.string(), z.unknown()).default({}),
  }),
  async execute(ctx, p) {
    const url = ctx.connection?.config.url;
    const secret = ctx.connection?.secrets.secret;
    if (!url || !secret) throw new Error('Webhook sem URL ou segredo configurados');
    const body = JSON.stringify({ event: p.event, data: p.data, tenantId: ctx.tenantId, callId: ctx.callId, sentAt: new Date().toISOString() });
    if (body.length > 64_000) throw new Error('Dados do evento grandes demais');
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await safeRequest('POST', url, {
      allowPrivate: ctx.app.env.MCP_ALLOW_PRIVATE_HOSTS,
      headers: { 'content-type': 'application/json', 'x-aimos-timestamp': ts, 'x-aimos-signature': signWebhook(secret, ts, body), 'x-aimos-call-id': ctx.callId },
      body,
    });
    if (r.status < 200 || r.status >= 300) throw httpFailure('Webhook', r);
    return { summary: `Evento "${p.event}" entregue (HTTP ${r.status})`, data: { status: r.status } };
  },
});
