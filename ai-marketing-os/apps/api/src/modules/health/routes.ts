import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';

export async function healthRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/health', { config: { auth: 'public', rateLimit: false } }, async () => ({ status: 'ok' }));

  app.get('/ready', { config: { auth: 'public', rateLimit: false } }, async (_req, reply) => {
    try {
      await ctx.pool.query('SELECT 1');
      return { status: 'ready', database: 'ok', smtp: ctx.mailer.configured ? 'configured' : 'integration_pending' };
    } catch {
      return reply.code(503).send({ status: 'unavailable', database: 'error' });
    }
  });
}
