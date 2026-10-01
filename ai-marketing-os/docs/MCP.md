# MCP Hub (arquitetura — implementação na Fase 5)

Os agentes **não** se conectam diretamente a ferramentas externas. Toda chamada passa pelo MCP Hub, que aplica política, risco, aprovação humana, rate limit e auditoria. Até a fase 5 todas as integrações estão **“Integration pending”**.

## Fluxo

```
Agente ─► MCP Hub ─► política ─► (HITL se necessário) ─► conector ─► serviço externo
                          │
                          └─► mcp_tool_calls + audit_logs
```

Ordem de verificação: o tenant tem a conexão ativa? o agente pode usar a ferramenta? a ação é permitida? qual o risco? Risco `HIGH` gera um pedido de aprovação; nada executa até a decisão.

## Declaração de ferramenta

```ts
defineTool({
  name: 'PUBLICAR_INSTAGRAM',
  description: 'Publica post aprovado no perfil do cliente',
  connector: 'meta',
  allowedAgents: ['social_media'],
  actions: ['publish'],
  params: z.object({ deliverableId: z.string().uuid(), scheduledAt: z.string().datetime() }),
  riskLevel: 'HIGH',
  requiresHumanApproval: true,
});
```

Cada ferramenta declara: nome, descrição, tenants permitidos (via `mcp_connections`), agentes permitidos, ações, parâmetros (schema), nível de risco e necessidade de aprovação.

## Conexões

`mcp_connections` (por tenant): conector, escopos concedidos, credenciais cifradas (AES-256-GCM, chave fora do banco), status, último erro. Rate limit e circuit breaker por conector e por tenant.

## Integrações planejadas

Google Drive, Gmail, Google Calendar, Meta/Instagram/Facebook, WhatsApp, WordPress, Analytics, Ads, armazenamento, n8n, sistemas internos e APIs externas.

## Adobe Connector

Camada de conector dedicada para Photoshop, Illustrator, InDesign, Premiere e After Effects, adicionada sem alterar o núcleo. **Regra:** antes de implementar qualquer capacidade, verificar a documentação oficial da Adobe e usar somente interfaces oficialmente disponíveis (APIs/serviços documentados ou conectores autorizados). Capacidades sem API oficial não são simuladas — ficam marcadas como indisponíveis.
