#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════
# VisãoOS — Script de Instalação Completa
# Execute como root no servidor: bash install.sh
# ══════════════════════════════════════════════════════════════════════════
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info()  { echo -e "${BLUE}[→]${NC} $1"; }

echo -e "${BLUE}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     VisãoOS — Instalação v2.0         ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── Verifica pré-requisitos ───────────────────────────────────────────────
command -v docker   >/dev/null || error "Docker não instalado. Instale em: https://docs.docker.com/engine/install/"
command -v docker   >/dev/null && docker compose version >/dev/null || error "Docker Compose plugin não encontrado."
command -v node     >/dev/null || warn "Node.js não instalado — WebSocket server não será configurado."
command -v php      >/dev/null || error "PHP não encontrado."
command -v mysql    >/dev/null || warn "MySQL client não encontrado."

# ── Configurações ─────────────────────────────────────────────────────────
read -p "Domínio principal (ex: seusite.com.br): " DOMAIN
read -p "E-mail para SSL (Let's Encrypt): " SSL_EMAIL
read -sp "Senha para MySQL VisãoOS: " DB_PASS; echo
read -sp "Senha para JWT Secret: " JWT_SECRET; echo
if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET=$(php -r "echo bin2hex(random_bytes(32));")
    log "JWT Secret gerado automaticamente"
fi

# ── Cria estrutura de diretórios ──────────────────────────────────────────
APP_DIR="/var/www/visaoos"
info "Criando diretórios em $APP_DIR"
mkdir -p "$APP_DIR" "$APP_DIR/uploads" /var/backups/visaoos

# ── Instala Node.js se não existir ────────────────────────────────────────
if ! command -v node >/dev/null; then
    info "Instalando Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    log "Node.js $(node --version) instalado"
fi

# ── Instala PM2 globalmente ────────────────────────────────────────────────
if ! command -v pm2 >/dev/null; then
    info "Instalando PM2..."
    npm install -g pm2
    pm2 startup
    log "PM2 instalado"
fi

# ── Configura variáveis de ambiente ──────────────────────────────────────
info "Configurando .env"
WS_SECRET=$(php -r "echo bin2hex(random_bytes(16));")

cat > "$APP_DIR/.env" <<EOF
DB_HOST=localhost
DB_PORT=3306
DB_NAME=visaoos
DB_USER=visaoos_user
DB_PASS=$DB_PASS
APP_URL=https://$DOMAIN
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES=86400
N8N_WEBHOOK_BASE=https://n8n.$DOMAIN/webhook
NEXTCLOUD_URL=https://cloud.$DOMAIN
WS_PORT=6001
WS_SECRET=$WS_SECRET
EOF
chmod 600 "$APP_DIR/.env"
log ".env criado com segurança"

# ── Docker Stack ──────────────────────────────────────────────────────────
if [ -d "docker" ]; then
    info "Configurando Docker Stack..."
    cp docker/.env.example docker/.env
    sed -i "s/seusite.com.br/$DOMAIN/g" docker/.env
    sed -i "s/seuemail@dominio.com.br/$SSL_EMAIL/g" docker/.env

    N8N_PASS=$(php -r "echo bin2hex(random_bytes(12));")
    NC_PASS=$(php -r "echo bin2hex(random_bytes(12));")
    MAUTIC_PASS=$(php -r "echo bin2hex(random_bytes(12));")
    NC_ENC=$(openssl rand -hex 24)

    sed -i "s/SENHA_FORTE_N8N/$N8N_PASS/g" docker/.env
    sed -i "s/GERE_COM_openssl_rand_-hex_24/$NC_ENC/g" docker/.env
    sed -i "s/SENHA_FORTE_NEXTCLOUD/$NC_PASS/g" docker/.env
    sed -i "s/SENHA_DB_NEXTCLOUD/$(php -r "echo bin2hex(random_bytes(8));")/g" docker/.env
    sed -i "s/SENHA_ROOT_NEXTCLOUD/$(php -r "echo bin2hex(random_bytes(8));")/g" docker/.env
    sed -i "s/SENHA_DB_MAUTIC/$(php -r "echo bin2hex(random_bytes(8));")/g" docker/.env
    sed -i "s/SENHA_ROOT_MAUTIC/$(php -r "echo bin2hex(random_bytes(8));")/g" docker/.env
    sed -i "s/seusite.com.br/$DOMAIN/g" docker/nginx/nginx.conf

    cd docker
    docker compose up -d
    cd ..

    log "Docker Stack iniciado"
    echo ""
    echo -e "${YELLOW}Senhas geradas (salve em local seguro!):${NC}"
    echo "  n8n: admin / $N8N_PASS"
    echo "  Nextcloud: admin / $NC_PASS"
    echo ""
fi

# ── WebSocket Server ──────────────────────────────────────────────────────
if [ -d "websocket" ] && command -v node >/dev/null; then
    info "Configurando WebSocket Server..."
    WS_DIR="/opt/visaoos-ws"
    mkdir -p "$WS_DIR"
    cp -r websocket/* "$WS_DIR/"
    cp "$APP_DIR/.env" "$WS_DIR/.env"
    cd "$WS_DIR"
    npm ci --production
    pm2 start ecosystem.config.js
    pm2 save
    cd -
    log "WebSocket Server iniciado (porta 6001)"
fi

# ── Configura diretório de uploads ───────────────────────────────────────
chown -R www-data:www-data "$APP_DIR/uploads"
chmod -R 755 "$APP_DIR/uploads"

# ── Health Check ──────────────────────────────────────────────────────────
info "Aguardando serviços iniciarem..."
sleep 10

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}   VisãoOS instalado com sucesso!          ${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "Acesse os serviços:"
echo "  Sistema:  https://$DOMAIN"
echo "  n8n:      https://n8n.$DOMAIN"
echo "  Metabase: https://metabase.$DOMAIN"
echo "  Nextcloud:https://cloud.$DOMAIN"
echo "  Mautic:   https://mautic.$DOMAIN"
echo "  Jenkins:  https://ci.$DOMAIN"
echo ""
echo "Login padrão do sistema: admin@visaoos.com.br / admin123"
echo -e "${RED}TROQUE A SENHA IMEDIATAMENTE!${NC}"
