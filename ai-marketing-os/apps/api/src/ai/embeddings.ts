import type { Env } from '../config/env';

/**
 * Embeddings para busca semântica na memória do cliente. A Anthropic não
 * oferece API de embeddings; usamos a OpenAI SOMENTE para isso, quando a
 * chave existir. Sem chave, a memória funciona por recência/tipo
 * (status "integration_pending" na tela).
 */
export interface Embedder {
  readonly configured: boolean;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_DIMENSIONS = 1536;

export class OpenAiEmbedder implements Embedder {
  readonly configured: boolean;
  readonly model: string;

  constructor(private readonly env: Env) {
    this.configured = !!env.OPENAI_API_KEY;
    this.model = env.EMBEDDING_MODEL;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.env.OPENAI_API_KEY) throw new Error('integration_pending: OPENAI_API_KEY não configurada');
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts.map((t) => t.slice(0, 8000)), dimensions: EMBEDDING_DIMENSIONS }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      // A mensagem da OpenAI ajuda a diagnosticar (ela já mascara a chave).
      let detail = '';
      try {
        detail = ((await res.json()) as { error?: { message?: string } }).error?.message?.slice(0, 300) ?? '';
      } catch {
        /* corpo não-JSON */
      }
      throw new Error(`embeddings: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

export const toVectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
