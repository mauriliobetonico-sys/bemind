#!/bin/sh
# Backup periódico do PostgreSQL em formato custom (pg_restore), com retenção.
# Restauração: ver docs/DEPLOYMENT.md#restauração
set -eu

: "${BACKUP_RETENTION_DAYS:=14}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"

while true; do
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  file="/backups/aimos-${ts}.dump"
  if pg_dump --format=custom --no-owner --file="${file}.partial"; then
    mv "${file}.partial" "${file}"
    echo "{\"level\":\"info\",\"msg\":\"backup concluído\",\"file\":\"${file}\"}"
  else
    rm -f "${file}.partial"
    echo "{\"level\":\"error\",\"msg\":\"backup falhou\"}"
  fi
  find /backups -name 'aimos-*.dump' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
  sleep "${BACKUP_INTERVAL_SECONDS}"
done
