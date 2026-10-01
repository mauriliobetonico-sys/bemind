import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Permission } from '@aimos/shared';
import type { AppContext } from '../context';
import { Access } from './access';
import { AppError, badRequest, forbidden, unauthorized } from '../lib/errors';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** 'public' = sem sessão; 'session' = qualquer usuário autenticado. */
    auth?: 'public' | 'session';
    /** Permissão mínima exigida (em algum escopo). Implica sessão. */
    permission?: Permission;
  }
  interface FastifyRequest {
    access: Access | null;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cookieNames(secure: boolean) {
  // O prefixo __Host- exige Secure, Path=/ e ausência de Domain.
  return secure
    ? { session: '__Host-aimos_session', csrf: '__Host-aimos_csrf' }
    : { session: 'aimos_session', csrf: 'aimos_csrf' };
}

export function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua : null };
}

/** Acesso autenticado da requisição (as rotas protegidas sempre o têm). */
export function requireAccess(req: FastifyRequest): Access {
  if (!req.access) throw unauthorized();
  return req.access;
}

/**
 * Tenant explicitamente selecionado (header X-Tenant-Id). Ele apenas
 * ESTREITA o escopo: Access.context() recusa tenants fora das associações.
 */
export function requestedTenant(req: FastifyRequest): string | null {
  const raw = req.headers['x-tenant-id'];
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) throw badRequest('X-Tenant-Id inválido');
  return raw.toLowerCase();
}

async function securityPlugin(app: FastifyInstance, ctx: AppContext) {
  const names = cookieNames(ctx.env.COOKIE_SECURE);
  const appOrigin = new URL(ctx.env.APP_URL).origin;

  app.decorateRequest('access', null);

  // Toda rota precisa declarar sua política: esquecer = erro na inicialização.
  app.addHook('onRoute', (route) => {
    const cfg = route.config as { auth?: string; permission?: string } | undefined;
    if (!cfg?.auth && !cfg?.permission) {
      throw new Error(`Rota ${route.method} ${route.url} sem política de acesso (config.auth ou config.permission)`);
    }
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const cfg = req.routeOptions.config;
    if (!cfg || (cfg.auth === 'public' && !cfg.permission)) return;

    if (MUTATING.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== appOrigin) throw forbidden('Origem não permitida');
    }

    const token = req.cookies[names.session];
    const resolved = token ? await ctx.sessions.resolve(token) : null;
    if (!resolved) {
      void reply.clearCookie(names.session, { path: '/' });
      throw unauthorized();
    }

    if (MUTATING.has(req.method)) {
      const header = req.headers['x-csrf-token'];
      if (!ctx.sessions.verifyCsrf(resolved.csrfHash, typeof header === 'string' ? header : undefined)) {
        await ctx.audit.record({
          action: 'security.csrf_rejected',
          result: 'denied',
          actorUserId: resolved.principal.userId,
          ...requestMeta(req),
          metadata: { method: req.method, route: req.routeOptions.url },
        });
        throw new AppError(403, 'csrf', 'Token CSRF inválido');
      }
    }

    const access = new Access(resolved.principal, await ctx.rolePermissions.get());
    req.access = access;

    if (cfg.permission && !access.canAny(cfg.permission)) {
      await ctx.audit.record({
        action: 'security.permission_denied',
        result: 'denied',
        actorUserId: resolved.principal.userId,
        ...requestMeta(req),
        metadata: { permission: cfg.permission, method: req.method, route: req.routeOptions.url },
      });
      throw forbidden();
    }
  });
}

export const security = fp(securityPlugin, { name: 'aimos-security' });
