/**
 * Catálogo central de permissões e papéis do sistema.
 *
 * Fonte única da verdade: o script de migração sincroniza estes papéis e
 * permissões com as tabelas `roles`, `permissions` e `role_permissions`.
 * Em tempo de execução, a API lê as permissões do banco — papéis
 * personalizados (FINANCEIRO, DESIGNER, AUDITOR…) entram como dados.
 */

export const PERMISSIONS = {
  'platform:settings': 'Configurações globais da plataforma',
  'tenants:read': 'Listar e consultar tenants',
  'tenants:manage': 'Criar, suspender e arquivar tenants (inclui criar clientes)',
  'users:read': 'Consultar usuários',
  'users:manage': 'Criar usuários, alterar papéis e associações',
  'clients:read': 'Consultar dados cadastrais de clientes',
  'clients:write': 'Editar dados cadastrais de clientes',
  'dashboard:admin': 'Painel administrativo da agência',
  'dashboard:client': 'Painel do portal do cliente',
  'audit:read': 'Consultar trilha de auditoria',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_KEYS = ['SUPER_ADMIN', 'ADMIN', 'GESTOR', 'OPERADOR', 'CLIENTE'] as const;
export type SystemRoleKey = (typeof ROLE_KEYS)[number];

/** Papéis globais valem para todos os tenants; papéis de tenant valem por associação. */
export type RoleScope = 'global' | 'tenant';

export interface RoleDefinition {
  key: SystemRoleKey;
  name: string;
  scope: RoleScope;
  permissions: Permission[];
}

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super administrador',
    scope: 'global',
    permissions: ALL,
  },
  {
    key: 'ADMIN',
    name: 'Administrador da agência',
    scope: 'global',
    permissions: ALL.filter((p) => p !== 'platform:settings'),
  },
  {
    key: 'GESTOR',
    name: 'Gestor de contas',
    scope: 'tenant',
    permissions: ['clients:read', 'clients:write', 'users:read', 'dashboard:admin'],
  },
  {
    key: 'OPERADOR',
    name: 'Operador',
    scope: 'tenant',
    permissions: ['clients:read', 'dashboard:admin'],
  },
  {
    key: 'CLIENTE',
    name: 'Cliente',
    scope: 'tenant',
    permissions: ['clients:read', 'dashboard:client'],
  },
];

export const GLOBAL_ROLE_KEYS = SYSTEM_ROLES.filter((r) => r.scope === 'global').map((r) => r.key);
export const TENANT_ROLE_KEYS = SYSTEM_ROLES.filter((r) => r.scope === 'tenant').map((r) => r.key);

/** Papéis internos da agência (veem o painel administrativo). */
export const STAFF_ROLE_KEYS: readonly SystemRoleKey[] = ['SUPER_ADMIN', 'ADMIN', 'GESTOR', 'OPERADOR'];
