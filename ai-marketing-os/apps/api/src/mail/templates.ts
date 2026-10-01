import type { MailMessage } from './mailer';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f5f7;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#14171c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td><p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6573">AI Marketing OS</p>
<h1 style="margin:0 0 20px;font-size:22px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr></table></td></tr></table></body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${escapeHtml(label)}</a></p>`;
}

export interface WelcomeData {
  to: string;
  companyName: string;
  userName: string;
  platformUrl: string;
  setPasswordUrl: string;
  plan: string;
  services: string[];
  supportEmail: string;
  expiresHours: number;
}

/**
 * Boas-vindas com fluxo seguro de criação de senha: o e-mail leva um link de
 * uso único com expiração — nunca uma senha em texto.
 */
export function welcomeEmail(d: WelcomeData): MailMessage {
  const services = d.services.length ? d.services.join(', ') : 'conforme proposta comercial';
  const text = [
    `Olá, ${d.userName}!`,
    ``,
    `A ${d.companyName} agora tem uma equipe de marketing trabalhando continuamente.`,
    ``,
    `Plataforma: ${d.platformUrl}`,
    `Usuário: ${d.to}`,
    `Crie sua senha (link válido por ${d.expiresHours}h, uso único): ${d.setPasswordUrl}`,
    ``,
    `Plano contratado: ${d.plan}`,
    `Serviços: ${services}`,
    ``,
    `Primeiro acesso: abra o link acima, defina uma senha com pelo menos 12 caracteres e entre com seu e-mail.`,
    `Suporte: ${d.supportEmail}`,
  ].join('\n');
  const html = layout(
    `Bem-vinda, ${d.companyName}`,
    `<p style="line-height:1.6">Olá, ${escapeHtml(d.userName)}! A partir de agora a <strong>${escapeHtml(d.companyName)}</strong> tem uma equipe de marketing trabalhando continuamente.</p>
<table role="presentation" style="font-size:14px;line-height:1.8">
<tr><td style="color:#5b6573;padding-right:16px">Plataforma</td><td><a href="${escapeHtml(d.platformUrl)}">${escapeHtml(d.platformUrl)}</a></td></tr>
<tr><td style="color:#5b6573;padding-right:16px">Usuário</td><td>${escapeHtml(d.to)}</td></tr>
<tr><td style="color:#5b6573;padding-right:16px">Plano</td><td>${escapeHtml(d.plan)}</td></tr>
<tr><td style="color:#5b6573;padding-right:16px">Serviços</td><td>${escapeHtml(services)}</td></tr></table>
${button(d.setPasswordUrl, 'Criar minha senha')}
<p style="font-size:13px;color:#5b6573;line-height:1.6">O link é de uso único e expira em ${d.expiresHours} horas. Depois de criar a senha, entre com seu e-mail. Dúvidas: ${escapeHtml(d.supportEmail)}.</p>`,
  );
  return { to: d.to, subject: `Bem-vinda ao AI Marketing OS — ${d.companyName}`, text, html };
}

export function staffInviteEmail(d: { to: string; userName: string; setPasswordUrl: string; expiresHours: number }): MailMessage {
  const text = `Olá, ${d.userName}!\n\nVocê foi convidado para a equipe do AI Marketing OS.\nCrie sua senha (válido por ${d.expiresHours}h, uso único): ${d.setPasswordUrl}`;
  const html = layout(
    'Convite para a equipe',
    `<p style="line-height:1.6">Olá, ${escapeHtml(d.userName)}! Você foi convidado para a equipe do AI Marketing OS.</p>${button(d.setPasswordUrl, 'Criar minha senha')}<p style="font-size:13px;color:#5b6573">Link de uso único, válido por ${d.expiresHours} horas.</p>`,
  );
  return { to: d.to, subject: 'Convite — AI Marketing OS', text, html };
}

export function resetEmail(d: { to: string; userName: string; resetUrl: string; expiresMinutes: number }): MailMessage {
  const text = `Olá, ${d.userName}!\n\nRecebemos um pedido para redefinir sua senha.\nLink (válido por ${d.expiresMinutes} min, uso único): ${d.resetUrl}\n\nSe não foi você, ignore este e-mail.`;
  const html = layout(
    'Redefinição de senha',
    `<p style="line-height:1.6">Olá, ${escapeHtml(d.userName)}! Recebemos um pedido para redefinir sua senha.</p>${button(d.resetUrl, 'Redefinir senha')}<p style="font-size:13px;color:#5b6573">Válido por ${d.expiresMinutes} minutos. Se não foi você, ignore este e-mail.</p>`,
  );
  return { to: d.to, subject: 'Redefinição de senha — AI Marketing OS', text, html };
}

export function notificationEmail(d: { to: string; title: string; intro: string; details?: [string, string][]; cta?: { url: string; label: string }; footer?: string }): MailMessage {
  const rows = (d.details ?? [])
    .map(([k, v]) => `<tr><td style="color:#5b6573;padding-right:16px;vertical-align:top">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  const html = layout(
    d.title,
    `<p style="line-height:1.6">${escapeHtml(d.intro)}</p>${rows ? `<table role="presentation" style="font-size:14px;line-height:1.8">${rows}</table>` : ''}${d.cta ? button(d.cta.url, d.cta.label) : ''}${d.footer ? `<p style="font-size:13px;color:#5b6573">${escapeHtml(d.footer)}</p>` : ''}`,
  );
  const text = [d.intro, '', ...(d.details ?? []).map(([k, v]) => `${k}: ${v}`), ...(d.cta ? ['', `${d.cta.label}: ${d.cta.url}`] : []), ...(d.footer ? ['', d.footer] : [])].join('\n');
  return { to: d.to, subject: `${d.title} — AI Marketing OS`, text, html };
}
