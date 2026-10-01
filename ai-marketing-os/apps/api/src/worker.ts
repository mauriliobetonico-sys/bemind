import { createContext } from './bootstrap';
import { processOutbox } from './outbox/outbox';
import { outboxHandlers } from './outbox/handlers';
import { billingTick } from './jobs/billing-tick';

/**
 * Worker do outbox (fase 1): entrega e-mails e consome eventos de domínio.
 * Na fase 2 os handlers passam a publicar em filas BullMQ especializadas.
 */
const ctx = createContext();
const handlers = outboxHandlers(ctx);
let running = true;

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), service: 'worker', msg, ...extra }));

async function loop() {
  log('worker iniciado', { smtp: ctx.mailer.configured ? 'configured' : 'integration_pending' });
  let lastTick = 0;
  while (running) {
    try {
      // Rotina do comercial a cada 10 minutos (faturas, vencimentos, propostas expiradas).
      if (Date.now() - lastTick > 10 * 60_000) {
        lastTick = Date.now();
        const t = await billingTick(ctx.pool);
        if (t.ran && (t.invoicesCreated || t.overdueReminders || t.expiredProposals)) log('rotina de cobrança', { ...t });
      }
      const r = await processOutbox(ctx.pool, handlers, { maxAttempts: ctx.env.OUTBOX_MAX_ATTEMPTS });
      if (r.processed || r.failed || r.dead) log('lote processado', { ...r });
      if (r.processed === 0) await new Promise((res) => setTimeout(res, ctx.env.OUTBOX_POLL_MS));
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', service: 'worker', msg: (err as Error).message }));
      await new Promise((res) => setTimeout(res, ctx.env.OUTBOX_POLL_MS * 2));
    }
  }
  await ctx.pool.end();
}

process.on('SIGTERM', () => (running = false));
process.on('SIGINT', () => (running = false));
void loop();
