import type { FastifyRequest } from 'fastify';
import type { Permission } from '@aimos/shared';
import type { DbContext, Tx } from '../../db/pool';
import { badRequest } from '../../lib/errors';
import type { Access } from '../../security/access';
import { requestedTenant } from '../../security/plugin';

/**
 * Contexto de UM tenant, exigido para criar recursos. Usuário com um único
 * tenant autorizado não precisa informar nada; quem atende vários (equipe)
 * escolhe o cliente pelo header X-Tenant-Id — validado por Access.context().
 */
export function singleTenantContext(access: Access, permission: Permission, req: FastifyRequest): DbContext & { tenantId: string } {
  const ctx = access.context(permission, requestedTenant(req));
  if (ctx.scope === 'tenant' && ctx.tenantIds?.length === 1) return { ...ctx, tenantId: ctx.tenantIds[0]! };
  throw badRequest('Selecione o cliente (header X-Tenant-Id)');
}

/** Registra uma atividade na linha do tempo do cliente (client_events) do tenant. */
export async function recordActivity(
  tx: Tx,
  e: { tenantId: string; actorUserId: string | null; type: string; data?: Record<string, unknown> },
): Promise<void> {
  await tx.query(
    `INSERT INTO client_events (tenant_id, client_id, actor_user_id, type, data)
     SELECT c.tenant_id, c.id, $2, $3, $4 FROM clients c WHERE c.tenant_id = $1`,
    [e.tenantId, e.actorUserId, e.type, JSON.stringify(e.data ?? {})],
  );
}

/**
 * Responsável por uma tarefa precisa ser da equipe com acesso ao tenant
 * (associação GESTOR/OPERADOR ou papel global). Nunca um usuário de outro cliente.
 */
export async function assertAssignable(tx: Tx, tenantId: string, userId: string): Promise<void> {
  const ok = (
    await tx.query(
      `SELECT 1 FROM users u
        WHERE u.id = $2 AND u.status = 'active'
          AND (u.global_role IN ('SUPER_ADMIN', 'ADMIN')
               OR EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.user_id = u.id AND tu.tenant_id = $1 AND tu.role_key <> 'CLIENTE'))`,
      [tenantId, userId],
    )
  ).rowCount;
  if (!ok) throw badRequest('Responsável inválido para este cliente');
}

/** Colunas atualizáveis: mapa fechado campo → coluna (nada fora dele vira SQL). */
export function buildUpdate(input: Record<string, unknown>, columns: Record<string, string>, firstParam = 2) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(input)) {
    const col = columns[key];
    if (!col || value === undefined) continue;
    params.push(value);
    sets.push(`${col} = $${firstParam + params.length - 1}`);
  }
  return { sets, params };
}

export const dateOnly = (col: string, alias: string) => `to_char(${col}, 'YYYY-MM-DD') AS "${alias}"`;
