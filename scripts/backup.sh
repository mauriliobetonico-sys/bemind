#!/bin/bash
# VisãoOS — Backup automático (MySQL + arquivos)
# Adicione ao cron: 0 2 * * * /opt/visaoos/scripts/backup.sh
set -e

APP_DIR="/var/www/visaoos"
BACKUP_DIR="/var/backups/visaoos"
DATE=$(date +%Y%m%d-%H%M%S)
KEEP_DAYS=30

# Carrega .env
[ -f "$APP_DIR/.env" ] && export $(grep -v '^#' "$APP_DIR/.env" | xargs)

mkdir -p "$BACKUP_DIR"

# Backup MySQL
mysqldump -h"${DB_HOST:-localhost}" -u"${DB_USER}" -p"${DB_PASS}" \
    --single-transaction --routines --triggers \
    "${DB_NAME}" | gzip > "$BACKUP_DIR/db-$DATE.sql.gz"

# Backup uploads
tar -czf "$BACKUP_DIR/uploads-$DATE.tar.gz" -C "$APP_DIR" uploads/ 2>/dev/null || true

# Remove backups antigos
find "$BACKUP_DIR" -name "*.gz" -mtime +$KEEP_DAYS -delete

echo "[$(date)] Backup concluído: db-$DATE.sql.gz"
