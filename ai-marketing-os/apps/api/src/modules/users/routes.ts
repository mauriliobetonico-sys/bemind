import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createStaffUserInput, membershipInput, updateUserInput, uuidParam } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext } from '../../db/pool';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound, parse } from '../../lib/errors';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { enqueue } from '../../outbox/outbox';

interface UserRow {
  id: string;
  email: string;
  name: string;
  global_role: string | null;
  status: string;
  last_login_at: Date | null;
  created_at: Date;
  memberships: { tenantId: string; tenantName: string; roleKey: string }[];
}

const toUserDto = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  globalRole: u.global_role,
  status: u.status,
  lastLoginAt: u.last_login_at,
  createdAt: u.created_at,
  memberships: u.memberships,
});

// As associações visíveis também passam pelo RLS de tenant_users/tenants.
const SELECT_USERS = `
  SELECT u.id, u.email, u.name, u.global_role, u.status, u.last_login_at, u.created_at,
         coalesce(json_agg(json_build_object('tenantId', t.id, 'tenantName', t.name, 'roleKey', tu.role_key)
                  ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '[]') AS memberships
    FROM users u
    LEFT JOIN tenant_users tu ON tu.user_id = u.id
    LEFT JOIN tenants t ON t.id = tu.tenant_id`;

const membershipParams = z.strictObject({ id: z.uuid(), tenantId: z.uuid() });

export async function userRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/users', { config: { permission: 'users:read' } }, async (req) => {
    const access = requireAccess(req);
    const rows = await withContext(ctx.pool, access.context('users:read', requestedTenant(req)), async (tx) =>
      (await tx.query<UserRow>(`${SELECT_USERS} GROUP BY u.id ORDER BY u.name LIMIT 500`)).rows,
    );
    return { items: rows.map(toUserDto) };
  });

  app.post('/users', { config: { permission: 'users:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createStaffUserInput, req.body);
    // Somente SUPER_ADMIN cria outro SUPER_ADMIN.
    if (input.globalRole === 'SUPER_ADMIN' && access.principal.globalRole !== 'SUPER_ADMIN') throw forbidden();
    try {
      const user = await withContext(ctx.pool, access.context('users:manage'), async (tx) => {
        const row = (
          await tx.query<{ id: string }>(
            `INSERT INTO users (email, name, global_role, status) VALUES ($1, $2, $3, 'invited') RETURNING id`,
            [input.email, input.name, input.globalRole],
          )
        ).rows[0]!;
        await enqueue(tx, { type: 'user.invite', payload: { userId: row.id, template: 'staff_invite' } });
        await ctx.audit.recordIn(tx, {
          action: 'user.create',
          result: 'success',
          actorUserId: access.principal.userId,
          resourceType: 'user',
          resourceId: row.id,
          ...requestMeta(req),
          metadata: { email: input.email, globalRole: input.globalRole },
        });
        return (await tx.query<UserRow>(`${SELECT_USERS} WHERE u.id = $1 GROUP BY u.id`, [row.id])).rows[0]!;
      });
      return reply.code(201).send(toUserDto(user));
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_key')) throw conflict('Já existe um usuário com este e-mail');
      throw err;
    }
  });

  app.patch('/users/:id', { config: { permission: 'users:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateUserInput, req.body);
    const isSuper = access.principal.globalRole === 'SUPER_ADMIN';
    if (id === access.principal.userId && (input.status === 'disabled' || input.globalRole !== undefined)) {
      throw badRequest('Você não pode desativar ou alterar o próprio papel');
    }

    const user = await withContext(ctx.pool, access.context('users:manage'), async (tx) => {
      const target = (await tx.query<{ global_role: string | null }>('SELECT global_role FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!target) throw notFound();
      if (!isSuper && (target.global_role === 'SUPER_ADMIN' || input.globalRole === 'SUPER_ADMIN')) throw forbidden();

      const sets: string[] = [];
      const params: unknown[] = [id];
      if (input.name !== undefined) sets.push(`name = $${params.push(input.name)}`);
      if (input.status !== undefined) sets.push(`status = $${params.push(input.status)}`);
      if (input.globalRole !== undefined) sets.push(`global_role = $${params.push(input.globalRole)}`);
      await tx.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);

      await ctx.audit.recordIn(tx, {
        action: input.globalRole !== undefined ? 'user.role_change' : 'user.update',
        result: 'success',
        actorUserId: access.principal.userId,
        resourceType: 'user',
        resourceId: id,
        ...requestMeta(req),
        metadata: { ...input, previousGlobalRole: target.global_role },
      });
      return (await tx.query<UserRow>(`${SELECT_USERS} WHERE u.id = $1 GROUP BY u.id`, [id])).rows[0]!;
    });
    // Mudança de acesso derruba as sessões abertas do usuário (tabela de sessões: escopo system).
    if (input.status === 'disabled' || input.globalRole !== undefined) await ctx.sessions.revokeAllForUser(id);
    return toUserDto(user);
  });

  app.put('/users/:id/memberships', { config: { permission: 'users:manage' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(membershipInput, req.body);
    await withContext(ctx.pool, access.context('users:manage'), async (tx) => {
      const user = (await tx.query<{ global_role: string | null }>('SELECT global_role FROM users WHERE id = $1', [id])).rows[0];
      if (!user) throw notFound();
      const tenant = (await tx.query<{ kind: string }>('SELECT kind FROM tenants WHERE id = $1', [input.tenantId])).rows[0];
      if (!tenant) throw notFound('Tenant não encontrado');
      if (input.roleKey === 'CLIENTE' && user.global_role) throw badRequest('Administradores não podem ser usuários CLIENTE');
      await tx.query(
        `INSERT INTO tenant_users (tenant_id, user_id, role_key) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_key = EXCLUDED.role_key`,
        [input.tenantId, id, input.roleKey],
      );
      await ctx.audit.recordIn(tx, {
        action: 'user.membership_set',
        result: 'success',
        tenantId: input.tenantId,
        actorUserId: access.principal.userId,
        resourceType: 'user',
        resourceId: id,
        ...requestMeta(req),
        metadata: { roleKey: input.roleKey },
      });
    });
    return { ok: true };
  });

  app.delete('/users/:id/memberships/:tenantId', { config: { permission: 'users:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id, tenantId } = parse(membershipParams, req.params);
    await withContext(ctx.pool, access.context('users:manage'), async (tx) => {
      const removed = await tx.query('DELETE FROM tenant_users WHERE user_id = $1 AND tenant_id = $2', [id, tenantId]);
      if (removed.rowCount === 0) throw notFound();
      await ctx.audit.recordIn(tx, {
        action: 'user.membership_removed',
        result: 'success',
        tenantId,
        actorUserId: access.principal.userId,
        resourceType: 'user',
        resourceId: id,
        ...requestMeta(req),
      });
    });
    return reply.code(204).send();
  });

  app.post('/users/:id/resend-invite', { config: { permission: 'users:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    await withContext(ctx.pool, access.context('users:manage'), async (tx) => {
      const user = (
        await tx.query<{ status: string; tenant_id: string | null; client_id: string | null }>(
          `SELECT u.status, c.tenant_id, c.id AS client_id
             FROM users u
             LEFT JOIN tenant_users tu ON tu.user_id = u.id AND tu.role_key = 'CLIENTE'
             LEFT JOIN clients c ON c.tenant_id = tu.tenant_id
            WHERE u.id = $1 LIMIT 1`,
          [id],
        )
      ).rows[0];
      if (!user) throw notFound();
      if (user.status !== 'invited') throw badRequest('O usuário já ativou o acesso');
      await enqueue(tx, {
        type: 'user.invite',
        tenantId: user.tenant_id,
        payload: user.client_id ? { userId: id, template: 'client_welcome', clientId: user.client_id } : { userId: id, template: 'staff_invite' },
      });
      await ctx.audit.recordIn(tx, { action: 'user.invite_resent', result: 'success', actorUserId: access.principal.userId, resourceType: 'user', resourceId: id, ...requestMeta(req) });
    });
    return reply.code(202).send({ ok: true });
  });
}
