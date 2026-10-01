import type { FastifyInstance } from 'fastify';
import { forgotPasswordInput, loginInput, setPasswordInput, type Permission } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext, SYSTEM } from '../../db/pool';
import { badRequest, parse, unauthorized } from '../../lib/errors';
import { dummyVerify, hashPassword, verifyPassword } from '../../security/password';
import { cookieNames, requestMeta, requireAccess } from '../../security/plugin';
import { enqueue } from '../../outbox/outbox';
import { consumePasswordToken } from './password-tokens';

const INVALID_LOGIN = 'E-mail ou senha inválidos';

interface LoginRow {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  status: string;
  failed_logins: number;
  locked_until: Date | null;
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const names = cookieNames(ctx.env.COOKIE_SECURE);
  const baseCookie = { path: '/', secure: ctx.env.COOKIE_SECURE, sameSite: 'strict' as const };
  const SENSITIVE_RATE = { max: ctx.env.AUTH_RATE_PER_MINUTE, timeWindow: '1 minute' };

  app.post('/auth/login', { config: { auth: 'public', rateLimit: SENSITIVE_RATE } }, async (req, reply) => {
    const input = parse(loginInput, req.body);
    const meta = requestMeta(req);

    const user = await withContext(ctx.pool, SYSTEM, async (tx) =>
      (
        await tx.query<LoginRow>(
          `SELECT id, name, email, password_hash, status, failed_logins, locked_until FROM users WHERE email = $1`,
          [input.email],
        )
      ).rows[0],
    );

    const fail = async (reason: string, userId?: string) => {
      await ctx.audit.record({ action: 'auth.login', result: 'failure', actorUserId: userId, ...meta, metadata: { reason, email: input.email } });
      throw unauthorized(INVALID_LOGIN);
    };

    if (!user || !user.password_hash || user.status !== 'active') {
      await dummyVerify(input.password);
      return fail(user ? `status_${user.status}` : 'unknown_email', user?.id);
    }
    if (user.locked_until && user.locked_until > new Date()) {
      await dummyVerify(input.password);
      return fail('locked', user.id);
    }

    const ok = await verifyPassword(user.password_hash, input.password);
    if (!ok) {
      await withContext(ctx.pool, SYSTEM, (tx) =>
        tx.query(
          `UPDATE users
              SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
                  locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
            WHERE id = $1`,
          [user.id, ctx.env.LOGIN_MAX_FAILURES, String(ctx.env.LOGIN_LOCK_MINUTES)],
        ),
      );
      return fail('bad_password', user.id);
    }

    await withContext(ctx.pool, SYSTEM, (tx) =>
      tx.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]),
    );
    const session = await ctx.sessions.create(user.id, meta.ip, meta.userAgent);
    await ctx.audit.record({ action: 'auth.login', result: 'success', actorUserId: user.id, ...meta });

    void reply.setCookie(names.session, session.token, { ...baseCookie, httpOnly: true, expires: session.expiresAt });
    // Cookie de CSRF legível pelo JavaScript da própria origem (double submit vinculado à sessão).
    void reply.setCookie(names.csrf, session.csrfToken, { ...baseCookie, httpOnly: false, expires: session.expiresAt });
    return { csrfToken: session.csrfToken, user: { id: user.id, name: user.name, email: user.email } };
  });

  app.post('/auth/logout', { config: { auth: 'session' } }, async (req, reply) => {
    const access = requireAccess(req);
    await ctx.sessions.revoke(access.principal.sessionId);
    await ctx.audit.record({ action: 'auth.logout', result: 'success', actorUserId: access.principal.userId, ...requestMeta(req) });
    void reply.clearCookie(names.session, { path: '/' });
    void reply.clearCookie(names.csrf, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', { config: { auth: 'session' } }, async (req) => {
    const access = requireAccess(req);
    const map = await ctx.rolePermissions.get();
    const { principal } = access;
    const perms = (role: string | null) => [...(role ? (map.get(role) ?? []) : [])].sort() as Permission[];
    return {
      user: { id: principal.userId, name: principal.name, email: principal.email, globalRole: principal.globalRole },
      memberships: principal.memberships,
      permissions: {
        global: perms(principal.globalRole),
        byTenant: Object.fromEntries(principal.memberships.map((m) => [m.tenantId, perms(m.roleKey)])),
      },
      isStaff: access.isStaff(),
    };
  });

  app.post('/auth/password/set', { config: { auth: 'public', rateLimit: SENSITIVE_RATE } }, async (req, reply) => {
    const input = parse(setPasswordInput, req.body);
    const passwordHash = await hashPassword(input.password);
    const meta = requestMeta(req);

    const userId = await withContext(ctx.pool, SYSTEM, async (tx) => {
      const consumed = await consumePasswordToken(tx, input.token);
      if (!consumed) return null;
      const updated = await tx.query(
        `UPDATE users SET password_hash = $2, status = 'active', failed_logins = 0, locked_until = NULL
          WHERE id = $1 AND status <> 'disabled'`,
        [consumed.userId, passwordHash],
      );
      if (updated.rowCount === 0) return null;
      // Troca de senha encerra todas as sessões existentes.
      await ctx.sessions.revokeAllForUser(consumed.userId, tx);
      await ctx.audit.recordIn(tx, {
        action: consumed.purpose === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset',
        result: 'success',
        actorUserId: consumed.userId,
        resourceType: 'user',
        resourceId: consumed.userId,
        ...meta,
      });
      return consumed.userId;
    });

    if (!userId) {
      await ctx.audit.record({ action: 'auth.password_set', result: 'failure', ...meta, metadata: { reason: 'invalid_token' } });
      throw badRequest('Link inválido ou expirado. Solicite um novo.');
    }
    return reply.code(204).send();
  });

  app.post('/auth/password/forgot', { config: { auth: 'public', rateLimit: SENSITIVE_RATE } }, async (req, reply) => {
    const input = parse(forgotPasswordInput, req.body);
    await withContext(ctx.pool, SYSTEM, async (tx) => {
      const user = (await tx.query<{ id: string }>(`SELECT id FROM users WHERE email = $1 AND status = 'active'`, [input.email])).rows[0];
      if (user) {
        await enqueue(tx, { type: 'user.password_reset', payload: { userId: user.id } });
        await ctx.audit.recordIn(tx, { action: 'auth.password_reset_requested', result: 'success', actorUserId: user.id, ...requestMeta(req) });
      }
    });
    // Resposta idêntica exista ou não o e-mail (sem enumeração de contas).
    return reply.code(202).send({ message: 'Se o e-mail estiver cadastrado, enviaremos as instruções.' });
  });
}
