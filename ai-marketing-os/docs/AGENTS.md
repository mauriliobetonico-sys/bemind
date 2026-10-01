# Agentes de IA (arquitetura — implementação na Fase 4)

A IA aparece para o cliente como **uma equipe**, não como prompts. Nada nesta página está implementado ainda; ela define o contrato que a fase 4 vai seguir.

## Princípios

1. **Agentes são dados.** Cada agente é uma definição declarativa registrada em `packages/agents/definitions/*`; adicionar um agente não altera o núcleo.
2. **Tudo roda em fila.** Nenhuma execução de agente bloqueia uma requisição HTTP. O job carrega `tenant_id`; o worker reabre o contexto de RLS e revalida permissões antes de agir.
3. **Isolamento total.** Memória, conhecimento, embeddings e logs de execução têm `tenant_id` e RLS. Um agente só recebe contexto do tenant do job.
4. **Nada crítico sem humano.** Publicação, financeiro, exclusão, envio massivo, campanhas pagas e contratos exigem aprovação (HITL).
5. **Falha não vira sucesso.** Execução com erro nunca marca tarefa como concluída; retry com backoff, timeout, DLQ e status visível no Desk.

## Contrato de um agente

```ts
defineAgent({
  key: 'copywriter',
  identity: 'Copywriter sênior da equipe',
  objective: 'Textos, legendas, anúncios, headlines, CTAs, roteiros',
  allowedTools: ['brand_vault.search', 'memory.read'],
  forbiddenTools: ['social.publish', 'finance.*'],
  memoryScopes: ['brand_rules', 'operational'],
  permissions: ['work:read', 'deliverables:draft'],
  quality: ['ortografia', 'tom da marca', 'CTA claro'],
  limits: { maxTokens: 8000, maxCostCents: 40, timeoutMs: 120_000 },
  handoff: ['qa', 'designer'],
});
```

Campos obrigatórios: identidade, função, objetivo, ferramentas permitidas e proibidas, memória, contexto, permissões, critérios de qualidade, limites, logs (`agent_runs`) e handoff.

## Equipe

Master Orchestrator · Diretor de Marketing · Pesquisador · Copywriter · Social Media · Designer · Video Agent · Traffic Agent · Analytics Agent · Customer Success · Finance Agent · QA Agent.

## Orchestrator

Para uma demanda (“Quero uma campanha de Black Friday”): interpretar → consultar cliente, plano e Brand Vault → pedir o que falta → montar plano → convocar Pesquisador, Diretor, Copywriter, Designer, Vídeo → QA → pedir aprovação → registrar resultado → propor atualização de memória.

## AI Gateway

Abstração de provedor (modelos Claude por padrão), roteamento por tarefa, medição de tokens e custo em `ai_usage` (por cliente, agente, modelo, tarefa, projeto), orçamento por plano, timeout e retry. Conteúdo vindo de clientes, arquivos ou ferramentas entra no prompt **delimitado como dado**, nunca como instrução (proteção contra prompt injection). Chaves de API só no servidor.

## Memória

Por tenant: operacional, conhecimento, estratégica, regras da marca e experiência. Todo aprendizado entra como **proposto**, com origem (run, mensagem, arquivo); regras de marca e políticas só valem após aprovação humana. A interface permite consultar, corrigir, aprovar, rejeitar e ver a origem.

## QA

Checklists de copy, marca, fatos, design e objetivo. Reprovação devolve ao agente com o motivo e repete o QA. Nenhum entregável vai ao cliente sem QA quando o fluxo exigir.

## Agent Room

Reunião entre humanos e agentes com contexto do cliente; gera resumo, decisões, tarefas, responsáveis, prazos e mudanças de estratégia, armazenados em `agent_meetings`/`agent_messages`.
