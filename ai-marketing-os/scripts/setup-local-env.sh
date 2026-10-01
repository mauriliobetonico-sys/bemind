#!/usr/bin/env bash
# Gera um .env para testar a stack completa localmente com Docker.
# Segredos aleatórios em hexadecimal (seguros dentro de URLs de conexão).
# As credenciais SMTP você preenche à mão depois — nunca as versione.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  echo ".env já existe — apague-o antes se quiser gerar outro." >&2
  exit 1
fi

secret() { openssl rand -hex 24; }

cp .env.example .env
set_var() {
  # substitui a linha "CHAVE=..." preservando o restante do arquivo
  local key="$1" value="$2"
  awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' .env > .env.tmp && mv .env.tmp .env
}

set_var NODE_ENV production
set_var DOMAIN localhost
set_var APP_URL https://localhost
set_var POSTGRES_PASSWORD "$(secret)"
set_var APP_DB_PASSWORD "$(secret)"
set_var REDIS_PASSWORD "$(secret)"
set_var APP_SECRET "$(openssl rand -hex 32)"
set_var CREDENTIALS_KEY "$(openssl rand -hex 32)"
set_var SMTP_HOST smtp.bemindmarketing.com.br
set_var SMTP_PORT 587
set_var SMTP_SECURE false
set_var MAIL_FROM "\"AI Marketing OS <no-reply@bemindmarketing.com.br>\""
set_var SUPPORT_EMAIL suporte@bemindmarketing.com.br
chmod 600 .env

echo ".env criado. Agora edite e preencha SMTP_USER, SMTP_PASSWORD (e ajuste MAIL_FROM/SUPPORT_EMAIL)."
