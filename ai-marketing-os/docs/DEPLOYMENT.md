# Deploy

A stack inteira roda com Docker Compose no seu próprio servidor/cloud: `postgres`, `redis`, `migrate` (job), `api`, `worker`, `web`, `caddy` (TLS + proxy) e `backup`.

## Ambientes

| Ambiente | Como | Observações |
| --- | --- | --- |
| development | `pnpm dev:*` ou `docker compose --profile dev up` | `COOKIE_SECURE=false` só aqui; Mailpit em `:8025` |
| staging | mesmo compose, `.env` próprio, domínio de staging | dados fictícios; SMTP de teste |
| production | mesmo compose, `.env` de produção | `NODE_ENV=production` recusa `COOKIE_SECURE=false` |

O mesmo artefato (imagens `aimos-api`, `aimos-web` com `IMAGE_TAG`) é promovido de staging para produção.

## Teste local completo (Docker)

```bash
./scripts/setup-local-env.sh     # gera .env com segredos aleatórios, DOMAIN=localhost
# edite .env e preencha SMTP_USER e SMTP_PASSWORD
docker compose build
docker compose up -d
docker compose ps                # migrate "exited (0)"; api, worker, web, caddy "running"

# testa o SMTP (envia um e-mail real)
docker compose exec worker node dist/mail/smtp-test-cli.mjs voce@exemplo.com

# cria o primeiro SUPER_ADMIN e imprime o link para definir a senha
docker compose run --rm -e SEED_ADMIN_EMAIL=voce@exemplo.com -e SEED_ADMIN_NAME="Seu Nome" \
  -e APP_URL=https://localhost migrate node dist/db/seed-admin-cli.mjs
```

Abra o link impresso. Em `localhost` o Caddy usa um certificado próprio: o navegador avisa na primeira visita (aceite, ou rode `docker compose exec caddy caddy trust`). Logs: `docker compose logs -f api worker`. Para apagar tudo, inclusive o banco: `docker compose down -v`.

### SMTP

| Porta | `SMTP_SECURE` | Modo |
| --- | --- | --- |
| 587 | `false` | STARTTLS (recomendado) |
| 465 | `true` | TLS direto |

`MAIL_FROM` precisa ser um endereço que a conta autenticada pode usar como remetente, senão o servidor recusa ou o e-mail cai no spam. POP e IMAP não são usados pela plataforma.

## Primeiro deploy

```bash
git clone <repo> && cd ai-marketing-os
cp .env.example .env            # preencha DOMAIN, APP_URL e TODOS os segredos
# segredos: openssl rand -hex 24  (POSTGRES_PASSWORD, APP_DB_PASSWORD, REDIS_PASSWORD)

docker compose build
docker compose up -d            # migrate roda antes de api/worker
docker compose ps               # todos healthy; migrate "exited (0)"

# primeiro SUPER_ADMIN (imprime link de uso único, válido por 24h)
docker compose run --rm -e SEED_ADMIN_EMAIL=voce@agencia.com -e SEED_ADMIN_NAME="Seu Nome" \
  -e APP_URL="https://$DOMAIN" migrate node dist/db/seed-admin-cli.mjs
```

Requisitos do servidor: portas 80/443 abertas, DNS do `DOMAIN` apontando para ele (o Caddy emite o certificado automaticamente).

## Atualização

> **Ao atualizar para a Fase 3:** adicione `APP_SECRET` ao `.env` antes de subir (`openssl rand -hex 32`). Sem ela a API não inicia.

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

Arquivos dos clientes: `backups/aimos-files-*.tar.gz` contém o volume de storage.

```bash
docker compose stop api worker
docker run --rm -v aimos_storage:/storage -v "$PWD/backups":/b alpine sh -c 'rm -rf /storage/* && tar -xzf /b/aimos-files-AAAAMMDDTHHMMSSZ.tar.gz -C /storage && chown -R 1000:1000 /storage'
docker compose start api worker
```

Teste a restauração periodicamente em staging.

## Antivírus (opcional)

```bash
# no .env: CLAMAV_HOST=clamav
docker compose --profile antivirus up -d
```

O ClamAV leva alguns minutos para baixar as assinaturas na primeira subida; enquanto isso os arquivos ficam "em verificação" e o worker tenta de novo com backoff.

## Observabilidade (Fase 1)

- Logs JSON em stdout (API via pino, worker, Caddy) com campos sensíveis mascarados — colete com o agente de logs do seu cloud.
- `GET /api/health` (liveness) e `GET /api/ready` (banco + SMTP).
- Outbox: `SELECT status, count(*) FROM outbox_events GROUP BY status;` — eventos `dead` precisam de atenção.
- Métricas, traces (OpenTelemetry) e dashboard técnico: fase 8.
