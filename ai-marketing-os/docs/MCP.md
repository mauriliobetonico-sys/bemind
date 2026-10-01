# MCP Hub (Fase 5 — implementado)

Agentes e pessoas **não** se conectam diretamente a serviços externos. Toda ação passa pelo MCP Hub (`apps/api/src/mcp/`), que aplica política, risco, aprovação humana, limite por minuto, circuit breaker e auditoria.

## Fluxo

```
Agente (proposta) ─┐
                   ├─► Hub: ferramenta ligada? integração disponível e conectada NESTE cliente?
Pessoa (botão) ────┘         quem pede pode usar? parâmetros válidos? regra de negócio ok?
                              │
                 risco/quem pede decide:  LOW → fila   MEDIUM+pessoa → fila
                                          MEDIUM+agente → aprovação   HIGH → SEMPRE aprovação
                              │
            aprovação humana (mcp:approve) ──► fila (outbox) ──► worker revalida tudo
                                                                 (política, conexão, circuito, limite)
                                                                 ──► conector ──► serviço externo
                              └─► mcp_tool_calls + audit_logs (pedido, decisão, execução)
```

A execução externa **nunca** roda dentro de uma requisição HTTP nem dentro da transação da decisão: aprovar só coloca na fila.

## Garantias de "risco alto nunca executa sem aprovação"

1. Regra no código (`needsApproval`): HIGH sempre exige aprovação, não configurável.
2. CHECK no banco: `risk <> 'HIGH' OR requires_approval` e "exige aprovação ⇒ só sai de `pending_approval` com `decided_by`".
3. O worker só reivindica chamadas `queued` e confere `decided_by` antes de executar.
4. Teste de mutação: removendo a regra do código, 3 testes falham e o banco recusa a gravação.

## Declaração de ferramenta

```ts
defineTool({
  name: 'wordpress.publish_post',
  connector: 'wordpress',
  title: 'Publicar no WordPress',
  risk: 'HIGH',
  allowedAgents: ['social_media'],       // agentes que podem PROPOR
  permission: 'mcp:use',                 // permissão de quem aciona manualmente
  params: z.strictObject({ deliverableId: z.uuid() }),
  rateLimitPerMinute: 5,
  validate: async (tx, tenantId, p) => { /* entregável existe NESTE cliente e foi aprovado */ },
  execute: async (ctx, p) => { /* chamada real ao serviço */ },
});
```

Adicionar uma integração = um arquivo em `mcp/connectors/` + registro em `mcp/catalog.ts`. O Hub não muda.

## Integrações

| Conector | Status | Ferramentas (risco) |
| --- | --- | --- |
| Sistema interno | sempre disponível | `internal.create_task` (baixo), `internal.schedule_event` (baixo, evento interno) |
| E-mail para o cliente | ativar por cliente | `email.send_to_client` (alto) — destinatários definidos pelo servidor (usuários do portal), nunca por quem pede |
| Webhook / n8n | configurar URL + segredo | `webhook.trigger` (médio) — corpo assinado `X-AIMOS-Signature: sha256=HMAC(segredo, timestamp.corpo)` |
| WordPress | URL + usuário + senha de aplicativo | `wordpress.create_draft` (médio), `wordpress.publish_post` (alto, só entregável aprovado pelo cliente; atualiza o rascunho já criado) |
| Meta, Google Workspace, GA4, Ads, WhatsApp | **integration pending** | dependem de app/credenciais oficiais (OAuth, revisão de app) |
| Adobe | **integration pending** | Fase 7, somente APIs oficiais |

O conteúdo publicado vem sempre do entregável no banco (Markdown convertido com escape de HTML; as "Observações do agente" são removidas) — nunca de texto livre de quem pede.

## Conexões e credenciais

- `mcp_connections` por cliente: configuração não secreta em `config`; segredos em `secret_ciphertext` cifrado com **AES-256-GCM**, chave em `CREDENTIALS_KEY` (fora do banco), AAD = tenant + conexão (copiar o texto cifrado para outra linha não decifra).
- Segredos nunca voltam pela API (só `hasSecret`), nunca vão para logs ou auditoria (só os nomes dos campos alterados).
- Só papéis globais com `mcp:manage` conectam, testam, desligam ou removem. Remover cancela chamadas que ainda não rodaram.

## Resiliência

- **Limite por minuto** por ferramenta e cliente: excedeu, volta à fila com backoff.
- **Circuit breaker**: 5 falhas seguidas de rede/5xx abrem o circuito da conexão por 10 min (status "com erro"); chamadas aguardam sem bater no serviço. Um sucesso ou teste bem-sucedido fecha o circuito.
- Erros transitórios (rede, 5xx, 429, timeout) voltam à fila; definitivos (4xx, regra de negócio) viram `failed` com o motivo.

## Segurança de rede (SSRF)

Cliente HTTP próprio (`mcp/http.ts`): só http(s); HTTPS obrigatório para hosts públicos; IP validado **no momento da conexão** (protege contra DNS rebinding); bloqueia redes privadas, loopback, link-local (inclui `169.254.169.254`), CGNAT e multicast; não segue redirecionamentos; limita tamanho e tempo. `MCP_ALLOW_PRIVATE_HOSTS=true` libera endereços internos (ex.: n8n na mesma rede) — use só se precisar.

## Agentes

No prompt, cada agente recebe só as ferramentas permitidas a ele **e** conectadas no cliente, com o JSON Schema dos parâmetros. Ele pode propor até 3 ações (`actionRequests`) na primeira versão de um entregável ou numa resposta do Agent Room; para o entregável que está produzindo usa `"deliverableId": "ESTE_ENTREGAVEL"`. Cada proposta passa pelo Hub como qualquer pedido; recusas da política ficam registradas na execução do agente.
