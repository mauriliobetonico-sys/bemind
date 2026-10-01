# Deploy

A stack inteira roda com Docker Compose no seu próprio servidor/cloud: `postgres`, `redis`, `migrate` (job), `api`, `worker`, `web`, `caddy` (TLS + proxy) e `backup`.

## Ambientes

| Ambiente | Como | Observações |
| --- | --- | --- |
| development | `pnpm dev:*` ou `docker compose --profile dev up` | `COOKIE_SECURE=false` só aqui; Mailpit em `:8025` |
| staging | mesmo compose, `.env` próprio, domínio de staging | dados fictícios; SMTP de teste |
| production | mesmo compose, `.env` de produção | `NODE_ENV=production` recusa `COOKIE_SECURE=false` |

O mesmo artefato (imagens `aimos-api`, `aimos-web` com `IMAGE_TAG`) é promovido de staging para produção.

## Primeiro deploy

```bash
git clone <repo> && cd ai-marketing-os
cp .env.example .env            # preencha DOMAIN, APP_URL e TODOS os segredos
# segredos: openssl rand -base64 32  (POSTGRES_PASSWORD, APP_DB_PASSWORD, REDIS_PASSWORD)

docker compose build
docker compose up -d            # migrate roda antes de api/worker
docker compose ps               # todos healthy; migrate "exited (0)"

# primeiro SUPER_ADMIN (imprime link de uso único, válido por 24h)
docker compose run --rm \
  -e SEED_ADMIN_EMAIL=voce@agencia.com -e SEED_ADMIN_NAME="Seu Nome" \
  -e DATABASE_ADMIN_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB" \
  -e APP_URL="$APP_URL" migrate node dist/db/seed-admin-cli.mjs
```

Requisitos do servidor: portas 80/443 abertas, DNS do `DOMAIN` apontando para ele (o Caddy emite o certificado automaticamente).

## Atualização

```bash
git pull && docker compose build && docker compose up -d
```

As migrations são idempotentes e rodam antes da API. Para rollback de código, volte a tag da imagem; migrations são apenas aditivas por convenção.

## Backup e restauração

O serviço `backup` executa `pg_dump --format=custom` a cada `BACKUP_INTERVAL_SECONDS` (padrão: diário) em `BACKUP_DIR`, apagando arquivos mais antigos que `BACKUP_RETENTION_DAYS`. Copie `BACKUP_DIR` para um armazenamento externo (S3, outro datacenter) — backup no mesmo disco não é backup. Arquivos (fase 2) terão versionamento no bucket S3.

### Restauração

```bash
docker compose stop api worker
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < backups/aimos-AAAAMMDDTHHMMSSZ.dump
docker compose run --rm migrate     # recria o role aimos_app, grants e sincroniza o catálogo
docker compose start api worker
```

Teste a restauração periodicamente em staging.

## Observabilidade (Fase 1)

- Logs JSON em stdout (API via pino, worker, Caddy) com campos sensíveis mascarados — colete com o agente de logs do seu cloud.
- `GET /api/health` (liveness) e `GET /api/ready` (banco + SMTP).
- Outbox: `SELECT status, count(*) FROM outbox_events GROUP BY status;` — eventos `dead` precisam de atenção.
- Métricas, traces (OpenTelemetry) e dashboard técnico: fase 8.
