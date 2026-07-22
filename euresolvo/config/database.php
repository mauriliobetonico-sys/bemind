<?php
// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — Configuração de Banco de Dados + Constantes
// Marketplace de instalação e manutenção de comunicação visual
// ══════════════════════════════════════════════════════════════════════════

// Carrega .env procurando na raiz do site e em diretórios pai
foreach ([
    __DIR__ . '/../.env',
    __DIR__ . '/../../.env',
    dirname($_SERVER['DOCUMENT_ROOT'] ?? '') . '/.env',
] as $_envFile) {
    if (file_exists($_envFile)) {
        foreach (file($_envFile) as $line) {
            $line = trim($line);
            if ($line && !str_starts_with($line, '#') && str_contains($line, '=')) {
                [$k, $v] = explode('=', $line, 2);
                if (!array_key_exists(trim($k), $_ENV)) {
                    $_ENV[trim($k)] = trim($v);
                    putenv(trim($k) . '=' . trim($v));
                }
            }
        }
        break;
    }
}

// ── Banco de Dados ────────────────────────────────────────────────────────
define('DB_HOST',    getenv('DB_HOST')    ?: 'localhost');
define('DB_PORT',    getenv('DB_PORT')    ?: '3306');
define('DB_NAME',    getenv('DB_NAME')    ?: 'euresolvo');
define('DB_USER',    getenv('DB_USER')    ?: 'root');
define('DB_PASS',    getenv('DB_PASS')    ?: '');
define('DB_CHARSET', 'utf8mb4');

// ── App ───────────────────────────────────────────────────────────────────
define('APP_URL',     rtrim(getenv('APP_URL') ?: 'http://localhost', '/'));
define('APP_NAME',    getenv('APP_NAME') ?: 'EU RESOLVO');
define('APP_VERSION', '1.0.0');
define('APP_ENV',     getenv('APP_ENV') ?: 'production');

// ── JWT ───────────────────────────────────────────────────────────────────
define('JWT_SECRET',          getenv('JWT_SECRET') ?: 'euresolvo_secret_mude_' . gethostname());
define('JWT_EXPIRES',         (int)(getenv('JWT_EXPIRES') ?: 86400));
define('JWT_REFRESH_EXPIRES', (int)(getenv('JWT_REFRESH_EXPIRES') ?: 2592000));

// ── Upload ────────────────────────────────────────────────────────────────
define('UPLOAD_DIR',    __DIR__ . '/../uploads/');
define('UPLOAD_MAX_MB', (int)(getenv('UPLOAD_MAX_MB') ?: 20));
define('ALLOWED_EXTS',  ['jpg','jpeg','png','gif','webp','pdf','svg','heic','heif','mp4','mov']);

// ── Integrações ───────────────────────────────────────────────────────────
define('N8N_WEBHOOK_BASE',   rtrim(getenv('N8N_WEBHOOK_BASE') ?: '', '/'));
define('N8N_API_KEY',        getenv('N8N_API_KEY') ?: '');

// Mercado Pago (PIX + Cartão + Marketplace)
define('MP_ACCESS_TOKEN',    getenv('MP_ACCESS_TOKEN') ?: '');
define('MP_PUBLIC_KEY',      getenv('MP_PUBLIC_KEY') ?: '');
define('MP_WEBHOOK_SECRET',  getenv('MP_WEBHOOK_SECRET') ?: '');
define('MP_MARKETPLACE_FEE', (float)(getenv('MP_MARKETPLACE_FEE') ?: 20)); // % padrão

// Stripe (opcional — cartão internacional)
define('STRIPE_SECRET',      getenv('STRIPE_SECRET') ?: '');
define('STRIPE_WEBHOOK_SEC', getenv('STRIPE_WEBHOOK_SECRET') ?: '');

// Geocoding / Mapas
define('MAPS_PROVIDER',      getenv('MAPS_PROVIDER') ?: 'openstreetmap'); // openstreetmap|google|mapbox
define('MAPS_API_KEY',       getenv('MAPS_API_KEY') ?: '');

// SMTP
define('SMTP_HOST',      getenv('SMTP_HOST') ?: '');
define('SMTP_PORT',      (int)(getenv('SMTP_PORT') ?: 587));
define('SMTP_USER',      getenv('SMTP_USER') ?: '');
define('SMTP_PASS',      getenv('SMTP_PASS') ?: '');
define('SMTP_FROM_NAME', getenv('SMTP_FROM_NAME') ?: 'EU RESOLVO');
define('SMTP_FROM_ADDR', getenv('SMTP_FROM_ADDR') ?: 'noreply@euresolvo.com.br');

// WebSocket
define('WS_URL',    getenv('WS_URL')    ?: 'ws://localhost:6001/ws');
define('WS_HTTP',   getenv('WS_HTTP')   ?: 'http://localhost:6001');
define('WS_SECRET', getenv('WS_SECRET') ?: JWT_SECRET);

// Regras de negócio (defaults, override via .env)
define('DEFAULT_COMMISSION_PCT', (float)(getenv('DEFAULT_COMMISSION_PCT') ?: 20));
define('OFFER_TTL_SECONDS',      (int)(getenv('OFFER_TTL_SECONDS') ?: 180));
define('DEFAULT_SEARCH_RADIUS_KM', (int)(getenv('DEFAULT_SEARCH_RADIUS_KM') ?: 25));

// ── PDO singleton ─────────────────────────────────────────────────────────
function getDB(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=%s',
        DB_HOST, DB_PORT, DB_NAME, DB_CHARSET);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '-03:00'",
    ]);
    return $pdo;
}

// ── Rate limiting via banco (protege endpoints públicos) ──────────────────
function checkRateLimit(string $key, int $maxRequests = 200, int $windowSeconds = 60): void {
    try {
        $db  = getDB();
        $now = time();
        $hash = md5($key);

        $db->exec("CREATE TABLE IF NOT EXISTS er_rate_limits (
            key_hash     VARCHAR(32) PRIMARY KEY,
            count        INT NOT NULL DEFAULT 0,
            window_start INT NOT NULL,
            INDEX idx_window (window_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        $db->exec("DELETE FROM er_rate_limits WHERE window_start < " . ($now - $windowSeconds * 4));

        $stmt = $db->prepare(
            "INSERT INTO er_rate_limits (key_hash, count, window_start) VALUES (?,1,?)
             ON DUPLICATE KEY UPDATE
               count = IF(window_start < ?, 1, count+1),
               window_start = IF(window_start < ?, ?, window_start)"
        );
        $stmt->execute([$hash, $now, $now - $windowSeconds, $now - $windowSeconds, $now]);

        $row = $db->prepare("SELECT count FROM er_rate_limits WHERE key_hash=?");
        $row->execute([$hash]);
        $count = (int)($row->fetchColumn() ?? 0);

        if ($count > $maxRequests) {
            http_response_code(429);
            die(json_encode(['error' => 'Muitas requisições. Aguarde 1 minuto.', 'code' => 'RATE_LIMIT']));
        }
    } catch (Throwable) { /* não bloqueia se o banco falhar */ }
}

// ── Instalação/migração automática do schema ──────────────────────────────
function installDB(): void {
    $db = getDB();

    // Usuários (auth compartilhado — role define perfil)
    $db->exec("CREATE TABLE IF NOT EXISTS users (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        name           VARCHAR(120) NOT NULL,
        email          VARCHAR(160) NOT NULL UNIQUE,
        phone          VARCHAR(20),
        password_hash  VARCHAR(255) NOT NULL,
        role           ENUM('empresa','instalador','admin','operador') NOT NULL DEFAULT 'empresa',
        avatar_url     VARCHAR(500),
        active         TINYINT(1) NOT NULL DEFAULT 1,
        email_verified TINYINT(1) NOT NULL DEFAULT 0,
        phone_verified TINYINT(1) NOT NULL DEFAULT 0,
        login_attempts INT NOT NULL DEFAULT 0,
        locked_until   DATETIME NULL,
        last_login     DATETIME NULL,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_role (role),
        INDEX idx_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        ip_address VARCHAR(45),
        user_agent VARCHAR(255),
        revoked    TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Empresas
    $db->exec("CREATE TABLE IF NOT EXISTS companies (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        user_id       INT NOT NULL UNIQUE,
        cnpj          VARCHAR(18) NOT NULL UNIQUE,
        razao_social  VARCHAR(180) NOT NULL,
        nome_fantasia VARCHAR(180),
        segment       VARCHAR(80),
        contact_name  VARCHAR(120),
        contact_email VARCHAR(160),
        contact_phone VARCHAR(20),
        billing_email VARCHAR(160),
        status        ENUM('ativa','pendente','suspensa','banida') NOT NULL DEFAULT 'pendente',
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS company_branches (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        company_id     INT NOT NULL,
        name           VARCHAR(120) NOT NULL,
        cost_center    VARCHAR(60),
        address_street VARCHAR(200),
        address_number VARCHAR(20),
        address_complement VARCHAR(80),
        address_district VARCHAR(80),
        address_city   VARCHAR(80),
        address_state  VARCHAR(2),
        address_zip    VARCHAR(10),
        lat            DECIMAL(10,7),
        lng            DECIMAL(10,7),
        active         TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        INDEX idx_company (company_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Instaladores
    $db->exec("CREATE TABLE IF NOT EXISTS installers (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        user_id             INT NOT NULL UNIQUE,
        cpf                 VARCHAR(14) NOT NULL UNIQUE,
        cnpj                VARCHAR(18),
        full_name           VARCHAR(180) NOT NULL,
        birth_date          DATE,
        pix_key             VARCHAR(160),
        pix_key_type        ENUM('cpf','cnpj','email','phone','random') NULL,
        bank_name           VARCHAR(80),
        bank_agency         VARCHAR(20),
        bank_account        VARCHAR(30),
        bank_account_type   ENUM('corrente','poupanca') NULL,
        specialties         JSON,
        tools               JSON,
        transport           JSON,
        service_radius_km   INT NOT NULL DEFAULT 25,
        base_address        VARCHAR(240),
        base_lat            DECIMAL(10,7),
        base_lng            DECIMAL(10,7),
        current_lat         DECIMAL(10,7),
        current_lng         DECIMAL(10,7),
        last_ping_at        DATETIME NULL,
        rating_avg          DECIMAL(3,2) NOT NULL DEFAULT 0,
        rating_count        INT NOT NULL DEFAULT 0,
        completed_count     INT NOT NULL DEFAULT 0,
        cancelled_count     INT NOT NULL DEFAULT 0,
        acceptance_rate     DECIMAL(5,2) NOT NULL DEFAULT 0,
        avg_execution_min   INT NOT NULL DEFAULT 0,
        level               ENUM('bronze','prata','ouro','diamante') NOT NULL DEFAULT 'bronze',
        status              ENUM('pendente','aprovado','suspenso','banido') NOT NULL DEFAULT 'pendente',
        online              TINYINT(1) NOT NULL DEFAULT 0,
        available           TINYINT(1) NOT NULL DEFAULT 1,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_status (status),
        INDEX idx_online (online),
        INDEX idx_level (level),
        INDEX idx_geo (base_lat, base_lng)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS installer_documents (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        installer_id  INT NOT NULL,
        doc_type      ENUM('rg','cpf','cnh','proof_address','pj_contract','tax_docs','insurance','certification','other') NOT NULL,
        file_path     VARCHAR(500) NOT NULL,
        original_name VARCHAR(200),
        mime_type     VARCHAR(80),
        status        ENUM('pendente','aprovado','rejeitado') NOT NULL DEFAULT 'pendente',
        review_notes  TEXT,
        reviewed_by   INT NULL,
        reviewed_at   DATETIME NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (installer_id) REFERENCES installers(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_installer (installer_id),
        INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Ordens de serviço (Nova OS → publicada → matched → aceita → em execução → concluída)
    $db->exec("CREATE TABLE IF NOT EXISTS service_orders (
        id                 INT AUTO_INCREMENT PRIMARY KEY,
        os_number          VARCHAR(20) NOT NULL UNIQUE,
        company_id         INT NOT NULL,
        branch_id          INT NULL,
        installer_id       INT NULL,
        created_by         INT NOT NULL,
        category           VARCHAR(60) NOT NULL,
        title              VARCHAR(180) NOT NULL,
        description        TEXT NOT NULL,
        scheduled_for      DATETIME NULL,
        urgency            ENUM('normal','urgente','hoje') NOT NULL DEFAULT 'normal',
        match_mode         ENUM('automatico','manual') NOT NULL DEFAULT 'automatico',
        address_street     VARCHAR(240),
        address_number     VARCHAR(20),
        address_complement VARCHAR(80),
        address_district   VARCHAR(80),
        address_city       VARCHAR(80),
        address_state      VARCHAR(2),
        address_zip        VARCHAR(10),
        lat                DECIMAL(10,7),
        lng                DECIMAL(10,7),
        offered_value      DECIMAL(10,2) NOT NULL DEFAULT 0,
        commission_pct     DECIMAL(5,2) NOT NULL DEFAULT 20,
        commission_value   DECIMAL(10,2) NOT NULL DEFAULT 0,
        net_to_installer   DECIMAL(10,2) NOT NULL DEFAULT 0,
        payment_method     ENUM('pix','cartao','saldo') NOT NULL DEFAULT 'pix',
        status             ENUM('draft','published','matched','accepted','en_route','checked_in','in_progress','completed','paid_out','cancelled','disputed') NOT NULL DEFAULT 'draft',
        eta_minutes        INT NULL,
        started_at         DATETIME NULL,
        checked_in_at      DATETIME NULL,
        completed_at       DATETIME NULL,
        cancelled_at       DATETIME NULL,
        cancelled_reason   TEXT,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id)  REFERENCES companies(id),
        FOREIGN KEY (branch_id)   REFERENCES company_branches(id) ON DELETE SET NULL,
        FOREIGN KEY (installer_id) REFERENCES installers(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by)  REFERENCES users(id),
        INDEX idx_status (status),
        INDEX idx_company (company_id),
        INDEX idx_installer (installer_id),
        INDEX idx_geo (lat, lng),
        INDEX idx_urgency (urgency)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS order_requirements (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        order_id     INT NOT NULL,
        requirement  VARCHAR(60) NOT NULL,
        FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
        UNIQUE KEY uq_order_req (order_id, requirement)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS order_attachments (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        order_id      INT NOT NULL,
        kind          ENUM('brief','before','after','signature','doc') NOT NULL DEFAULT 'brief',
        file_path     VARCHAR(500) NOT NULL,
        original_name VARCHAR(200),
        mime_type     VARCHAR(80),
        uploaded_by   INT NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_order_kind (order_id, kind)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS order_checklist_items (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        order_id   INT NOT NULL,
        item       VARCHAR(240) NOT NULL,
        done       TINYINT(1) NOT NULL DEFAULT 0,
        done_at    DATETIME NULL,
        seq        INT NOT NULL DEFAULT 0,
        FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
        INDEX idx_order (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Ofertas (match log — todas as ofertas enviadas a instaladores)
    $db->exec("CREATE TABLE IF NOT EXISTS offers (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        order_id     INT NOT NULL,
        installer_id INT NOT NULL,
        score        DECIMAL(6,3) NOT NULL DEFAULT 0,
        score_breakdown JSON,
        status       ENUM('pending','accepted','declined','expired','withdrawn','counter') NOT NULL DEFAULT 'pending',
        counter_value DECIMAL(10,2) NULL,
        counter_notes TEXT,
        expires_at   DATETIME NOT NULL,
        responded_at DATETIME NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (installer_id) REFERENCES installers(id) ON DELETE CASCADE,
        INDEX idx_order (order_id),
        INDEX idx_installer_status (installer_id, status),
        INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Chat
    $db->exec("CREATE TABLE IF NOT EXISTS chat_messages (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        order_id   INT NOT NULL,
        sender_id  INT NOT NULL,
        body       TEXT NOT NULL,
        file_path  VARCHAR(500),
        read_at    DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_order (order_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Rastreamento em tempo real (pings de localização, retenção curta)
    $db->exec("CREATE TABLE IF NOT EXISTS location_pings (
        id           BIGINT AUTO_INCREMENT PRIMARY KEY,
        order_id     INT NULL,
        installer_id INT NOT NULL,
        lat          DECIMAL(10,7) NOT NULL,
        lng          DECIMAL(10,7) NOT NULL,
        accuracy_m   INT NULL,
        speed_kmh    DECIMAL(6,2) NULL,
        heading_deg  INT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_order (order_id, created_at),
        INDEX idx_installer (installer_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Avaliações bidirecionais
    $db->exec("CREATE TABLE IF NOT EXISTS ratings (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        order_id     INT NOT NULL,
        rater_id     INT NOT NULL,
        target_id    INT NOT NULL,
        target_role  ENUM('empresa','instalador') NOT NULL,
        stars        TINYINT NOT NULL,
        comment      TEXT,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
        UNIQUE KEY uq_rating (order_id, rater_id, target_id),
        INDEX idx_target (target_id, target_role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Financeiro — carteira, ledger (append-only), payouts, transações
    $db->exec("CREATE TABLE IF NOT EXISTS wallets (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        user_id         INT NOT NULL UNIQUE,
        balance_cents   BIGINT NOT NULL DEFAULT 0,
        held_cents      BIGINT NOT NULL DEFAULT 0,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Ledger imutável (append-only): saldo é sempre derivado
    $db->exec("CREATE TABLE IF NOT EXISTS ledger_entries (
        id             BIGINT AUTO_INCREMENT PRIMARY KEY,
        wallet_id      INT NOT NULL,
        order_id       INT NULL,
        entry_type     ENUM('credit','debit','hold','release','commission','refund','payout','adjustment') NOT NULL,
        amount_cents   BIGINT NOT NULL,
        balance_after  BIGINT NOT NULL,
        held_after     BIGINT NOT NULL,
        description    VARCHAR(240),
        reference      VARCHAR(120),
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
        FOREIGN KEY (order_id)  REFERENCES service_orders(id) ON DELETE SET NULL,
        INDEX idx_wallet (wallet_id, id),
        INDEX idx_order (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Transações com PSP (Mercado Pago, Stripe, etc.)
    $db->exec("CREATE TABLE IF NOT EXISTS payment_transactions (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        order_id        INT NULL,
        user_id         INT NOT NULL,
        provider        ENUM('mercadopago','stripe','manual') NOT NULL DEFAULT 'mercadopago',
        provider_ref    VARCHAR(120),
        kind            ENUM('funding','payout','refund') NOT NULL DEFAULT 'funding',
        method          ENUM('pix','cartao','boleto','saldo','other') NOT NULL DEFAULT 'pix',
        status          ENUM('pending','authorized','captured','failed','refunded','cancelled') NOT NULL DEFAULT 'pending',
        gross_cents     BIGINT NOT NULL,
        fee_cents       BIGINT NOT NULL DEFAULT 0,
        net_cents       BIGINT NOT NULL,
        raw_payload     JSON,
        processed_at    DATETIME NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_order (order_id),
        INDEX idx_status (status),
        INDEX idx_provider_ref (provider, provider_ref)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS payouts (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        installer_id   INT NOT NULL,
        wallet_id      INT NOT NULL,
        amount_cents   BIGINT NOT NULL,
        method         ENUM('pix') NOT NULL DEFAULT 'pix',
        pix_key        VARCHAR(160),
        status         ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
        provider       ENUM('mercadopago','manual') NOT NULL DEFAULT 'mercadopago',
        provider_ref   VARCHAR(120),
        error_message  TEXT,
        requested_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at        DATETIME NULL,
        FOREIGN KEY (installer_id) REFERENCES installers(id) ON DELETE CASCADE,
        FOREIGN KEY (wallet_id)    REFERENCES wallets(id) ON DELETE CASCADE,
        INDEX idx_status (status),
        INDEX idx_installer (installer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Regras de comissão (por categoria e nível)
    $db->exec("CREATE TABLE IF NOT EXISTS commission_rules (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        category       VARCHAR(60) NULL,
        level          ENUM('bronze','prata','ouro','diamante') NULL,
        pct            DECIMAL(5,2) NOT NULL,
        active         TINYINT(1) NOT NULL DEFAULT 1,
        priority       INT NOT NULL DEFAULT 0,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_lookup (category, level, active, priority)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Disputas e tickets
    $db->exec("CREATE TABLE IF NOT EXISTS disputes (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        order_id      INT NOT NULL,
        opened_by     INT NOT NULL,
        reason        VARCHAR(120) NOT NULL,
        description   TEXT,
        status        ENUM('aberta','em_analise','resolvida','recusada') NOT NULL DEFAULT 'aberta',
        resolution    TEXT,
        resolved_by   INT NULL,
        resolved_at   DATETIME NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS support_tickets (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        user_id       INT NULL,
        subject       VARCHAR(180) NOT NULL,
        body          TEXT,
        priority      ENUM('baixa','media','alta','critica') NOT NULL DEFAULT 'media',
        status        ENUM('aberto','em_atendimento','resolvido','fechado') NOT NULL DEFAULT 'aberto',
        assigned_to   INT NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_status_priority (status, priority)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Leads capturados do site institucional
    $db->exec("CREATE TABLE IF NOT EXISTS leads (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        kind          ENUM('empresa','instalador') NOT NULL,
        name          VARCHAR(180) NOT NULL,
        email         VARCHAR(180) NOT NULL,
        phone         VARCHAR(20),
        document      VARCHAR(20),
        company_name  VARCHAR(180),
        city          VARCHAR(80),
        state         VARCHAR(2),
        message       TEXT,
        source        VARCHAR(60),
        status        ENUM('novo','contatado','convertido','descartado') NOT NULL DEFAULT 'novo',
        ip            VARCHAR(45),
        user_agent    VARCHAR(255),
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_kind (kind)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Logs de auditoria (imutável — nunca update/delete)
    $db->exec("CREATE TABLE IF NOT EXISTS audit_logs (
        id            BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id       INT NULL,
        action        VARCHAR(80) NOT NULL,
        entity_type   VARCHAR(60),
        entity_id     INT,
        payload       JSON,
        ip_address    VARCHAR(45),
        user_agent    VARCHAR(255),
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_created (user_id, created_at),
        INDEX idx_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Idempotência de webhooks (dedup por event id)
    $db->exec("CREATE TABLE IF NOT EXISTS webhook_events (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        provider     VARCHAR(40) NOT NULL,
        event_id     VARCHAR(120) NOT NULL,
        event_type   VARCHAR(80),
        payload      JSON,
        processed    TINYINT(1) NOT NULL DEFAULT 0,
        received_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_event (provider, event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Sessões (opcional, para admin panel)
    $db->exec("CREATE TABLE IF NOT EXISTS sessions (
        id          VARCHAR(64) PRIMARY KEY,
        user_id     INT NOT NULL,
        ip_address  VARCHAR(45),
        user_agent  VARCHAR(255),
        last_active DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        expires_at  DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Notificações in-app
    $db->exec("CREATE TABLE IF NOT EXISTS notifications (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT NOT NULL,
        title       VARCHAR(180) NOT NULL,
        body        TEXT,
        icon        VARCHAR(40),
        deep_link   VARCHAR(240),
        read_at     DATETIME NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_read (user_id, read_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Bootstrap admin + regra de comissão padrão + categorias-base
    $count = $db->query("SELECT COUNT(*) FROM users")->fetchColumn();
    if ($count == 0) {
        $adminEmail = getenv('ADMIN_EMAIL') ?: 'admin@euresolvo.com.br';
        $adminPass  = getenv('ADMIN_PASSWORD') ?: 'admin123';
        $hash = password_hash($adminPass, PASSWORD_BCRYPT, ['cost' => 12]);
        $db->prepare("INSERT INTO users (name,email,password_hash,role,active,email_verified) VALUES (?,?,?,?,1,1)")
           ->execute(['Administrador', $adminEmail, $hash, 'admin']);
        $adminId = (int)$db->lastInsertId();
        $db->prepare("INSERT INTO wallets (user_id, balance_cents, held_cents) VALUES (?,0,0)")
           ->execute([$adminId]);
    }

    $ruleCount = $db->query("SELECT COUNT(*) FROM commission_rules")->fetchColumn();
    if ($ruleCount == 0) {
        $db->prepare("INSERT INTO commission_rules (category,level,pct,active,priority) VALUES (NULL,NULL,?,1,0)")
           ->execute([DEFAULT_COMMISSION_PCT]);
    }
}

try { installDB(); } catch (Throwable $e) {
    error_log('EU RESOLVO DB Install: ' . $e->getMessage());
}
