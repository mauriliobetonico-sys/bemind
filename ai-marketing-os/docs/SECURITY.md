# Segurança

Prioridade máxima: **nenhum cliente pode ver, baixar, editar ou inferir dados de outro cliente** — garantido no backend e no banco, nunca só na interface.

## Isolamento multi-tenant (defesa em profundidade)

| Camada | Mecanismo | Onde |
| --- | --- | --- |
| API | Sessão → associações do banco → permissão por rota → contexto restrito aos tenants autorizados | `security/plugin.ts`, `security/access.ts` |
| Repositório | Todo acesso a dados roda em `withContext(pool, ctx, fn)`; não há caminho sem contexto | `db/pool.ts` |
| PostgreSQL | `ENABLE` + `FORCE ROW LEVEL SECURITY` em toda tabela de tenant; role `aimos_app` sem SUPERUSER/BYPASSRLS e sem posse das tabelas; contexto via `SET LOCAL` (morre com a transação) | `migrations/0001_core.sql` |
| Integridade | FKs compostas `(tenant_id, id)` impedem referência cruzada mesmo em escopo global | `client_events` e próximas tabelas filhas |

Escopos de contexto (`app.scope`): `system` (autenticação, provisionamento, worker), `global` (SUPER_ADMIN/ADMIN verificados), `tenant` (lista validada em `app.tenant_ids`). Sem contexto, nenhuma linha é visível.

Nunca se confia em IDs do frontend, campos hidden, `localStorage` ou parâmetros de URL: corpos são validados com `z.strictObject` (campos extras → 400), `tenantId` nunca é aceito no corpo e o header de tenant só estreita o escopo.

**Respostas não vazam existência:** recurso de outro tenant responde exatamente como recurso inexistente (404).

## Autenticação

- Senhas com **argon2id** (m=19 MiB, t=2, p=1). Mínimo de 12 caracteres.
- Sessão: token opaco de 256 bits em cookie `__Host-aimos_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`). O banco guarda só o SHA-256.
- Expiração absoluta (`SESSION_TTL_HOURS`) e por ociosidade (`SESSION_IDLE_MINUTES`).
- Revogação imediata no logout, troca de senha, desativação e mudança de papel.
- Bloqueio após `LOGIN_MAX_FAILURES` falhas por `LOGIN_LOCK_MINUTES`; resposta idêntica para e-mail inexistente, senha errada e conta bloqueada; verificação de hash fictícia para igualar tempo.
- Convite e recuperação: link de uso único com expiração, gerado no envio, invalidando links anteriores. **Nenhuma senha é enviada por e-mail.** O primeiro SUPER_ADMIN também é criado por link (`seed:admin`).

## CSRF, XSS, injeção

- CSRF: token aleatório por sessão (hash no banco), enviado em `X-CSRF-Token` em toda requisição que altera estado, mais checagem de `Origin`.
- XSS: React escapa saída; CSP restritiva no web e `default-src 'none'` na API; e-mails escapam todo dado dinâmico. *Pendência conhecida:* o Next.js exige `script-src 'unsafe-inline'` sem CSP por nonce — migrar para nonce na fase 8.
- SQL injection: 100% das consultas parametrizadas; nomes de coluna em UPDATE vêm de mapas fechados; `LIKE` com escape de curingas.
- Erros 500 nunca expõem stack ou mensagem interna; logs mascaram cookie, authorization e CSRF.

## Rate limiting

Global por IP (`RATE_LIMIT_PER_MINUTE`, Redis em produção) e específico para login/definição/recuperação de senha (`AUTH_RATE_PER_MINUTE`). Na fase 5: por tenant e por agente no MCP Hub.

## Auditoria

`audit_logs`: usuário, ação, tenant, recurso, IP, user-agent, resultado (`success`/`denied`/`failure`) e metadados com chaves sensíveis mascaradas. O role da aplicação só tem `SELECT, INSERT` — **append-only**. Registrado hoje: login/logout, falhas e bloqueios, negações de permissão, CSRF rejeitado, convite aceito, redefinição de senha, criação/alteração de cliente (marca alteração financeira), criação/alteração de usuário e papel, associações, status de tenant.

## Human-in-the-loop

Arquitetura prevista (fases 3–5): ações `HIGH` (publicação, alteração financeira, exclusão, envio massivo, campanha paga, contrato) geram pedido de aprovação; nada executa até a decisão humana; a política é configurável por tenant.

## Segredos e infraestrutura

- Segredos apenas em variáveis de ambiente / secret manager; `.env` fora do Git; nenhuma chave no frontend.
- Tokens de integração (fase 5) cifrados em repouso com AES-256-GCM.
- HTTPS com TLS automático (Caddy) e HSTS.
- Uploads (fase 2): allowlist de MIME por conteúdo, limite de tamanho, ClamAV quando disponível, chaves `tenants/{id}/…`, download apenas por URL assinada curta após checagem.
- Backups diários com retenção configurável — ver [DEPLOYMENT.md](DEPLOYMENT.md#backup-e-restauração).

## Arquivos (Fase 2)

- Caminho no disco: `tenants/{tenant}/{id}` com IDs validados como UUID — o nome enviado nunca entra no caminho; nomes exibidos são saneados.
- Tipo detectado pelo **conteúdo** (magic bytes) com allowlist; extensão e Content-Type do navegador são ignorados. Executáveis, scripts e tipos desconhecidos são recusados.
- Limite por arquivo (`MAX_UPLOAD_MB`) aplicado durante o streaming; o parcial é apagado.
- ClamAV opcional (`CLAMAV_HOST`): o arquivo fica `pending` e não pode ser baixado até a varredura; ameaça → bloqueado, removido do disco e auditado.
- Download só pela API, após autorização: `Content-Disposition: attachment` (inline apenas para imagens raster, PDF e vídeo), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`. SVG é sempre anexo.
- Rascunhos da equipe ficam `internal` até o QA liberar o entregável — o cliente recebe 404.
- Somente o cliente decide aprovações (`approvals:decide`); a equipe não aprova em nome dele.

## Comercial (Fase 3)

- Link público de proposta: token HMAC de 256 bits, só o hash no banco, rate limit, resposta sem notas internas, e-mail do cliente ou IDs de tenant; expira com a validade; aceite registra nome, concordância, IP e user-agent e é auditado.
- Despesas pertencem ao tenant da agência: nem o cliente rateado as alcança (RLS); o trigger impede despesa em tenant de cliente.
- Ações financeiras críticas passam por HITL; quem não tem `finance:approve` não decide; autoaprovação depende da política; mudar política é exclusivo do SUPER_ADMIN; tudo auditado (`*.requested`, `*.approved`, `*.rejected`).
- Papel FINANCEIRO: acesso global a contratos e finanças, sem operação, usuários ou auditoria.

## Inteligência artificial (Fase 4)

- Chaves de IA só no servidor (API/worker); o frontend nunca as vê. Variáveis vazias contam como ausentes → `integration_pending`.
- Execuções carregam `tenant_id`; o worker reabre o contexto de RLS **daquele** tenant para ler contexto e gravar resultado. FKs compostas impedem execução, memória ou mensagem apontando para dado de outro cliente.
- Prompt injection: conteúdo de cliente/arquivo/mensagem vai delimitado como dado, com as tags neutralizadas; o system prompt declara que instruções dentro dos dados não valem.
- Agentes não publicam, não enviam, não gastam e não aprovam: produzem rascunhos e propostas. O parecer do QA da IA nunca muda o status do entregável; problemas graves reprovam por regra do sistema.
- Memória: nasce `proposed`; o banco exige `decided_by` para aprovar/rejeitar; só memória aprovada entra no prompt; decisões auditadas.
- Chat Global: só papéis globais com `ai:chat`; conversas privadas por usuário; ferramentas **somente leitura**, cada uma revalidando a permissão de quem perguntou (o worker recarrega o usuário do banco — não confia na fila) e rodando com o RLS dele.
- Orçamento por cliente verificado antes de cada chamada; execução bloqueada (`blocked`) não chama o modelo. Todo consumo, inclusive recusas e saídas inválidas, fica em `ai_usage` (só INSERT).
- Bastidores (eventos `ai.*`, QA interno, rascunhos) nunca aparecem para o cliente: linha do tempo, portal e demanda filtram no servidor.

## Integrações / MCP (Fase 5)

- Risco alto nunca executa sem decisão humana: regra no código, CHECKs no banco e conferência no worker (teste de mutação comprova).
- Agentes só propõem; cada proposta passa pela mesma política de uma pessoa, restrita às ferramentas permitidas àquele agente e conectadas no cliente.
- Credenciais AES-256-GCM com chave fora do banco e AAD por tenant/conexão; nunca retornadas pela API, nunca em logs/auditoria (o redator da auditoria também mascara chaves com `secret`/`password`/`token`).
- SSRF: só http(s), HTTPS obrigatório em hosts públicos, IP validado no momento da conexão (anti DNS rebinding), redes internas e metadados de nuvem bloqueados, sem redirecionamentos, resposta limitada.
- Destinatários de e-mail e conteúdo publicado são definidos pelo servidor (usuários do portal; entregável aprovado), nunca por texto livre de quem pede — um agente manipulado não consegue exfiltrar dados por essas ferramentas.
- Webhooks saem assinados (HMAC-SHA256 com timestamp) para o receptor validar origem e evitar replay.
- Isolamento: conexões e chamadas com `tenant_id` + RLS + FKs compostas; a validação de parâmetros roda com RLS do cliente (um entregável de outro cliente "não existe").
- Eventos `mcp.*` nunca aparecem para o cliente.

## Revisão da Fase 5

- [x] HIGH bloqueado sem aprovação: API, worker e banco (CHECK) — e mutação detectada pelos testes
- [x] Segredo nunca em resposta, banco em claro, log ou auditoria; sem `CREDENTIALS_KEY`, nada é salvo
- [x] Equipe do cliente B não vê conexões nem chamadas do A; entregável de B recusado em chamada de A
- [x] SSRF: loopback, privadas, link-local/metadados, http público, credenciais na URL e redirecionamentos recusados
- [x] Circuit breaker abre após 5 falhas seguidas e protege o serviço externo
- [x] Corrigido nesta revisão: tela de Integrações quebrava ao abrir um conector ainda não conectado

## Revisão da Fase 4

- [x] Isolamento: equipe do cliente B não vê execuções, memória, reuniões nem consumo do A (API + RLS); FK composta recusa execução cruzada
- [x] O prompt de um cliente contém só os dados dele (verificado em todas as chamadas do fluxo)
- [x] Recusa do modelo e erro transitório nunca viram sucesso; orçamento estourado não chama o modelo
- [x] Cliente não acessa IA nem vê bastidores; Chat Global privado e restrito a papéis globais
- [x] Corrigido nesta revisão: a linha do tempo do cliente (`/clients/:id/events`, portal) expunha eventos internos de QA ao próprio cliente — agora filtrados no servidor

## Revisão da Fase 3

- [x] Isolamento: cliente B não vê propostas, contratos, faturas nem link de A; gestor não vê faturas/despesas; FINANCEIRO não vê operação
- [x] Notas internas da proposta nunca saem para o cliente (link, PDF, portal)
- [x] Geração de faturas idempotente e sem buracos na numeração
- [x] Nenhuma ação crítica executa sem aprovação (testado: pendente, aprovar, rejeitar, autoaprovação bloqueada)

## Revisão da Fase 2

- [x] Isolamento A→B para demandas, arquivos, aprovações, tarefas, Brand Vault e calendário (API e banco)
- [x] FKs compostas em todas as tabelas filhas da operação
- [x] Upload validado pelo conteúdo, limite de tamanho, SVG em sandbox, antivírus testado com servidor clamd simulado
- [x] Cliente não vê tarefas internas, notas de QA nem arquivos internos
- [x] E-mails de notificação enviados apenas a usuários do próprio tenant

## Revisão da Fase 1

- [x] Toda rota declara política (verificado na inicialização)
- [x] Testes de isolamento A→B na API e no banco (mutação: forçar escopo global faz 10 testes falharem)
- [x] Escalonamento de privilégio bloqueado (ADMIN → SUPER_ADMIN, admin como CLIENTE)
- [x] Suspensão de tenant corta acesso imediatamente
- [ ] CSP com nonce (fase 8)
- [ ] Rate limit distribuído validado com Redis em staging
