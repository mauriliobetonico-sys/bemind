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

## Revisão da Fase 1

- [x] Toda rota declara política (verificado na inicialização)
- [x] Testes de isolamento A→B na API e no banco (mutação: forçar escopo global faz 10 testes falharem)
- [x] Escalonamento de privilégio bloqueado (ADMIN → SUPER_ADMIN, admin como CLIENTE)
- [x] Suspensão de tenant corta acesso imediatamente
- [ ] CSP com nonce (fase 8)
- [ ] Rate limit distribuído validado com Redis em staging
