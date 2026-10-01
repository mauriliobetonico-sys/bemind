import type pg from 'pg';
import type { Permission } from '@aimos/shared';
import { withContext, SYSTEM, type DbContext } from '../db/pool';
import { forbidden } from '../lib/errors';

export interface Membership {
  tenantId: string;
  tenantName: string;
  tenantKind: 'agency' | 'client';
  tenantStatus: string;
  roleKey: string;
}

export interface Principal {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  globalRole: string | null;
  memberships: Membership[];
}

/** Tenants suspensos ou arquivados não concedem acesso por associação. */
const INACTIVE_TENANT = new Set(['suspended', 'archived']);

/**
 * Resolve a cadeia USER → TENANT → ROLE → PERMISSION e produz o contexto de
 * banco (RLS) para cada operação. Nada aqui vem do corpo da requisição.
 */
export class Access {
  constructor(
    readonly principal: Principal,
    private readonly rolePermissions: ReadonlyMap<string, ReadonlySet<string>>,
  ) {}

  private roleHas(roleKey: string | null, permission: Permission): boolean {
    return !!roleKey && (this.rolePermissions.get(roleKey)?.has(permission) ?? false);
  }

  /** Permissão concedida por papel global (vale para todos os tenants). */
  hasGlobal(permission: Permission): boolean {
    return this.roleHas(this.principal.globalRole, permission);
  }

  /** Tenants em que alguma associação concede a permissão. */
  tenantIdsWith(permission: Permission): string[] {
    return this.principal.memberships
      .filter((m) => !INACTIVE_TENANT.has(m.tenantStatus) && this.roleHas(m.roleKey, permission))
      .map((m) => m.tenantId);
  }

  /** Verdadeiro se a permissão existe em algum escopo. */
  canAny(permission: Permission): boolean {
    return this.hasGlobal(permission) || this.tenantIdsWith(permission).length > 0;
  }

  can(permission: Permission, tenantId: string): boolean {
    return this.hasGlobal(permission) || this.tenantIdsWith(permission).includes(tenantId);
  }

  isStaff(): boolean {
    return this.principal.globalRole !== null || this.principal.memberships.some((m) => m.roleKey !== 'CLIENTE');
  }

  /**
   * Contexto de RLS para uma operação que exige `permission`.
   * - papel global: escopo global (ou restrito ao tenant pedido);
   * - associação: somente os tenants onde a permissão foi concedida.
   * Um tenant pedido fora desse conjunto gera 403.
   */
  context(permission: Permission, requestedTenantId?: string | null): DbContext {
    const userId = this.principal.userId;
    if (this.hasGlobal(permission)) {
      return requestedTenantId
        ? { scope: 'tenant', tenantIds: [requestedTenantId], userId }
        : { scope: 'global', userId };
    }
    const allowed = this.tenantIdsWith(permission);
    if (requestedTenantId) {
      if (!allowed.includes(requestedTenantId)) throw forbidden();
      return { scope: 'tenant', tenantIds: [requestedTenantId], userId };
    }
    if (allowed.length === 0) throw forbidden();
    return { scope: 'tenant', tenantIds: allowed, userId };
  }
}

/** Cache curto do mapa papel → permissões (lido do banco, não do código). */
export class RolePermissionCache {
  private cache: { at: number; map: Map<string, Set<string>> } | undefined;

  constructor(
    private readonly pool: pg.Pool,
    private readonly ttlMs = 60_000,
  ) {}

  async get(): Promise<Map<string, Set<string>>> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.map;
    const rows = await withContext(this.pool, SYSTEM, async (tx) =>
      (await tx.query<{ role_key: string; permission_key: string }>('SELECT role_key, permission_key FROM role_permissions')).rows,
    );
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!map.has(r.role_key)) map.set(r.role_key, new Set());
      map.get(r.role_key)!.add(r.permission_key);
    }
    this.cache = { at: Date.now(), map };
    return map;
  }

  invalidate(): void {
    this.cache = undefined;
  }
}
