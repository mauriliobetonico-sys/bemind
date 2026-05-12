#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════
# VisãoOS — Deploy Completo para bemindmarketing.com.br
# Execute no terminal do servidor Cloudez:
#   curl -fsSL https://raw.githubusercontent.com/mauriliobetonico-sys/bemind/claude/analyze-system-improvements-8RLOE/scripts/deploy-server.sh | bash
# OU copie e cole este script no terminal do painel Cloudez
# ══════════════════════════════════════════════════════════════════════════
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info()  { echo -e "${BLUE}[→]${NC} $1"; }

DOMAIN="bemindmarketing.com.br"
APP_DIR="/home/bemindmarketing5/public_html"
DEPLOY_DIR="/home/bemindmarketing5"
REPO_BRANCH="claude/analyze-system-improvements-8RLOE"
REPO_URL="https://github.com/mauriliobetonico-sys/bemind.git"

echo -e "${BLUE}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   VisãoOS — Deploy Automático v2.0           ║"
echo "  ║   Domínio: $DOMAIN         ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Detecta web root ─────────────────────────────────────────────────────
if [ -d "/home/bemindmarketing5/public_html" ]; then
    APP_DIR="/home/bemindmarketing5/public_html"
elif [ -d "/var/www/html" ]; then
    APP_DIR="/var/www/html"
elif [ -d "/var/www/bemindmarketing.com.br" ]; then
    APP_DIR="/var/www/bemindmarketing.com.br"
else
    # Usa o diretório atual
    APP_DIR="$(pwd)/public_html"
    mkdir -p "$APP_DIR"
fi
info "Web root detectado: $APP_DIR"

# ── Verifica dependências ─────────────────────────────────────────────────
command -v php      >/dev/null || error "PHP não encontrado. Instale PHP 8.1+"
command -v mysql    >/dev/null 2>&1 || warn "MySQL client não encontrado"
command -v git      >/dev/null || error "Git não encontrado"
PHP_VERSION=$(php -r "echo PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION;")
info "PHP $PHP_VERSION detectado"

# ── Clona repositório ─────────────────────────────────────────────────────
WORK_DIR="$DEPLOY_DIR/bemind-repo"
if [ -d "$WORK_DIR" ]; then
    info "Repositório já existe, atualizando..."
    cd "$WORK_DIR"
    git fetch origin
    git checkout "$REPO_BRANCH"
    git pull origin "$REPO_BRANCH"
else
    info "Clonando repositório..."
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$WORK_DIR"
    cd "$WORK_DIR"
fi
log "Repositório atualizado"

# ── Gera senhas seguras ───────────────────────────────────────────────────
JWT_SECRET=$(php -r "echo bin2hex(random_bytes(32));")
WS_SECRET=$(php -r "echo bin2hex(random_bytes(16));")
DB_PASS=$(php -r "echo bin2hex(random_bytes(12));")
N8N_PASS=$(php -r "echo bin2hex(random_bytes(12));")
NC_PASS=$(php -r "echo bin2hex(random_bytes(12));")
NC_DB_PASS=$(php -r "echo bin2hex(random_bytes(8));")
NC_DB_ROOT=$(php -r "echo bin2hex(random_bytes(8));")
MAUTIC_DB_PASS=$(php -r "echo bin2hex(random_bytes(8));")
MAUTIC_DB_ROOT=$(php -r "echo bin2hex(random_bytes(8));")
N8N_ENC_KEY=$(openssl rand -hex 24 2>/dev/null || php -r "echo bin2hex(random_bytes(24));")
log "Senhas geradas"

# ── Cria banco de dados MySQL ─────────────────────────────────────────────
info "Configurando banco de dados MySQL..."
read -p "Usuário root do MySQL (padrão: root): " DB_ROOT_USER
DB_ROOT_USER="${DB_ROOT_USER:-root}"
read -sp "Senha root do MySQL: " DB_ROOT_PASS; echo

mysql -u"$DB_ROOT_USER" -p"$DB_ROOT_PASS" 2>/dev/null <<MYSQL_EOF || warn "Erro no MySQL — configure manualmente"
CREATE DATABASE IF NOT EXISTS visaoos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'visaoos_user'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON visaoos.* TO 'visaoos_user'@'localhost';
FLUSH PRIVILEGES;
MYSQL_EOF
log "Banco de dados configurado"

# ── Configura .env da aplicação ───────────────────────────────────────────
info "Criando arquivo .env..."
read -p "E-mail do administrador (para relatórios): " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@$DOMAIN}"
read -p "Servidor SMTP (padrão: smtp.$DOMAIN): " SMTP_HOST
SMTP_HOST="${SMTP_HOST:-smtp.$DOMAIN}"
read -p "Porta SMTP (padrão: 587): " SMTP_PORT
SMTP_PORT="${SMTP_PORT:-587}"
read -p "Usuário SMTP: " SMTP_USER
SMTP_USER="${SMTP_USER:-noreply@$DOMAIN}"
read -sp "Senha SMTP: " SMTP_PASS; echo

cat > "$APP_DIR/.env" <<ENVEOF
# VisãoOS — Configuração de Ambiente
APP_URL=https://$DOMAIN
APP_ENV=production

# Banco de Dados
DB_HOST=localhost
DB_PORT=3306
DB_NAME=visaoos
DB_USER=visaoos_user
DB_PASS=$DB_PASS

# Autenticação JWT
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES=86400

# WebSocket
WS_PORT=6001
WS_SECRET=$WS_SECRET

# n8n Webhooks (após subir Docker stack)
N8N_WEBHOOK_BASE=https://n8n.$DOMAIN/webhook

# Nextcloud (após subir Docker stack)
NEXTCLOUD_URL=https://cloud.$DOMAIN
NEXTCLOUD_USER=admin
NEXTCLOUD_PASS=$NC_PASS

# E-mail / SMTP
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM=noreply@$DOMAIN
ADMIN_EMAIL=$ADMIN_EMAIL

# API Token para n8n
VISAOOS_API_TOKEN=$(php -r "echo bin2hex(random_bytes(24));")
ENVEOF
chmod 600 "$APP_DIR/.env"
log ".env criado"

# ── Copia arquivos PHP ────────────────────────────────────────────────────
info "Copiando arquivos da aplicação PHP..."
cp -r "$WORK_DIR/visaoos/"* "$APP_DIR/"
chmod -R 755 "$APP_DIR"
chmod 600 "$APP_DIR/.env"
mkdir -p "$APP_DIR/uploads" "$APP_DIR/logs"
log "Arquivos PHP copiados"

# ── Detecta usuário do servidor web ──────────────────────────────────────
WEB_USER="www-data"
if id "apache" &>/dev/null; then WEB_USER="apache"; fi
if id "nginx" &>/dev/null && [ "$WEB_USER" = "www-data" ]; then WEB_USER="nginx"; fi
if id "bemindmarketing5" &>/dev/null; then WEB_USER="bemindmarketing5"; fi

chown -R "$WEB_USER:$WEB_USER" "$APP_DIR/uploads" "$APP_DIR/logs" 2>/dev/null || true
chmod -R 775 "$APP_DIR/uploads"
log "Permissões configuradas (usuário: $WEB_USER)"

# ── Instala banco de dados da aplicação ──────────────────────────────────
info "Inicializando banco de dados da aplicação..."
php -r "
define('_VISAOOS_', true);
require '$APP_DIR/config/database.php';
installDB();
echo 'DB instalado com sucesso';
" && log "Banco de dados da aplicação instalado"

# ── Instala Node.js se necessário ────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
    info "Instalando Node.js 20..."
    if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
        sudo apt-get install -y nodejs
    elif command -v yum >/dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo yum install -y nodejs
    else
        warn "Não foi possível instalar Node.js automaticamente"
    fi
fi

# ── Configura WebSocket Server ────────────────────────────────────────────
if command -v node >/dev/null 2>&1; then
    WS_DIR="$DEPLOY_DIR/visaoos-ws"
    mkdir -p "$WS_DIR/logs"
    cp -r "$WORK_DIR/websocket/"* "$WS_DIR/"
    cp "$APP_DIR/.env" "$WS_DIR/.env"

    cd "$WS_DIR"
    npm ci --production 2>/dev/null || npm install --production

    if command -v pm2 >/dev/null 2>&1; then
        pm2 delete visaoos-ws 2>/dev/null || true
        pm2 start ecosystem.config.js
        pm2 save
        log "WebSocket Server iniciado via PM2 (porta 6001)"
    elif command -v node >/dev/null 2>&1; then
        # Inicia em background se não tiver PM2
        nohup node server.js >> logs/ws-out.log 2>&1 &
        log "WebSocket Server iniciado em background (porta 6001)"
    fi
    cd "$WORK_DIR"
else
    warn "Node.js não disponível — WebSocket desabilitado"
fi

# ── Configura Docker Stack (se disponível) ────────────────────────────────
if command -v docker >/dev/null 2>&1; then
    info "Configurando Docker Stack (n8n, Metabase, Nextcloud, Mautic)..."
    DOCKER_DIR="$DEPLOY_DIR/visaoos-docker"
    mkdir -p "$DOCKER_DIR"
    cp -r "$WORK_DIR/docker/"* "$DOCKER_DIR/"

    cat > "$DOCKER_DIR/.env" <<DOCKERENV
SSL_EMAIL=$ADMIN_EMAIL
N8N_HOST=n8n.$DOMAIN
N8N_USER=admin
N8N_PASSWORD=$N8N_PASS
N8N_ENCRYPTION_KEY=$N8N_ENC_KEY
METABASE_HOST=metabase.$DOMAIN
NEXTCLOUD_HOST=cloud.$DOMAIN
NEXTCLOUD_ADMIN_USER=admin
NEXTCLOUD_ADMIN_PASS=$NC_PASS
NEXTCLOUD_DB_PASS=$NC_DB_PASS
NEXTCLOUD_DB_ROOT_PASS=$NC_DB_ROOT
MAUTIC_HOST=mautic.$DOMAIN
MAUTIC_DB_PASS=$MAUTIC_DB_PASS
MAUTIC_DB_ROOT_PASS=$MAUTIC_DB_ROOT
JENKINS_HOST=ci.$DOMAIN
DOCKERENV

    cd "$DOCKER_DIR"
    docker compose up -d 2>&1
    log "Docker Stack iniciado"
    cd "$WORK_DIR"
else
    warn "Docker não encontrado — Stack de ferramentas não iniciado"
    warn "Instale Docker em: https://docs.docker.com/engine/install/"
fi

# ── Configura backup automático ───────────────────────────────────────────
if command -v crontab >/dev/null 2>&1; then
    mkdir -p "$DEPLOY_DIR/backups"
    cp "$WORK_DIR/scripts/backup.sh" "$DEPLOY_DIR/backup.sh"
    sed -i "s|/var/www/visaoos|$APP_DIR|g" "$DEPLOY_DIR/backup.sh"
    sed -i "s|/var/backups/visaoos|$DEPLOY_DIR/backups|g" "$DEPLOY_DIR/backup.sh"
    sed -i "s|DB_USER.*|DB_USER=visaoos_user|g" "$DEPLOY_DIR/backup.sh"
    chmod +x "$DEPLOY_DIR/backup.sh"

    # Adiciona ao cron (2h da manhã)
    (crontab -l 2>/dev/null; echo "0 2 * * * $DEPLOY_DIR/backup.sh >> $DEPLOY_DIR/backups/backup.log 2>&1") | crontab -
    log "Backup automático configurado (todo dia às 2h)"
fi

# ── Exibe resumo final ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   VisãoOS Deploy Concluído!                          ${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  SALVE ESTAS SENHAS — NÃO SERÃO EXIBIDAS NOVAMENTE  ${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Sistema VisãoOS:"
echo "    URL:   https://$DOMAIN"
echo "    Login: admin@$DOMAIN"
echo "    Senha: admin123  ← TROQUE AGORA!"
echo ""
echo "  Banco de dados:"
echo "    Usuario: visaoos_user"
echo "    Senha:   $DB_PASS"
echo ""
if command -v docker >/dev/null 2>&1; then
echo "  n8n (Automação):"
echo "    URL:   https://n8n.$DOMAIN"
echo "    Login: admin / $N8N_PASS"
echo ""
echo "  Nextcloud (Arquivos):"
echo "    URL:   https://cloud.$DOMAIN"
echo "    Login: admin / $NC_PASS"
echo ""
echo "  Metabase (Dashboards):"
echo "    URL:   https://metabase.$DOMAIN"
echo ""
echo "  Mautic (Marketing):"
echo "    URL:   https://mautic.$DOMAIN"
echo ""
echo "  Jenkins (CI/CD):"
echo "    URL:   https://ci.$DOMAIN"
echo ""
fi
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}PRÓXIMOS PASSOS:${NC}"
echo "  1. Configure subdomínios DNS apontando para IP: $(curl -s4 ifconfig.me 2>/dev/null || echo 'SEU_IP_DO_SERVIDOR')"
echo "     → n8n.$DOMAIN"
echo "     → metabase.$DOMAIN"
echo "     → cloud.$DOMAIN"
echo "     → mautic.$DOMAIN"
echo "     → ci.$DOMAIN"
echo ""
echo "  2. Acesse o sistema: https://$DOMAIN"
echo "  3. Faça login e troque a senha padrão"
echo "  4. Importe workflows n8n de: $WORK_DIR/n8n/workflows/"
echo ""
echo -e "${RED}  IMPORTANTE: Troque a senha admin123 imediatamente!${NC}"
echo ""

# Salva resumo em arquivo
cat > "$DEPLOY_DIR/SENHAS-DEPLOY.txt" <<SENHASEOF
VisãoOS — Senhas Geradas em $(date)
======================================

Sistema: https://$DOMAIN
Login: admin@$DOMAIN / admin123 (TROQUE!)

DB MySQL:
  usuario: visaoos_user
  senha:   $DB_PASS

n8n: https://n8n.$DOMAIN
  admin / $N8N_PASS

Nextcloud: https://cloud.$DOMAIN
  admin / $NC_PASS
  DB pass: $NC_DB_PASS

Mautic: https://mautic.$DOMAIN
  DB pass: $MAUTIC_DB_PASS

JWT Secret: $JWT_SECRET
WS Secret: $WS_SECRET
SENHASEOF
chmod 600 "$DEPLOY_DIR/SENHAS-DEPLOY.txt"
log "Senhas salvas em: $DEPLOY_DIR/SENHAS-DEPLOY.txt"
