import type { UsageEntry } from './provider';

/** Preço em USD por milhão de tokens (tabela pública da Anthropic). */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: [prefix: string, price: Price][] = [
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }],
];

/** Modelo desconhecido: cobra como o mais caro da tabela (nunca subestima o custo). */
const CONSERVATIVE: Price = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };

export function priceFor(model: string): Price {
  // Prefixo mais longo primeiro (claude-opus-5-5 antes de claude-opus-5).
  const match = [...PRICES].sort((a, b) => b[0].length - a[0].length).find(([p]) => model.startsWith(p));
  return match ? match[1] : CONSERVATIVE;
}

/** Custo em micro-dólares (inteiro, arredondado para cima). */
export function costMicros(u: UsageEntry): number {
  const p = priceFor(u.model);
  // USD/MTok × tokens = micro-dólares × 1 (1 USD/MTok = 1 µUSD/token)
  return Math.ceil(u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite);
}
