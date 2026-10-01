# Agentes de IA (Fase 4 — implementado)

A IA aparece como **uma equipe**, não como prompts. Esta página descreve o que roda hoje.

## Princípios (todos aplicados no código)

1. **Agentes são dados.** Cada agente é uma definição declarativa em `apps/api/src/ai/agents.ts` (`defineAgent`). Adicionar um agente não muda gateway, fila, memória nem QA.
2. **Tudo roda em fila.** Nenhuma execução bloqueia uma requisição: a rota grava `agent_runs` + evento `agent.run` no outbox na mesma transação e responde `202`. O worker reivindica só execuções `queued`.
3. **Isolamento total.** Execuções, memória, reuniões, mensagens e consumo têm `tenant_id`, RLS forçado e FKs compostas. O worker monta o contexto numa transação restrita ao tenant do job.
4. **Nada crítico sem humano.** Agentes não têm ferramentas de escrita externa: produzem rascunhos, pareceres e propostas. Enviar ao cliente, aprovar memória e criar tarefas são cliques humanos.
5. **Falha não vira sucesso.** Recusa do modelo, resposta truncada ou fora do formato → `failed` com o motivo; sem chave/IA desligada/orçamento → `blocked`; erro transitório → volta à fila com backoff; execução presa → `failed` após 30 min. Botões *Repetir* e *Cancelar* na tela.

## Contrato de um agente

```ts
defineAgent({
  key: 'copywriter',
  identity: 'Copywriter sênior.',
  objective: 'Textos, legendas, anúncios, headlines, CTAs e roteiros no tom da marca.',
  allowedTools: ['client.profile', 'brand_vault.read', 'memory.read', 'demand.read'],
  memoryScopes: ['brand_rules', 'operational', 'experience'],
  quality: ['ortografia e gramática', 'tom da marca', 'CTA claro', 'sem promessas não autorizadas'],
  limits: { maxTokens: 16_000, effort: 'medium' },
  handoff: ['qa', 'designer'],
});
// forbiddenTools sempre inclui: social.publish, ads.spend, finance.*, email.send_bulk,
// files.delete, contracts.*, approvals.decide
```

## Equipe

Master Orchestrator · Diretor de Marketing · Pesquisador · Copywriter · Social Media · Designer · Vídeo · Tráfego · Analytics · Customer Success · Financeiro (consultivo, só no Agent Room) · QA.

Designer e Vídeo entregam briefing visual, especificações e roteiro; a geração de arte/vídeo final é integração pendente (fase 7, Adobe).

## Fluxo de uma demanda

```
Planejar com IA (ou auto-plano ao abrir a demanda)
  → Orchestrator: resumo, informações que faltam, 1–6 passos (agente + tarefa), pontos de QA
  → passo 1: especialista produz → entregável em RASCUNHO (agent_run_id)
       → QA da IA: nota, problemas por severidade
            reprovado (blocker/major) → volta ao especialista com o parecer (até 2 revisões)
            aprovado ou limite de revisões → próximo passo
  → … último passo → demanda "Em revisão (QA)" → a equipe revisa e envia ao cliente pelo fluxo normal
```

O contexto de cada agente: cadastro do cliente, Brand Vault, demanda + briefing, plano, entregáveis dos passos anteriores e **memória aprovada** nos escopos do agente.

## AI Gateway (`ai/gateway.ts`)

- Provedor: SDK oficial da Anthropic (`AnthropicProvider`), modelo `AI_MODEL` (padrão `claude-opus-5-5`), esforço por agente, streaming, cache automático de prompt.
- **Fallback do servidor** ligado por padrão (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): se o modelo recusar por política, a Anthropic refaz no modelo recomendado. Desligue com `AI_SERVER_FALLBACK=false`.
- Saída estruturada validada por Zod em todas as tarefas.
- Antes de chamar: chave configurada, IA ligada para o cliente, orçamento do mês. Depois: uma linha em `ai_usage` por tentativa (inclusive a do fallback), custo pela tabela de preços (modelo desconhecido é cobrado como o mais caro).
- Conteúdo de cliente entra delimitado como dado (`<demanda>`, `<memoria>`…), com as tags neutralizadas.

## Memória

Por cliente: operacional, conhecimento, estratégica, regras da marca e experiência. Agentes propõem (até 3 por execução); a ata da reunião propõe mudanças de estratégia. Tudo nasce **proposto**, com origem (execução → demanda/reunião). Gestores aprovam (com correção), rejeitam ou arquivam; só aprovadas entram nos prompts. Com `OPENAI_API_KEY`, as aprovadas ganham embedding e o contexto é ordenado por similaridade com a tarefa.

## Agent Room

Reunião entre a equipe e até 6 agentes, com contexto do cliente. Cada mensagem humana aciona respostas dos agentes escolhidos. Ao encerrar, o Orchestrator gera a ata: resumo, decisões, tarefas sugeridas (viram tarefas reais com um clique) e mudanças de estratégia (viram memória proposta).

## Chat Global

Assistente da agência para papéis globais (`ai:chat`). Conversas privadas por usuário, no tenant da agência. Ferramentas **somente leitura**, cada uma revalidando a permissão de quem perguntou: `list_clients`, `client_overview`, `list_open_demands`, `finance_summary`, `ai_usage_summary`, `client_memory`. O comando do Desk em linguagem natural abre uma conversa aqui.

## Custos e orçamento

- Tela **Orçamento de IA**: limite mensal em dólares, IA ligada e auto-plano por cliente; consumo por cliente, agente, finalidade e modelo.
- Rentabilidade: custo de IA do cliente convertido pela cotação configurada. O Chat Global é custo da agência (fora do rateio).
- Desk: execuções em andamento, com erro, concluídas, memória aguardando decisão e custo do mês.

## Testes

`apps/api/test/ai.test.ts` usa um provedor falso determinístico (`test/fake-ai.ts`) — nenhum teste chama a API real. Cobre o fluxo completo com revisão, isolamento (API, RLS, FK e conteúdo do prompt), memória, recusa, erro transitório, orçamento, auto-plano, Agent Room, Chat Global e `integration_pending`.
