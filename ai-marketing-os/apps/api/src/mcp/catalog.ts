import type { ConnectorDef, ToolDef } from './registry';
import { createTaskTool, internalConnector, scheduleEventTool } from './connectors/internal';
import { emailConnector, sendClientEmailTool } from './connectors/email';
import { triggerWebhookTool, webhookConnector } from './connectors/webhook';
import { wordpressConnector, wordpressDraftTool, wordpressPublishTool } from './connectors/wordpress';

/**
 * Integrações que exigem um app/credencial oficial do provedor (OAuth,
 * revisão de app). Ficam visíveis como "integration pending" — nada é
 * simulado. Cada uma entra como um novo arquivo em connectors/ sem mudar o Hub.
 */
const pending = (key: string, name: string, description: string, requirements: string): ConnectorDef => ({
  key,
  name,
  description,
  availability: 'integration_pending',
  requirements,
  fields: [],
});

export const CONNECTORS: ConnectorDef[] = [
  internalConnector,
  emailConnector,
  webhookConnector,
  wordpressConnector,
  pending('meta', 'Instagram e Facebook (Meta)', 'Publicação e métricas de páginas e perfis profissionais.', 'App na Meta for Developers com permissões instagram_content_publish/pages_manage_posts aprovadas na revisão de app.'),
  pending('google_workspace', 'Google Drive, Gmail e Calendar', 'Arquivos, e-mails e agenda do cliente.', 'Cliente OAuth no Google Cloud (tela de consentimento verificada) com os escopos de Drive, Gmail e Calendar.'),
  pending('google_analytics', 'Google Analytics 4', 'Relatórios de tráfego e conversão.', 'Cliente OAuth no Google Cloud com escopo analytics.readonly e acesso à propriedade GA4.'),
  pending('ads', 'Google Ads e Meta Ads', 'Leitura de campanhas; ativação sempre com aprovação humana.', 'Developer token do Google Ads e app Meta com ads_management aprovados.'),
  pending('whatsapp', 'WhatsApp Business', 'Mensagens pela API oficial (Cloud API).', 'Conta WhatsApp Business verificada, número e modelos de mensagem aprovados pela Meta.'),
  pending('adobe', 'Adobe (Photoshop, Illustrator, InDesign, Premiere, After Effects)', 'Fase 7 — somente APIs oficiais da Adobe.', 'Credenciais da Adobe Developer Console (Fase 7).'),
];

export const TOOLS: ToolDef<never>[] = [
  createTaskTool,
  scheduleEventTool,
  sendClientEmailTool,
  triggerWebhookTool,
  wordpressDraftTool,
  wordpressPublishTool,
] as unknown as ToolDef<never>[];

export const connectorByKey = (key: string) => CONNECTORS.find((c) => c.key === key);
export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);
