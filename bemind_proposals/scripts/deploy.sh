#!/usr/bin/env bash
# BE MIND PROPOSALS — upload por FTP/FTPS/SFTP usando lftp.
#
# NÃO edite este arquivo. Preencha as variáveis no terminal antes de rodar.
#
# Uso:
#   export FTP_PROTOCOL=ftps                  # ftp | ftps | sftp
#   export FTP_HOST=ftp.seudominio.com.br
#   export FTP_PORT=21                        # 22 para sftp, 21 para ftp/ftps
#   export FTP_USER=usuario_ftp
#   export FTP_PASS='sua-senha'               # entre aspas simples
#   export REMOTE_ROOT=/                      # base remota (ex.: / ou /public_html)
#   export DEPLOY_MODE=subfolder              # subfolder | rootrewrite
#   bash scripts/deploy.sh
#
# DEPLOY_MODE:
#   - subfolder     → sobe TUDO para $REMOTE_ROOT/bemind_proposals/ e você
#                     aponta o docroot do domínio para bemind_proposals/public
#   - rootrewrite   → sobe o conteúdo de bemind_proposals/ para $REMOTE_ROOT
#                     e o .htaccess da raiz reencaminha para /public

set -euo pipefail

req() { : "${!1:?Variável $1 não definida — leia o cabeçalho do script.}"; }
for v in FTP_PROTOCOL FTP_HOST FTP_USER FTP_PASS REMOTE_ROOT DEPLOY_MODE; do req "$v"; done
FTP_PORT="${FTP_PORT:-$([[ $FTP_PROTOCOL == sftp ]] && echo 22 || echo 21)}"

command -v lftp >/dev/null || { echo "Instale lftp:  brew install lftp   |   sudo apt install lftp"; exit 1; }

LOCAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "$DEPLOY_MODE" in
    subfolder)   REMOTE_DIR="${REMOTE_ROOT%/}/bemind_proposals" ;;
    rootrewrite) REMOTE_DIR="${REMOTE_ROOT%/}" ;;
    *) echo "DEPLOY_MODE inválido (use subfolder ou rootrewrite)"; exit 1 ;;
esac

echo "▶ enviando $LOCAL_ROOT  →  $FTP_PROTOCOL://$FTP_HOST:$FTP_PORT$REMOTE_DIR/"
echo "  (modo: $DEPLOY_MODE)"

case "$FTP_PROTOCOL" in
    ftps) OPEN="set ftp:ssl-force true; set ftp:ssl-protect-data true; open -u $FTP_USER,$FTP_PASS ftp://$FTP_HOST:$FTP_PORT" ;;
    ftp)  OPEN="set ftp:ssl-allow false; open -u $FTP_USER,$FTP_PASS ftp://$FTP_HOST:$FTP_PORT" ;;
    sftp) OPEN="open -u $FTP_USER,$FTP_PASS sftp://$FTP_HOST:$FTP_PORT" ;;
    *)    echo "FTP_PROTOCOL inválido"; exit 1 ;;
esac

lftp -c "
    set ssl:verify-certificate no;
    set net:timeout 20; set net:max-retries 3;
    $OPEN;
    mkdir -p $REMOTE_DIR;
    mirror -R --parallel=4 --verbose \
        --exclude-glob '.env' \
        --exclude-glob '.env.*' \
        --exclude-glob '.git*' \
        --exclude-glob 'scripts/deploy.sh' \
        --exclude-glob 'scripts/smoke.php' \
        --exclude-glob 'storage/logs/*' \
        --exclude-glob 'storage/backups/*' \
        --exclude-glob 'storage/pdf/*' \
        --exclude-glob 'storage/ratelimit/*' \
        --exclude-glob 'storage/installed.lock' \
        --exclude-glob 'public/uploads/*' \
        $LOCAL_ROOT $REMOTE_DIR;
    chmod 775 $REMOTE_DIR/storage || true;
    chmod 775 $REMOTE_DIR/storage/logs || true;
    chmod 775 $REMOTE_DIR/storage/pdf || true;
    chmod 775 $REMOTE_DIR/storage/backups || true;
    chmod 775 $REMOTE_DIR/public/uploads || true;
"

echo "✓ upload concluído."
echo "  Próximo passo:  bash scripts/remote-install.sh"
