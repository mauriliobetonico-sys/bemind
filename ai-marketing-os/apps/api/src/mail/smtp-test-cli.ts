import nodemailer from 'nodemailer';

/**
 * Verifica as credenciais SMTP e envia um e-mail de teste.
 *   node dist/mail/smtp-test-cli.mjs destinatario@exemplo.com
 * Usa as mesmas variáveis SMTP_* da API. Nunca imprime a senha.
 */
const to = process.argv[2];
const { SMTP_HOST, SMTP_PORT = '587', SMTP_SECURE = 'false', SMTP_USER, SMTP_PASSWORD, MAIL_FROM } = process.env;

if (!to || !SMTP_HOST) {
  console.error('Uso: smtp-test-cli <destinatario>  (requer SMTP_HOST e demais SMTP_*)');
  process.exit(1);
}

const secure = SMTP_SECURE === 'true' || SMTP_SECURE === '1';
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure,
  auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
});

console.log(`Conectando em ${SMTP_HOST}:${SMTP_PORT} (${secure ? 'TLS direto' : 'STARTTLS'}) como ${SMTP_USER ?? '(sem autenticação)'}…`);
try {
  await transport.verify();
  console.log('Autenticação SMTP OK.');
  const info = await transport.sendMail({
    from: MAIL_FROM ?? SMTP_USER,
    to,
    subject: 'Teste de envio — AI Marketing OS',
    text: 'Se você recebeu este e-mail, o SMTP do AI Marketing OS está configurado corretamente.',
  });
  console.log(`E-mail aceito pelo servidor (id ${info.messageId}). Confira a caixa de entrada e o spam.`);
} catch (err) {
  console.error(`Falha: ${(err as Error).message}`);
  process.exitCode = 1;
}
