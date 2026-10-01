import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import type { AppContext } from './context';
import { AppError } from './lib/errors';
import { security } from './security/plugin';
import { authRoutes } from './modules/auth/routes';
import { clientRoutes } from './modules/clients/routes';
import { userRoutes } from './modules/users/routes';
import { tenantRoutes } from './modules/tenants/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { auditRoutes } from './modules/audit/routes';
import { healthRoutes } from './modules/health/routes';

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      ctx.env.NODE_ENV === 'test'
        ? false
        : {
            level: ctx.env.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
          },
    trustProxy: ctx.env.TRUST_PROXY,
    bodyLimit: 1_048_576,
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: ctx.env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    redis: ctx.env.REDIS_URL ? new Redis(ctx.env.REDIS_URL, { maxRetriesPerRequest: 1 }) : undefined,
    skipOnError: false,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Muitas requisições. Tente novamente em instantes.' });
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: 'Requisição inválida' });
    }
    req.log.error({ err }, 'erro não tratado');
    // Nunca expor stack trace ou mensagem interna.
    return reply.code(500).send({ error: 'internal', message: 'Erro interno' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found', message: 'Rota não encontrada' }));

  await app.register(
    async (api) => {
      await api.register(security, ctx);
      await api.register(healthRoutes, ctx);
      await api.register(authRoutes, ctx);
      await api.register(clientRoutes, ctx);
      await api.register(userRoutes, ctx);
      await api.register(tenantRoutes, ctx);
      await api.register(dashboardRoutes, ctx);
      await api.register(auditRoutes, ctx);
    },
    { prefix: '/api' },
  );

  return app;
}
