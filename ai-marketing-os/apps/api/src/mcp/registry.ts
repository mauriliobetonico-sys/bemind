import type { z } from 'zod';
import type { AgentKey, Permission, RiskLevel } from '@aimos/shared';
import type { AppContext } from '../context';
import type { Tx } from '../db/pool';

/**
 * Contratos do MCP Hub. Conectores e ferramentas são declarações; o Hub
 * aplica a política (conexão ativa, agente permitido, permissão, risco,
 * aprovação humana, rate limit, circuit breaker) antes de qualquer execução.
 */
export interface ConnectorField {
  name: string;
  label: string;
  type: 'text' | 'url' | 'password';
  secret: boolean;
  required: boolean;
  help?: string;
}

export interface ConnectionInfo {
  id: string;
  tenantId: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
}

export interface ConnectorDef {
  key: string;
  name: string;
  description: string;
  /** available: implementado; integration_pending: depende de credenciais/app oficial ainda não fornecidos. */
  availability: 'available' | 'integration_pending';
  /** O que falta para ativar (quando pendente) ou observações. */
  requirements?: string;
  /** Conectores internos não precisam de conexão configurada. */
  builtIn?: boolean;
  fields: ConnectorField[];
  /** Capacidades do produto e por que cada uma está (ou não) disponível. */
  capabilities?: { name: string; status: 'available' | 'unavailable'; note: string }[];
  /** Testa as credenciais sem efeito colateral. Devolve uma frase de diagnóstico. */
  test?(app: AppContext, conn: ConnectionInfo): Promise<string>;
}

export interface ToolExecContext {
  app: AppContext;
  tenantId: string;
  callId: string;
  connection: ConnectionInfo | null;
  /** Transação com RLS restrito ao tenant da chamada. */
  withTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface ToolResult {
  summary: string;
  data?: Record<string, unknown>;
}

export interface ToolDef<P = unknown> {
  name: string;
  connector: string;
  title: string;
  description: string;
  risk: RiskLevel;
  /** Agentes que podem PROPOR esta chamada (sempre passando pela política). */
  allowedAgents: AgentKey[];
  /** Permissão exigida de uma pessoa para acionar manualmente. */
  permission: Permission;
  params: z.ZodType<P>;
  rateLimitPerMinute: number;
  /** Aceita agendamento (executa a partir de um horário, depois da aprovação). */
  schedulable?: boolean;
  /** Tempo máximo de execução (padrão 60 s) — ex.: geração de imagem demora mais. */
  timeoutMs?: number;
  /** Validação de negócio no momento do pedido (ex.: entregável existe neste tenant). */
  validate?(tx: Tx, tenantId: string, params: P): Promise<{ deliverableId?: string } | void>;
  execute(ctx: ToolExecContext, params: P): Promise<ToolResult>;
}

export function defineTool<P>(def: ToolDef<P>): ToolDef<P> {
  return def;
}
