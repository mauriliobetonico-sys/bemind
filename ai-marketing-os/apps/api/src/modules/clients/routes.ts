import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createClientInput, listClientsQuery, updateClientInput, uuidParam, type UpdateClientInput } from '@aimos/shared';
import type { AppContext } from '../../context';
import { withContext } from '../../db/pool';
import { conflict, isUniqueViolation, notFound, parse } from '../../lib/errors';
import { requestedTenant, requestMeta, requireAccess } from '../../security/plugin';
import { enqueue } from '../../outbox/outbox';
import {
  findClient,
  insertClient,
  insertClientEvent,
  listClientEvents,
  listClients,
  slugify,
  toClientDto,
  updateClient,
} from './repository';

export async function clientRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/clients', { config: { permission: 'clients:read' } }, async (req) => {
    const access = requireAccess(req);
    const query = parse(listClientsQuery, req.query);
    return withContext(ctx.pool, access.context('clients:read', requestedTenant(req)), (tx) => listClients(tx, query));
  });

  app.get('/clients/:id', { config: { permission: 'clients:read' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const row = await withContext(ctx.pool, access.context('clients:read', requestedTenant(req)), (tx) => findClient(tx, id));
    // Cliente de outro tenant e cliente inexistente são indistinguíveis.
    if (!row) throw notFound();
    return toClientDto(row);
  });

  app.get('/clients/:id/events', { config: { permission: 'clients:read' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    return withContext(ctx.pool, access.context('clients:read', requestedTenant(req)), async (tx) => {
      if (!(await findClient(tx, id))) throw notFound();
      return { items: await listClientEvents(tx, id) };
    });
  });

  /**
   * Criação de cliente = provisionamento do tenant, numa única transação:
   * tenant → cliente → histórico → usuário CLIENTE + associação → eventos
   * (convite por e-mail e CLIENTE CRIADO) → auditoria.
   */
  app.post('/clients', { config: { permission: 'tenants:manage' } }, async (req, reply) => {
    const access = requireAccess(req);
    const input = parse(createClientInput, req.body);
    const actor = access.principal.userId;
    const meta = requestMeta(req);

    try {
      const client = await withContext(ctx.pool, access.context('tenants:manage'), async (tx) => {
        const slug = `${slugify(input.tradeName)}-${randomBytes(3).toString('hex')}`;
        const tenantStatus = input.status === 'active' ? 'active' : 'onboarding';
        const tenant = (
          await tx.query<{ id: string }>(
            `INSERT INTO tenants (kind, name, slug, status, plan) VALUES ('client', $1, $2, $3, $4) RETURNING id`,
            [input.tradeName, slug, tenantStatus, input.plan],
          )
        ).rows[0]!;

        const row = await insertClient(tx, tenant.id, input, actor);
        await insertClientEvent(tx, { tenantId: tenant.id, clientId: row.id, actorUserId: actor, type: 'client.created' });

        let invitedUserId: string | null = null;
        if (input.inviteUser) {
          const existing = (
            await tx.query<{ id: string; status: string; global_role: string | null }>(
              'SELECT id, status, global_role FROM users WHERE email = $1',
              [input.email],
            )
          ).rows[0];
          if (existing?.global_role) throw conflict('Este e-mail pertence a um administrador da agência');
          const userId =
            existing?.id ??
            (
              await tx.query<{ id: string }>(`INSERT INTO users (email, name, status) VALUES ($1, $2, 'invited') RETURNING id`, [
                input.email,
                input.responsibleName,
              ])
            ).rows[0]!.id;
          await tx.query(
            `INSERT INTO tenant_users (tenant_id, user_id, role_key) VALUES ($1, $2, 'CLIENTE') ON CONFLICT DO NOTHING`,
            [tenant.id, userId],
          );
          if (!existing || existing.status === 'invited') {
            await enqueue(tx, {
              type: 'user.invite',
              tenantId: tenant.id,
              payload: { userId, template: 'client_welcome', clientId: row.id },
            });
          }
          invitedUserId = userId;
          await insertClientEvent(tx, {
            tenantId: tenant.id,
            clientId: row.id,
            actorUserId: actor,
            type: 'client.user_invited',
            data: { email: input.email },
          });
        }

        await enqueue(tx, { type: 'client.created', tenantId: tenant.id, payload: { clientId: row.id, invitedUserId } });
        await ctx.audit.recordIn(tx, {
          action: 'client.create',
          result: 'success',
          tenantId: tenant.id,
          actorUserId: actor,
          resourceType: 'client',
          resourceId: row.id,
          ...meta,
          metadata: { tradeName: input.tradeName, plan: input.plan, invitedUser: invitedUserId !== null },
        });
        return row;
      });
      return reply.code(201).send(toClientDto(client));
    } catch (err) {
      if (isUniqueViolation(err, 'clients_cnpj_key')) throw conflict('Já existe um cliente com este CNPJ');
      throw err;
    }
  });

  app.patch('/clients/:id', { config: { permission: 'clients:write' } }, async (req) => {
    const access = requireAccess(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateClientInput, req.body);
    const meta = requestMeta(req);

    try {
      const updated = await withContext(ctx.pool, access.context('clients:write', requestedTenant(req)), async (tx) => {
        const before = await findClient(tx, id, true);
        if (!before) throw notFound();
        const beforeDto = toClientDto(before);

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const [key, value] of Object.entries(input) as [keyof UpdateClientInput, unknown][]) {
          const prev = beforeDto[key as keyof typeof beforeDto];
          if (JSON.stringify(prev ?? null) !== JSON.stringify(value ?? null)) changes[key] = { from: prev ?? null, to: value ?? null };
        }
        if (Object.keys(changes).length === 0) return before;

        await updateClient(tx, id, input);
        await insertClientEvent(tx, { tenantId: before.tenant_id, clientId: id, actorUserId: access.principal.userId, type: 'client.updated', data: { changes } });
        await enqueue(tx, { type: 'client.updated', tenantId: before.tenant_id, payload: { clientId: id, fields: Object.keys(changes) } });
        await ctx.audit.recordIn(tx, {
          action: 'client.update',
          result: 'success',
          tenantId: before.tenant_id,
          actorUserId: access.principal.userId,
          resourceType: 'client',
          resourceId: id,
          ...meta,
          metadata: { fields: Object.keys(changes), financial: 'monthlyFeeCents' in changes },
        });
        return (await findClient(tx, id))!;
      });
      return toClientDto(updated);
    } catch (err) {
      if (isUniqueViolation(err, 'clients_cnpj_key')) throw conflict('Já existe um cliente com este CNPJ');
      throw err;
    }
  });
}
