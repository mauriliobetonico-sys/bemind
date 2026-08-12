#!/usr/bin/env bash
# BE MIND PROPOSALS — completa o wizard /install/ remotamente via curl.
#
# Uso (todas via export no seu terminal, NUNCA aqui):
#   export APP_URL=https://propostas.bemindmarketing.com.br
#   export DB_HOST=localhost DB_PORT=3306
#   export DB_NAME=bemindmarketing_x DB_USER=usuario DB_PASS='senha'
#   export ADMIN_NAME='Maurílio' ADMIN_EMAIL=you@dom.com ADMIN_PASS='SenhaForte123'
#   export COMPANY_NAME='Be Mind Marketing'
#   export COMPANY_WHATSAPP=5566996001122
#   export COMPANY_EMAIL=contato@bemindmarketing.com.br
#   export COMPANY_DOC=00000000000000
#   export PROPOSAL_PREFIX=BEMIND-
#   export PIX_KEY_TYPE=cnpj PIX_KEY=00000000000000 PIX_HOLDER='Be Mind' PIX_BANK='Nubank'
#   bash scripts/remote-install.sh

set -euo pipefail
req() { : "${!1:?Variável $1 não definida — leia o cabeçalho do script.}"; }
for v in APP_URL DB_NAME DB_USER DB_PASS ADMIN_NAME ADMIN_EMAIL ADMIN_PASS; do req "$v"; done
DB_HOST="${DB_HOST:-localhost}"; DB_PORT="${DB_PORT:-3306}"
COMPANY_NAME="${COMPANY_NAME:-Be Mind Marketing}"
COMPANY_WHATSAPP="${COMPANY_WHATSAPP:-}"; COMPANY_EMAIL="${COMPANY_EMAIL:-}"
COMPANY_DOC="${COMPANY_DOC:-}"; PROPOSAL_PREFIX="${PROPOSAL_PREFIX:-BEMIND-}"
PIX_KEY_TYPE="${PIX_KEY_TYPE:-}"; PIX_KEY="${PIX_KEY:-}"
PIX_HOLDER="${PIX_HOLDER:-}"; PIX_BANK="${PIX_BANK:-}"

BASE="${APP_URL%/}"
CJ="$(mktemp)"; trap "rm -f $CJ" EXIT
CURL=(curl -sS -b "$CJ" -c "$CJ" --fail-with-body -L)

# lê o token CSRF de uma URL do install
csrf_of() {
    local url="$1"; local html
    html="$("${CURL[@]}" "$url")" || { echo "  ✗ GET $url falhou"; exit 1; }
    grep -oE 'name="_csrf" value="[a-f0-9]+"' <<<"$html" | head -1 | sed -E 's/.*value="([a-f0-9]+)"/\1/'
}

step() { echo "▶ passo $1: $2"; }

step 1 "checando /install/ (requisitos)"
CSRF="$(csrf_of "$BASE/install/?step=2")"

step 2 "gravando .env, criando database, rodando schema+seeds"
"${CURL[@]}" -o /dev/null \
    -F "_csrf=$CSRF" -F "app_url=$BASE" -F "app_tz=America/Sao_Paulo" \
    -F "mail_from=${COMPANY_EMAIL}" \
    -F "db_host=$DB_HOST" -F "db_port=$DB_PORT" \
    -F "db_name=$DB_NAME" -F "db_user=$DB_USER" -F "db_pass=$DB_PASS" \
    -F "company_whatsapp=$COMPANY_WHATSAPP" \
    "$BASE/install/?step=2"

CSRF="$(csrf_of "$BASE/install/?step=3")"
step 3 "criando administrador"
"${CURL[@]}" -o /dev/null \
    -F "_csrf=$CSRF" \
    -F "admin_name=$ADMIN_NAME" -F "admin_email=$ADMIN_EMAIL" -F "admin_pass=$ADMIN_PASS" \
    "$BASE/install/?step=3"

CSRF="$(csrf_of "$BASE/install/?step=4")"
step 4 "gravando dados da empresa"
"${CURL[@]}" -o /dev/null \
    -F "_csrf=$CSRF" \
    -F "company_name=$COMPANY_NAME" -F "company_doc=$COMPANY_DOC" \
    -F "company_whatsapp=$COMPANY_WHATSAPP" -F "company_email=$COMPANY_EMAIL" \
    -F "proposal_prefix=$PROPOSAL_PREFIX" \
    -F "pix_key_type=$PIX_KEY_TYPE" -F "pix_key=$PIX_KEY" \
    -F "pix_holder=$PIX_HOLDER" -F "pix_bank=$PIX_BANK" \
    "$BASE/install/?step=4"

CSRF="$(csrf_of "$BASE/install/?step=5")"
step 5 "finalizando (installed.lock)"
"${CURL[@]}" -o /dev/null -F "_csrf=$CSRF" "$BASE/install/?step=5"

step 6 "verificando /health"
HEALTH="$("${CURL[@]}" "$BASE/health")" || true
echo "  ↳ $HEALTH"

echo
echo "✓ instalação concluída."
echo "  APAGUE a pasta /public/install do servidor por FTP e siga para: $BASE/login"
