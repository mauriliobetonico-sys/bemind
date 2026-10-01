import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { loadEnv } from '../config/env';
import { AnthropicProvider } from './provider';
import { OpenAiEmbedder } from './embeddings';
import { costMicros } from './pricing';

/**
 * Verifica as chaves de IA com UMA chamada mínima (custo de frações de centavo):
 *   node dist/ai/ai-test-cli.mjs
 * Nunca imprime as chaves. Não grava nada no banco.
 */
const env = loadEnv();
let ok = true;

const provider = new AnthropicProvider(env);
if (!provider.configured) {
  console.log('Anthropic: integration_pending (ANTHROPIC_API_KEY ausente no ambiente do container).');
  ok = false;
} else {
  console.log(`Anthropic: chamando ${env.AI_MODEL} (fallback do servidor: ${env.AI_SERVER_FALLBACK ? 'ligado' : 'desligado'}; workspace: ${env.ANTHROPIC_WORKSPACE_ID ? 'definido' : 'não definido'})…`);
  try {
    const format = zodOutputFormat(z.object({ status: z.string(), idioma: z.string() }));
    const res = await provider.create({
      model: env.AI_MODEL,
      system: 'Responda no formato pedido.',
      messages: [{ role: 'user', content: 'Teste de integração do AI Marketing OS. Responda status "ok" e o idioma desta mensagem.' }],
      maxTokens: 2000,
      effort: 'low',
      jsonSchema: format.schema,
      timeoutMs: 60_000,
    });
    const text = res.blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const cost = res.usage.reduce((a, u) => a + costMicros(u), 0);
    if (res.stopReason !== 'end_turn') throw new Error(`stop_reason inesperado: ${res.stopReason}`);
    console.log(`Anthropic OK — modelo ${res.model}, resposta ${JSON.stringify(format.parse(text))}, custo ≈ US$ ${(cost / 1e6).toFixed(5)}`);
  } catch (err) {
    ok = false;
    console.error(`Anthropic FALHOU: ${(err as Error).message}`);
  }
}

const embedder = new OpenAiEmbedder(env);
if (!embedder.configured) {
  console.log('Embeddings (OpenAI): integration_pending — memória funciona sem busca semântica.');
} else {
  try {
    const [v] = await embedder.embed(['teste de embedding']);
    console.log(`Embeddings OK — ${env.EMBEDDING_MODEL}, ${v?.length} dimensões.`);
  } catch (err) {
    ok = false;
    console.error(`Embeddings FALHOU: ${(err as Error).message}`);
  }
}
process.exit(ok ? 0 : 1);
