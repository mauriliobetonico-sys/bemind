import { describe, expect, it } from 'vitest';
import { createDemandInput, decideApprovalInput, summarizeCategories, DEMAND_MANUAL_TRANSITIONS } from './schemas/work';

describe('summarizeCategories', () => {
  it('monta o resumo em português com plural', () => {
    expect(summarizeCategories({ image: 11, video: 4, logo: 1, brand_manual: 1, catalog: 1 })).toBe(
      'Identifiquei: 11 imagens, 4 vídeos, 1 logo, 1 manual de marca e 1 catálogo.',
    );
    expect(summarizeCategories({})).toBe('Nenhum arquivo identificado.');
  });
});

describe('aprovações e demandas', () => {
  it('pedir alteração exige motivo', () => {
    expect(decideApprovalInput.safeParse({ decision: 'changes_requested' }).success).toBe(false);
    expect(decideApprovalInput.safeParse({ decision: 'changes_requested', reason: 'Trocar a foto' }).success).toBe(true);
    expect(decideApprovalInput.safeParse({ decision: 'approved' }).success).toBe(true);
  });
  it('demanda rejeita tenantId injetado', () => {
    expect(createDemandInput.safeParse({ type: 'post', title: 'Post', description: 'texto longo', tenantId: 'x' }).success).toBe(false);
  });
  it('estados finais não têm saída manual (exceto aprovada → entregue)', () => {
    expect(DEMAND_MANUAL_TRANSITIONS.delivered).toEqual([]);
    expect(DEMAND_MANUAL_TRANSITIONS.awaiting_approval).not.toContain('approved');
  });
});
