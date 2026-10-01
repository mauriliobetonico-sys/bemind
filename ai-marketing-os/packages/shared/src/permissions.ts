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
  'work:read': 'Ver projetos, demandas, entregáveis e calendário',
  'work:manage': 'Planejar e produzir: projetos, briefings, entregáveis, eventos',
  'tasks:read': 'Ver tarefas internas da equipe',
  'tasks:write': 'Criar e atualizar tarefas internas',
  'demands:create': 'Abrir novas demandas',
  'files:read': 'Ver e baixar arquivos',
  'files:write': 'Enviar arquivos e organizar o Brand Vault',
  'files:delete': 'Excluir arquivos',
  'approvals:request': 'Enviar entregáveis para aprovação do cliente',
  'approvals:decide': 'Aprovar ou pedir alteração em entregáveis',
  'proposals:read': 'Ver propostas comerciais',
  'proposals:write': 'Criar, editar e enviar propostas',
  'contracts:read': 'Ver contratos',
  'contracts:write': 'Criar e alterar contratos',
  'finance:read': 'Ver faturas, pagamentos, despesas e rentabilidade',
  'finance:write': 'Registrar pagamentos e despesas, emitir faturas',
  'finance:approve': 'Aprovar ações financeiras críticas (HITL)',
  'billing:read': 'Ver o próprio contrato e as próprias faturas (portal)',
  'ai:read': 'Ver execuções de agentes, Agent Room e memória do cliente',
  'ai:run': 'Acionar agentes de IA e conversar no Agent Room',
  'ai:memory_approve': 'Aprovar, corrigir ou rejeitar memória e regras de marca propostas',
  'ai:settings': 'Orçamento e configurações de IA por cliente',
  'ai:chat': 'Chat Global da agência com ferramentas internas',
  'mcp:read': 'Ver integrações e chamadas de ferramentas',
  'mcp:use': 'Acionar ferramentas de integração (risco baixo e médio)',
  'mcp:approve': 'Aprovar ou rejeitar chamadas de ferramenta que exigem decisão humana',
  'mcp:manage': 'Conectar, configurar e desligar integrações e políticas de ferramenta',
  'reports:read': 'Ver relatórios diários',
  'reports:manage': 'Gerar e reenviar relatórios diários e configurar o envio por cliente',
  'workflows:manage': 'Criar e alterar workflows de automação',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_KEYS = ['SUPER_ADMIN', 'ADMIN', 'FINANCEIRO', 'GESTOR', 'OPERADOR', 'CLIENTE'] as const;
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
    permissions: ALL.filter((p) => p !== 'approvals:decide' && p !== 'billing:read'),
  },
  {
    key: 'ADMIN',
    name: 'Administrador da agência',
    scope: 'global',
    permissions: ALL.filter((p) => p !== 'platform:settings' && p !== 'approvals:decide' && p !== 'billing:read'),
  },
  {
    key: 'FINANCEIRO',
    name: 'Financeiro',
    scope: 'global',
    permissions: ['clients:read', 'proposals:read', 'contracts:read', 'contracts:write', 'finance:read', 'finance:write'],
  },
  {
    key: 'GESTOR',
    name: 'Gestor de contas',
    scope: 'tenant',
    permissions: [
      'clients:read', 'clients:write', 'users:read', 'dashboard:admin',
      'work:read', 'work:manage', 'tasks:read', 'tasks:write', 'demands:create',
      'files:read', 'files:write', 'files:delete', 'approvals:request',
      'proposals:read', 'proposals:write', 'contracts:read',
      'ai:read', 'ai:run', 'ai:memory_approve',
      'mcp:read', 'mcp:use', 'mcp:approve', 'reports:read', 'reports:manage',
    ],
  },
  {
    key: 'OPERADOR',
    name: 'Operador',
    scope: 'tenant',
    permissions: [
      'clients:read', 'dashboard:admin', 'work:read', 'work:manage', 'tasks:read', 'tasks:write',
      'files:read', 'files:write', 'approvals:request', 'ai:read', 'ai:run', 'mcp:read', 'mcp:use', 'reports:read',
    ],
  },
  {
    key: 'CLIENTE',
    name: 'Cliente',
    scope: 'tenant',
    permissions: ['clients:read', 'dashboard:client', 'work:read', 'demands:create', 'files:read', 'files:write', 'approvals:decide', 'billing:read', 'reports:read'],
  },
];

export const GLOBAL_ROLE_KEYS = SYSTEM_ROLES.filter((r) => r.scope === 'global').map((r) => r.key);
export const TENANT_ROLE_KEYS = SYSTEM_ROLES.filter((r) => r.scope === 'tenant').map((r) => r.key);

/** Papéis internos da agência (veem o painel administrativo). */
export const STAFF_ROLE_KEYS: readonly SystemRoleKey[] = ['SUPER_ADMIN', 'ADMIN', 'FINANCEIRO', 'GESTOR', 'OPERADOR'];
