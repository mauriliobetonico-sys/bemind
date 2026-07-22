#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# EU RESOLVO — Instalador one-shot para hospedagem própria (Linux + PHP 8.1+)
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "==> Verificando PHP..."
if ! command -v php >/dev/null 2>&1; then
  echo "PHP não encontrado. Instale PHP 8.1+ com pdo_mysql, curl, mbstring, fileinfo, openssl."
  exit 1
fi
PHPVER=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
echo "   PHP $PHPVER ok"

echo "==> Verificando extensões..."
for ext in pdo_mysql curl mbstring fileinfo openssl json; do
  if ! php -m | grep -qi "^$ext$"; then
    echo "Faltando extensão: $ext"; exit 1
  fi
done
echo "   Extensões ok"

echo "==> Configurando .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  # Gera JWT_SECRET aleatório
  SECRET=$(php -r 'echo bin2hex(random_bytes(32));')
  sed -i.bak "s|TROQUE_POR_STRING_ALEATORIA_LONGA_AQUI|$SECRET|g" .env
  echo "   .env criado. Edite-o antes de subir em produção."
else
  echo "   .env já existe."
fi

echo "==> Criando diretórios..."
mkdir -p uploads
chmod -R 775 uploads

echo "==> Testando conexão com o banco..."
php -r "require 'config/database.php'; getDB()->query('SELECT 1'); echo \"   ✓ conectado a \".DB_NAME.PHP_EOL;"

echo "==> Executando migrações (installDB)..."
php -r "require 'config/database.php'; installDB(); echo \"   ✓ schema aplicado\".PHP_EOL;"

echo "==> Instalando WebSocket (Node.js)..."
if [ -d ../websocket ]; then
  (cd ../websocket && npm install --silent && echo "   ✓ dependências ok")
  echo "   Rode: cd ../websocket && node server.js (ou use pm2/systemd)"
fi

cat <<'DONE'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  EU RESOLVO instalado.

  1. Aponte o DocumentRoot para: euresolvo/
  2. Configure o virtualhost (veja docker/nginx/euresolvo.conf).
  3. Suba o WebSocket:  pm2 start websocket/server.js --name er-ws
  4. Acesse: https://SEU_DOMINIO/
     Portais: /portal/empresa, /portal/instalador, /portal/admin
     Login inicial admin: admin@euresolvo.com.br / admin123 (ALTERE!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DONE
