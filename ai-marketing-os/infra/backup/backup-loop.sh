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
  # Arquivos dos clientes (volume de storage).
  if tar -czf "/backups/aimos-files-${ts}.tar.gz.partial" -C /storage . 2>/dev/null; then
    mv "/backups/aimos-files-${ts}.tar.gz.partial" "/backups/aimos-files-${ts}.tar.gz"
    echo "{\"level\":\"info\",\"msg\":\"backup de arquivos concluído\"}"
  else
    rm -f "/backups/aimos-files-${ts}.tar.gz.partial"
    echo "{\"level\":\"error\",\"msg\":\"backup de arquivos falhou\"}"
  fi
  find /backups \( -name 'aimos-*.dump' -o -name 'aimos-files-*.tar.gz' \) -mtime "+${BACKUP_RETENTION_DAYS}" -delete
  sleep "${BACKUP_INTERVAL_SECONDS}"
done
