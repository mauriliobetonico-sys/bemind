import { describe, expect, it } from 'vitest';
import { addMonths, billingPeriod, monthlyValue } from '../src/modules/commercial/billing';

describe('períodos de cobrança', () => {
  it('fim de mês é respeitado (31/01 + 1 mês = 28 ou 29/02)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
  it('vencimento no dia de cobrança do mês do período, ou no seguinte se cair antes do início', () => {
    expect(billingPeriod('2026-10-01', 'monthly', 10, 0)).toEqual({ periodStart: '2026-10-01', periodEnd: '2026-10-31', dueDate: '2026-10-10' });
    expect(billingPeriod('2026-10-15', 'monthly', 10, 0).dueDate).toBe('2026-11-10');
    expect(billingPeriod('2026-10-15', 'quarterly', 20, 1)).toEqual({ periodStart: '2027-01-15', periodEnd: '2027-04-14', dueDate: '2027-01-20' });
  });
  it('MRR normaliza trimestral e anual', () => {
    expect(monthlyValue(300000, 'quarterly')).toBe(100000);
    expect(monthlyValue(1200000, 'yearly')).toBe(100000);
  });
});
