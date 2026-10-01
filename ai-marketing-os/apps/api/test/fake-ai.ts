import type { AiProvider, ProviderRequest, ProviderResponse } from '../src/ai/provider';
import { ProviderRetryableError } from '../src/ai/provider';

/** Usage fixo por chamada: 1000 tokens de entrada + 500 de saída no Opus 5.5 = 14.000 µUSD. */
export const FAKE_COST_MICROS = 1000 * 4 + 500 * 20;

const userText = (req: ProviderRequest) =>
  req.messages
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');

/**
 * Provedor falso e determinístico: nenhum teste chama a API real (sem custo,
 * sem rede). Responde conforme a tarefa no system prompt e registra cada
 * requisição para os testes inspecionarem o que foi enviado ao modelo.
 */
export class FakeProvider implements AiProvider {
  readonly name = 'fake';
  configured = true;
  requests: ProviderRequest[] = [];
  /** Próximas respostas forçadas (ex.: recusa, erro transitório). */
  queue: ('refusal' | 'retryable')[] = [];

  async create(req: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(req);
    const forced = this.queue.shift();
    if (forced === 'retryable') throw new ProviderRetryableError('fake: sobrecarregado');
    const usage = [{ model: req.model, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }];
    if (forced === 'refusal') return { blocks: [], assistantContent: [], stopReason: 'refusal', model: req.model, usage };

    if (req.tools?.length) return this.chat(req, usage);
    const json = this.structured(req);
    const text = JSON.stringify(json);
    return { blocks: [{ type: 'text', text }], assistantContent: [{ type: 'text', text }], stopReason: 'end_turn', model: req.model, usage };
  }

  private structured(req: ProviderRequest): unknown {
    // Decide pela linha "Tarefa atual" (o objetivo do agente pode citar outras tarefas).
    const s = req.system.match(/^Tarefa atual: .*$/m)?.[0] ?? '';
    const u = userText(req);
    if (s.includes('montar o plano')) {
      return {
        summary: 'Campanha pedida pelo cliente.',
        missingInfo: ['Verba de mídia'],
        steps: [
          { agent: 'copywriter', title: 'Textos da campanha', instruction: 'Escreva 3 legendas.' },
          { agent: 'designer', title: 'Briefing visual', instruction: 'Especifique as peças.' },
        ],
        qaFocus: ['tom da marca'],
      };
    }
    if (s.includes('produzir o entregável') || s.includes('revisar o entregável conforme')) {
      const revised = u.includes('Parecer do QA');
      const designer = req.system.startsWith('Você é Designer');
      return {
        deliverableTitle: designer ? 'Briefing visual' : 'Legendas',
        content: designer ? 'Briefing visual: 1080x1350, cores da marca.' : revised ? 'Texto revisado com CTA.' : 'Primeira versão sem CTA.',
        notes: '',
        memoryProposals: revised ? [] : [{ kind: 'brand_rules', content: `Proposta do ${designer ? 'designer' : 'copywriter'}: usar tom próximo.` }],
      };
    }
    if (s.includes('revisar o entregável e decidir')) {
      const ok = /Texto revisado|Briefing visual: 1080/.test(u);
      return ok
        ? { approved: true, score: 92, issues: [], summary: 'Pronto para revisão humana.' }
        : { approved: true, score: 60, issues: [{ severity: 'major', item: 'copy', reason: 'Falta CTA' }], summary: 'Sem CTA.' };
    }
    if (s.includes('contribuir na reunião')) {
      return { content: `Minha sugestão: focar em conversão.`, memoryProposals: [] };
    }
    if (s.includes('redigir a ata')) {
      return {
        summary: 'Definimos o foco em conversão.',
        decisions: ['Priorizar reels'],
        tasks: [{ title: 'Roteirizar 3 reels', owner: 'Vídeo', dueDate: '2030-01-15' }],
        strategyChanges: ['Foco em conversão no trimestre'],
      };
    }
    throw new Error(`fake: tarefa desconhecida: ${s.slice(0, 120)}`);
  }

  private chat(req: ProviderRequest, usage: ProviderResponse['usage']): ProviderResponse {
    const last = req.messages[req.messages.length - 1]!;
    if (typeof last.content === 'string') {
      const block = { type: 'tool_use' as const, id: `tu_${this.requests.length}`, name: 'list_clients', input: {} };
      return { blocks: [block], assistantContent: [block], stopReason: 'tool_use', model: req.model, usage };
    }
    const result = (last.content as { content: string }[])[0]?.content ?? '';
    const count = (() => {
      try {
        return (JSON.parse(result) as unknown[]).length;
      } catch {
        return -1;
      }
    })();
    const text = `Você tem ${count} clientes.`;
    return { blocks: [{ type: 'text', text }], assistantContent: [{ type: 'text', text }], stopReason: 'end_turn', model: req.model, usage };
  }
}
