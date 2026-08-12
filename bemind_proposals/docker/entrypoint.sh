#!/usr/bin/env bash
# Garante permissão para o Apache (www-data) gravar em storage/ e uploads/
# antes de iniciar o processo principal. Roda a cada start do container.
set -e

for d in /var/www/html/storage \
         /var/www/html/storage/logs \
         /var/www/html/storage/pdf \
         /var/www/html/storage/backups \
         /var/www/html/storage/ratelimit \
         /var/www/html/public/uploads; do
    mkdir -p "$d" 2>/dev/null || true
    chown -R www-data:www-data "$d" 2>/dev/null || true
    chmod -R u+rwX,g+rwX "$d"    2>/dev/null || true
done

exec "$@"
