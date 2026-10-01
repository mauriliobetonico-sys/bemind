import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../config/env';

/**
 * Fronteira com o provedor de modelos. O restante do sistema só conhece
 * estes tipos — trocar/adicionar provedor (ou usar um falso nos testes)
 * não muda agentes, metering nem orçamento.
 */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/**
 * Mensagem enviada ao provedor. O conteúdo de turnos do assistente é
 * devolvido sem alteração (opaco), preservando blocos de raciocínio exigidos
 * no loop de ferramentas.
 */
export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string | ToolResultBlock[] | unknown[];
}

export interface ProviderRequest {
  model: string;
  system: string;
  messages: ProviderMessage[];
  maxTokens: number;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** JSON Schema para saída estruturada (output_config.format). */
  jsonSchema?: Record<string, unknown>;
  tools?: ToolSpec[];
  timeoutMs: number;
}

export interface UsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ProviderResponse {
  /** Blocos de texto e de chamada de ferramenta, em ordem. */
  blocks: (TextBlock | ToolUseBlock)[];
  /** Conteúdo bruto do assistente, para reenviar no próximo turno. */
  assistantContent: unknown[];
  stopReason: string | null;
  model: string;
  /** Uma entrada por tentativa cobrada (inclui fallback do servidor). */
  usage: UsageEntry[];
}

export interface AiProvider {
  readonly name: string;
  readonly configured: boolean;
  create(req: ProviderRequest): Promise<ProviderResponse>;
}

/** Erro do provedor que vale nova tentativa (fila com backoff). */
export class ProviderRetryableError extends Error {}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly configured: boolean;
  private client: Anthropic | null;

  constructor(private readonly env: Env) {
    this.configured = !!env.ANTHROPIC_API_KEY;
    this.client = env.ANTHROPIC_API_KEY
      ? new Anthropic({
          apiKey: env.ANTHROPIC_API_KEY,
          maxRetries: 2,
          // Chave da organização (não de um workspace): a API exige dizer qual workspace usar.
          ...(env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } } : {}),
        })
      : null;
  }

  async create(req: ProviderRequest): Promise<ProviderResponse> {
    if (!this.client) throw new Error('integration_pending: ANTHROPIC_API_KEY não configurada');
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      // Cache automático do maior prefixo estável (system + ferramentas + histórico).
      cache_control: { type: 'ephemeral' },
      system: req.system,
      messages: req.messages as Anthropic.Beta.BetaMessageParam[],
      output_config: {
        effort: req.effort,
        ...(req.jsonSchema ? { format: { type: 'json_schema' as const, schema: req.jsonSchema } } : {}),
      },
      ...(req.tools?.length
        ? { tools: req.tools.map((t) => ({ ...t, strict: true })) as Anthropic.Beta.BetaToolUnion[] }
        : {}),
      ...(this.env.AI_SERVER_FALLBACK ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    };
    let msg: Anthropic.Beta.BetaMessage;
    try {
      // Streaming evita timeout de requisição em respostas longas.
      msg = await this.client.beta.messages.stream(params, { timeout: req.timeoutMs }).finalMessage();
    } catch (err) {
      if (
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError
      ) {
        throw new ProviderRetryableError(`anthropic: ${(err as Error).message}`);
      }
      if (err instanceof Anthropic.APIError) {
        // 529 (overloaded) também é transitório.
        if (err.status === 529) throw new ProviderRetryableError('anthropic: sobrecarregado');
        throw new Error(`anthropic ${err.status ?? ''}: ${err.message}`);
      }
      throw err;
    }

    const blocks: (TextBlock | ToolUseBlock)[] = [];
    for (const b of msg.content) {
      if (b.type === 'text') blocks.push({ type: 'text', text: b.text });
      else if (b.type === 'tool_use') blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
    }
    const iterations = msg.usage.iterations ?? [];
    const usage: UsageEntry[] = iterations.length
      ? iterations
          .filter((i) => 'input_tokens' in i)
          .map((i) => {
            const it = i as { model?: string | null; input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
            return {
              model: it.model ?? msg.model,
              inputTokens: it.input_tokens ?? 0,
              outputTokens: it.output_tokens ?? 0,
              cacheReadTokens: it.cache_read_input_tokens ?? 0,
              cacheWriteTokens: it.cache_creation_input_tokens ?? 0,
            };
          })
      : [
          {
            model: msg.model,
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
            cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
          },
        ];
    return { blocks, assistantContent: msg.content as unknown[], stopReason: msg.stop_reason, model: msg.model, usage };
  }
}
