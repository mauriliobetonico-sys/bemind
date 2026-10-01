import { createContext } from './bootstrap';
import { processOutbox } from './outbox/outbox';
import { outboxHandlers } from './outbox/handlers';
import { billingTick } from './jobs/billing-tick';
import { failStaleRuns } from './ai/runs';
import { automationTick } from './automation/jobs';

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
  log('worker iniciado', { smtp: ctx.mailer.configured ? 'configured' : 'integration_pending', ai: ctx.ai.status() });
  let lastTick = 0;
  let lastAutomation = 0;
  while (running) {
    try {
      // Rotina do comercial a cada 10 minutos (faturas, vencimentos, propostas expiradas).
      if (Date.now() - lastTick > 10 * 60_000) {
        lastTick = Date.now();
        const t = await billingTick(ctx.pool);
        if (t.ran && (t.invoicesCreated || t.overdueReminders || t.expiredProposals)) log('rotina de cobrança', { ...t });
        const stale = await failStaleRuns(ctx);
        if (stale) log('execuções de agentes interrompidas marcadas como falha', { stale });
      }
      // Relatório diário e lembretes: confere a cada 5 minutos (cada rotina roda 1x por dia).
      if (Date.now() - lastAutomation > 5 * 60_000) {
        lastAutomation = Date.now();
        const a = await automationTick(ctx);
        if (a.reports || a.reminders) log('rotinas diárias', { ...a });
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
