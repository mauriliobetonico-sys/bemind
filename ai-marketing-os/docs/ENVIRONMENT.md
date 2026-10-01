# Variáveis de ambiente

Todas são validadas na inicialização (`apps/api/src/config/env.ts`); valor inválido impede o processo de subir. Segredos nunca vão para o Git nem para o frontend.

## API e worker

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, `staging`, `production` |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `4000` | Endereço da API |
| `LOG_LEVEL` | `info` | Nível de log |
| `APP_URL` | — (obrigatório) | URL pública; usada em e-mails e na checagem de `Origin` |
| `APP_SECRET` | — (obrigatório, mín. 32) | Assina os links públicos de proposta (HMAC). Trocar invalida todos os links já enviados |
| `DATABASE_URL` | — (obrigatório) | Conexão do role `aimos_app` (sujeito a RLS) |
| `DATABASE_POOL_MAX` | `10` | Conexões por processo |
| `REDIS_URL` | — | Rate limit distribuído (recomendado em produção) |
| `COOKIE_SECURE` | `true` | Cookies `Secure` + prefixo `__Host-`; `false` só em dev sem HTTPS |
| `TRUST_PROXY` | `false` | `true` atrás do Caddy (IP real do cliente) |
| `SESSION_TTL_HOURS` | `12` | Expiração absoluta da sessão |
| `SESSION_IDLE_MINUTES` | `120` | Expiração por inatividade |
| `INVITE_TTL_HOURS` | `72` | Validade do link de convite |
| `RESET_TTL_MINUTES` | `30` | Validade do link de redefinição |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCK_MINUTES` | `5` / `15` | Bloqueio de conta |
| `AUTH_RATE_PER_MINUTE` | `10` | Limite por IP nas rotas de autenticação |
| `RATE_LIMIT_PER_MINUTE` | `300` | Limite global por IP |
| `SMTP_HOST` … `SMTP_PASSWORD` | — | Servidor SMTP. Sem `SMTP_HOST`: `integration_pending` |
| `SMTP_PORT` / `SMTP_SECURE` | `587` / `false` | Porta e TLS implícito |
| `MAIL_FROM` | `AI Marketing OS <no-reply@localhost>` | Remetente |
| `SUPPORT_EMAIL` | `suporte@localhost` | Contato no e-mail de boas-vindas |
| `OUTBOX_POLL_MS` / `OUTBOX_MAX_ATTEMPTS` | `2000` / `8` | Worker: intervalo e tentativas antes de `dead` |
| `STORAGE_DIR` | `./data/storage` (Docker: `/data/storage`) | Volume dos arquivos dos clientes |
| `MAX_UPLOAD_MB` | `200` | Limite por arquivo |
| `CLAMAV_HOST` / `CLAMAV_PORT` | — / `3310` | clamd. Sem host: `scan_status = skipped` |
| `ANTHROPIC_API_KEY` | — | Chave da Anthropic (somente servidor). Sem ela: agentes em `integration_pending` |
| `AI_MODEL` | `claude-opus-5-5` | Modelo dos agentes |
| `AI_SERVER_FALLBACK` | `true` | Se o modelo recusar por política, a Anthropic refaz no modelo de fallback recomendado (beta `server-side-fallback-2026-07-01`) |
| `AI_TIMEOUT_MS` | `300000` | Tempo máximo por chamada ao modelo |
| `OPENAI_API_KEY` | — | Opcional: SOMENTE embeddings da memória (busca semântica) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Modelo de embeddings (1536 dimensões) |

## Somente migração e seed

| Variável | Descrição |
| --- | --- |
| `DATABASE_ADMIN_URL` | Conexão do dono do banco. Usada **apenas** por `migrate` e `seed:admin` |
| `APP_DB_PASSWORD` | Senha atribuída ao role `aimos_app` (mín. 16 caracteres) |
| `MIGRATIONS_DIR` | Caminho das migrations (padrão: detectado) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` | Primeiro SUPER_ADMIN |

## Web

| Variável | Descrição |
| --- | --- |
| `API_INTERNAL_URL` | Destino do rewrite `/api` no Next.js (build). Em produção o Caddy já roteia `/api` direto para a API |

## Docker Compose

| Variável | Descrição |
| --- | --- |
| `DOMAIN`, `ACME_EMAIL` | Domínio público e e-mail do Let's Encrypt |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Banco e usuário dono |
| `REDIS_PASSWORD` | Senha do Redis |
| `IMAGE_TAG` | Tag das imagens |
| `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_INTERVAL_SECONDS` | Backup |

## Testes

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `TEST_DATABASE_ADMIN_URL` | `postgres://postgres@localhost:5433/postgres` | Superusuário usado para criar/descartar o banco de teste |
