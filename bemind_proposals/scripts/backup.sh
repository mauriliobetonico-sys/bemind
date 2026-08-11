#!/usr/bin/env bash
# BE MIND PROPOSALS — backup diário
# Uso (cron do painel):  0 3 * * * /caminho/absoluto/bemind_proposals/scripts/backup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/storage/backups"
STAMP="$(date +%Y%m%d-%H%M)"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

if [[ ! -f "${ROOT}/.env" ]]; then
  echo "[.env] não encontrado em ${ROOT}/.env" >&2
  exit 1
fi
# shellcheck disable=SC2046
export $(grep -E '^(DATABASE_HOST|DATABASE_PORT|DATABASE_NAME|DATABASE_USER|DATABASE_PASSWORD)=' "${ROOT}/.env" | xargs -I {} echo {})

mkdir -p "${DEST}"
DUMP="${DEST}/db-${STAMP}.sql.gz"
UPL="${DEST}/uploads-${STAMP}.tar.gz"

echo "[backup] dump MySQL → ${DUMP}"
mysqldump --single-transaction --routines --triggers --quick \
  -h "${DATABASE_HOST:-localhost}" -P "${DATABASE_PORT:-3306}" \
  -u "${DATABASE_USER}" -p"${DATABASE_PASSWORD}" \
  "${DATABASE_NAME}" | gzip -9 > "${DUMP}"

echo "[backup] uploads → ${UPL}"
tar -C "${ROOT}/public" -czf "${UPL}" uploads

echo "[backup] limpando > ${KEEP_DAYS} dias"
find "${DEST}" -type f -mtime "+${KEEP_DAYS}" -delete

echo "[backup] concluído."
