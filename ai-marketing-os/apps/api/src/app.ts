import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
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
import { projectRoutes } from './modules/projects/routes';
import { demandRoutes } from './modules/demands/routes';
import { taskRoutes } from './modules/tasks/routes';
import { fileRoutes } from './modules/files/routes';
import { calendarRoutes } from './modules/calendar/routes';
import { proposalRoutes } from './modules/commercial/proposals';
import { contractRoutes } from './modules/commercial/contracts';
import { financeRoutes } from './modules/finance/routes';
import { hitlRoutes } from './modules/hitl/actions';
import { aiRoutes } from './modules/ai/routes';
import { mcpRoutes } from './modules/mcp/routes';

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
  await app.register(multipart, { limits: { fileSize: ctx.env.MAX_UPLOAD_MB * 1024 * 1024, files: 20, fields: 10, parts: 40 } });
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
      await api.register(projectRoutes, ctx);
      await api.register(demandRoutes, ctx);
      await api.register(taskRoutes, ctx);
      await api.register(fileRoutes, ctx);
      await api.register(calendarRoutes, ctx);
      await api.register(proposalRoutes, ctx);
      await api.register(contractRoutes, ctx);
      await api.register(financeRoutes, ctx);
      await api.register(hitlRoutes, ctx);
      await api.register(aiRoutes, ctx);
      await api.register(mcpRoutes, ctx);
    },
    { prefix: '/api' },
  );

  return app;
}
