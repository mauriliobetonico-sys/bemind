import { describe, expect, it } from 'vitest';
import { computeProposalTotals } from './schemas/commercial';

describe('computeProposalTotals', () => {
  const items = [
    { name: 'A', quantity: 1, unitPriceCents: 300000, recurrence: 'recurring' as const, description: null },
    { name: 'B', quantity: 1.5, unitPriceCents: 3333, recurrence: 'recurring' as const, description: null },
    { name: 'Setup', quantity: 1, unitPriceCents: 100000, recurrence: 'one_time' as const, description: null },
  ];
  it('arredonda itens ao centavo e separa recorrente de único', () => {
    const t = computeProposalTotals(items, 'none', 0);
    expect(t.items[1]!.totalCents).toBe(5000);
    expect(t.recurringTotalCents).toBe(305000);
    expect(t.oneTimeTotalCents).toBe(100000);
  });
  it('desconto nunca torna o recorrente negativo e não afeta o setup', () => {
    expect(computeProposalTotals(items, 'amount', 9_999_999).recurringTotalCents).toBe(0);
    expect(computeProposalTotals(items, 'percent', 100).oneTimeTotalCents).toBe(100000);
    expect(computeProposalTotals(items, 'percent', 10).discountCents).toBe(30500);
  });
});
