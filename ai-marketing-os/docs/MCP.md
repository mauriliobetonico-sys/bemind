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
| Adobe Firefly Services | Client ID + Client Secret (OAuth Server-to-Server) | `adobe.generate_image` (médio), `adobe.expand_image` (médio) — ver [Adobe Connector](#adobe-connector) |

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

## Adobe Connector

Regra da Fase 7: **somente interfaces oficiais e documentadas pela Adobe**. O contrato foi conferido nos pacotes oficiais publicados pela Adobe no npm (`@adobe/firefly-apis` — especificação OpenAPI da Firefly API — e `@adobe/firefly-services-common-apis` — autenticação). Capacidades sem API oficial aparecem como **indisponíveis**, com o motivo, no card da integração; nada é simulado.

| Capacidade | Status | Interface oficial / motivo |
| --- | --- | --- |
| Gerar imagens a partir de texto | disponível | `POST https://firefly-api.adobe.io/v3/images/generate` |
| Expandir imagem (mudar formato) | disponível | `POST /v2/storage/image` (upload) + `POST /v3/images/expand` |
| Photoshop API (remover fundo, máscaras, PSD) | indisponível | a API lê/grava em armazenamento de nuvem (S3, Azure, Dropbox) por URL pré-assinada; o storage atual é local — entra com o storage em nuvem |
| InDesign API | indisponível | mesma exigência de armazenamento em nuvem |
| Illustrator, Premiere Pro, After Effects | indisponível | sem API REST pública oficial para automação no servidor |

**Autenticação:** OAuth Server-to-Server — `POST https://ims-na1.adobelogin.com/ims/token/v3` com `grant_type=client_credentials`, `client_id`, `client_secret` e escopos (padrão `openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis`). Cada chamada à Firefly envia `Authorization: Bearer <token>` e `x-api-key: <client id>`. O token fica em cache em memória por conexão (renovado antes de expirar e, se a Adobe responder 401, uma vez na hora). "Testar conexão" só emite um token — **não consome créditos**.

**Resultados:** as imagens são baixadas das URLs pré-assinadas da Adobe (expiram em 1 h; HTTPS público, até 30 MB, tipo conferido pelo conteúdo: JPEG/PNG/WEBP) e gravadas como **arquivos internos** do cliente (`files.visibility = 'internal'`), vinculados à demanda quando informada; o cliente só vê depois que a equipe anexar a um entregável e enviar para aprovação. Na expansão, a origem precisa ser imagem do mesmo cliente, liberada pelo antivírus; o original não é alterado.

**Custos e repetição:** cada imagem consome créditos generativos do contrato Adobe da agência. Erros da Adobe 429/5xx/408 voltam à fila; 4xx (ex.: 403 sem direito ao Firefly) falham com orientação. Depois que a Adobe gerou as imagens, uma falha local ao baixar/salvar **não** é repetida automaticamente (repetir geraria e cobraria de novo) e não deixa arquivo órfão.

**Como obter as credenciais:** [Adobe Developer Console](https://developer.adobe.com/console) → criar projeto → *Add API* → **Firefly Services** (exige contrato Firefly Services/enterprise na organização Adobe) → credencial **OAuth Server-to-Server** → copiar *Client ID* e *Client Secret* → em Integrações, card "Adobe Firefly Services", conectar por cliente e clicar em "Testar conexão".

**Interface:** "Estúdio criativo" (`/creative`) gera e expande imagens para o cliente escolhido e mostra os resultados com miniaturas; o agente Designer pode propor as mesmas ferramentas (sempre com aprovação humana, por ser risco médio pedido por agente).
