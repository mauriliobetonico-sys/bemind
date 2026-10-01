import nodemailer from 'nodemailer';
import type { Env } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** Lança erro quando a entrega falha — o outbox cuida do retry. */
  send(message: MailMessage): Promise<void>;
  readonly configured: boolean;
}

/** Entrega via SMTP. Sem SMTP_HOST configurado, o envio falha explicitamente. */
export class SmtpMailer implements Mailer {
  private readonly transport: nodemailer.Transporter | null;

  constructor(private readonly env: Env) {
    this.transport = env.SMTP_HOST
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
        })
      : null;
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transport) throw new Error('SMTP não configurado (Integration pending: defina SMTP_HOST)');
    await this.transport.sendMail({ from: this.env.MAIL_FROM, ...message });
  }
}

/** Implementação em memória para testes automatizados. */
export class MemoryMailer implements Mailer {
  readonly configured = true;
  readonly sent: MailMessage[] = [];
  failNext = 0;

  async send(message: MailMessage): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('falha simulada de SMTP');
    }
    this.sent.push(message);
  }
}
