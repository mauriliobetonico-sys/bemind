<?php
// ══════════════════════════════════════════════════════════════════════════
// VISÃOOS — Configuração do Banco de Dados e Constantes
// ══════════════════════════════════════════════════════════════════════════

// Carrega .env — procura na raiz do site e nos diretórios pai
foreach ([
    __DIR__ . '/../.env',   // web root (config/../.env)
    __DIR__ . '/../../.env', // um nível acima do web root
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
define('DB_NAME',    getenv('DB_NAME')    ?: 'visaoos');
define('DB_USER',    getenv('DB_USER')    ?: 'root');
define('DB_PASS',    getenv('DB_PASS')    ?: '');
define('DB_CHARSET', 'utf8mb4');

// URL base (sem barra no final)
define('APP_URL',     rtrim(getenv('APP_URL') ?: 'http://localhost', '/'));
define('APP_VERSION', '2.0.0');

// JWT
define('JWT_SECRET',  getenv('JWT_SECRET')  ?: 'visaoos_secret_mude_em_producao_' . gethostname());
define('JWT_EXPIRES', (int)(getenv('JWT_EXPIRES') ?: 86400));
define('JWT_REFRESH_EXPIRES', 604800); // 7 dias

// Upload
define('UPLOAD_DIR',    __DIR__ . '/../uploads/');
define('UPLOAD_MAX_MB', 20);
define('ALLOWED_EXTS',  ['jpg','jpeg','png','gif','webp','pdf','svg','psd','ai','eps','zip','rar','cdr','tiff']);

// Integrações
define('N8N_WEBHOOK_BASE',  rtrim(getenv('N8N_WEBHOOK_BASE') ?: '', '/'));
define('N8N_API_KEY',       getenv('N8N_API_KEY') ?: '');
define('NEXTCLOUD_URL',     rtrim(getenv('NEXTCLOUD_URL') ?: '', '/'));
define('NEXTCLOUD_USER',    getenv('NEXTCLOUD_USER') ?: '');
define('NEXTCLOUD_PASS',    getenv('NEXTCLOUD_PASS') ?: '');
define('NEXTCLOUD_FOLDER',  getenv('NEXTCLOUD_FOLDER') ?: '/VisaoOS/uploads');
define('MP_ACCESS_TOKEN',   getenv('MP_ACCESS_TOKEN') ?: '');
define('MP_WEBHOOK_SECRET', getenv('MP_WEBHOOK_SECRET') ?: '');
define('WS_SECRET',         getenv('WS_SECRET') ?: JWT_SECRET);

// ── PDO singleton ──────────────────────────────────────────────────────────
function getDB(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=%s',
        DB_HOST, DB_PORT, DB_NAME, DB_CHARSET);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
    ]);
    return $pdo;
}

// ── Rate Limiting via banco (resiliente a múltiplos processos) ─────────────
function checkRateLimit(string $ip, int $maxRequests = 200, int $windowSeconds = 60): void {
    try {
        $db  = getDB();
        $now = time();
        $key = md5($ip);

        $db->exec("CREATE TABLE IF NOT EXISTS rate_limits (
            ip_hash    VARCHAR(32) PRIMARY KEY,
            count      INT NOT NULL DEFAULT 0,
            window_start INT NOT NULL,
            INDEX idx_window (window_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        $db->exec("DELETE FROM rate_limits WHERE window_start < " . ($now - $windowSeconds * 2));

        $stmt = $db->prepare(
            "INSERT INTO rate_limits (ip_hash, count, window_start) VALUES (?,1,?)
             ON DUPLICATE KEY UPDATE
               count = IF(window_start < ?, 1, count+1),
               window_start = IF(window_start < ?, ?, window_start)"
        );
        $stmt->execute([$key, $now, $now - $windowSeconds, $now - $windowSeconds, $now]);

        $row = $db->prepare("SELECT count FROM rate_limits WHERE ip_hash=?");
        $row->execute([$key]);
        $count = (int)($row->fetchColumn() ?? 0);

        if ($count > $maxRequests) {
            http_response_code(429);
            die(json_encode(['error' => 'Muitas requisições. Aguarde 1 minuto.']));
        }
    } catch (Throwable) {
        // Se o banco falhar no rate limit, deixa passar (não bloqueia o sistema)
    }
}

// ── Instalação automática do banco ────────────────────────────────────────
function installDB(): void {
    $db = getDB();
    $db->exec("
    CREATE TABLE IF NOT EXISTS users (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(120) NOT NULL,
        email           VARCHAR(120) NOT NULL UNIQUE,
        password_hash   VARCHAR(255) NOT NULL,
        role            ENUM('admin','atendimento','producao','financeiro') NOT NULL DEFAULT 'atendimento',
        active          TINYINT(1) NOT NULL DEFAULT 1,
        login_attempts  INT NOT NULL DEFAULT 0,
        locked_until    DATETIME NULL,
        last_login      DATETIME NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT NOT NULL,
        token_hash  VARCHAR(64) NOT NULL UNIQUE,
        expires_at  DATETIME NOT NULL,
        ip_address  VARCHAR(45),
        revoked     TINYINT(1) NOT NULL DEFAULT 0,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_token (token_hash),
        INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS sessions (
        id          VARCHAR(64) PRIMARY KEY,
        user_id     INT NOT NULL,
        ip_address  VARCHAR(45),
        user_agent  VARCHAR(255),
        last_active DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        expires_at  DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS clients (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(150) NOT NULL,
        cpf_cnpj        VARCHAR(20),
        type            ENUM('cliente','revendedor') NOT NULL DEFAULT 'cliente',
        email           VARCHAR(120),
        phone_main      VARCHAR(20),
        phone_whatsapp  VARCHAR(20),
        address_street  VARCHAR(200),
        address_city    VARCHAR(80),
        address_state   VARCHAR(2),
        address_zip     VARCHAR(10),
        notes           TEXT,
        active          TINYINT(1) NOT NULL DEFAULT 1,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS materials (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(150) NOT NULL,
        unit            VARCHAR(20) DEFAULT 'm²',
        price_client    DECIMAL(10,2) NOT NULL DEFAULT 0,
        price_reseller  DECIMAL(10,2) NOT NULL DEFAULT 0,
        stock_qty       DECIMAL(10,3) DEFAULT 0,
        active          TINYINT(1) NOT NULL DEFAULT 1,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS services (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(150) NOT NULL,
        unit            VARCHAR(20) DEFAULT 'un',
        price_client    DECIMAL(10,2) NOT NULL DEFAULT 0,
        price_reseller  DECIMAL(10,2) NOT NULL DEFAULT 0,
        estimated_days  INT DEFAULT 1,
        active          TINYINT(1) NOT NULL DEFAULT 1,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS service_orders (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        os_number       VARCHAR(20) NOT NULL UNIQUE,
        client_id       INT NOT NULL,
        attendant_id    INT,
        production_id   INT,
        client_type     ENUM('cliente','revendedor') DEFAULT 'cliente',
        description     TEXT NOT NULL,
        notes           TEXT,
        technical_notes TEXT,
        width_m         DECIMAL(8,2),
        height_m        DECIMAL(8,2),
        area_m2         DECIMAL(10,4),
        quantity        DECIMAL(10,3) NOT NULL DEFAULT 1,
        subtotal        DECIMAL(10,2) NOT NULL DEFAULT 0,
        discount_pct    DECIMAL(5,2)  NOT NULL DEFAULT 0,
        discount_val    DECIMAL(10,2) NOT NULL DEFAULT 0,
        total           DECIMAL(10,2) NOT NULL DEFAULT 0,
        status          ENUM('aguardando','producao','finalizado','entregue') NOT NULL DEFAULT 'aguardando',
        payment_status  ENUM('pendente','parcial','pago') NOT NULL DEFAULT 'pendente',
        payment_method  VARCHAR(40),
        payment_date    DATE,
        due_date        DATE,
        delivery_date   DATETIME,
        tracking_token  VARCHAR(64) UNIQUE,
        n8n_notified    TINYINT(1) NOT NULL DEFAULT 0,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id)     REFERENCES clients(id),
        FOREIGN KEY (attendant_id)  REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (production_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS os_items (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        os_id       INT NOT NULL,
        type        ENUM('material','service') NOT NULL,
        item_id     INT,
        name        VARCHAR(150) NOT NULL,
        unit        VARCHAR(20),
        quantity    DECIMAL(10,3) NOT NULL DEFAULT 1,
        unit_price  DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        FOREIGN KEY (os_id) REFERENCES service_orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS os_files (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        os_id         INT NOT NULL,
        filename      VARCHAR(200) NOT NULL,
        original_name VARCHAR(200),
        file_path     VARCHAR(500),
        nextcloud_path VARCHAR(500),
        file_size     INT,
        mime_type     VARCHAR(80),
        uploaded_by   INT,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (os_id) REFERENCES service_orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS os_status_history (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        os_id       INT NOT NULL,
        from_status VARCHAR(30),
        to_status   VARCHAR(30) NOT NULL,
        notes       TEXT,
        changed_by  INT,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (os_id) REFERENCES service_orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS payments (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        os_id           INT NOT NULL,
        amount          DECIMAL(10,2) NOT NULL,
        method          VARCHAR(40),
        reference       VARCHAR(100),
        gateway_id      VARCHAR(100),
        notes           TEXT,
        registered_by   INT,
        paid_at         DATETIME,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (os_id) REFERENCES service_orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS quotes (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        quote_number    VARCHAR(20) NOT NULL UNIQUE,
        client_id       INT NOT NULL,
        attendant_id    INT,
        client_type     ENUM('cliente','revendedor') DEFAULT 'cliente',
        description     TEXT NOT NULL,
        notes           TEXT,
        width_m         DECIMAL(8,2),
        height_m        DECIMAL(8,2),
        area_m2         DECIMAL(10,4),
        quantity        DECIMAL(10,3) NOT NULL DEFAULT 1,
        subtotal        DECIMAL(10,2) NOT NULL DEFAULT 0,
        discount_pct    DECIMAL(5,2)  NOT NULL DEFAULT 0,
        discount_val    DECIMAL(10,2) NOT NULL DEFAULT 0,
        total           DECIMAL(10,2) NOT NULL DEFAULT 0,
        status          ENUM('pendente','aprovado','recusado','convertido') NOT NULL DEFAULT 'pendente',
        valid_until     DATE,
        converted_os_id INT,
        n8n_followup_sent TINYINT(1) NOT NULL DEFAULT 0,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id)     REFERENCES clients(id),
        FOREIGN KEY (attendant_id)  REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS suppliers (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(150) NOT NULL,
        contact_name    VARCHAR(120),
        cnpj            VARCHAR(20),
        email           VARCHAR(120),
        phone           VARCHAR(20),
        whatsapp        VARCHAR(20),
        address_street  VARCHAR(200),
        address_city    VARCHAR(80),
        address_state   VARCHAR(2),
        material_types  TEXT,
        notes           TEXT,
        active          TINYINT(1) NOT NULL DEFAULT 1,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS receipts (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        receipt_number  VARCHAR(20) NOT NULL UNIQUE,
        os_id           INT,
        client_id       INT NOT NULL,
        amount          DECIMAL(10,2) NOT NULL,
        description     TEXT NOT NULL,
        payment_method  VARCHAR(40),
        notes           TEXT,
        issued_by       INT,
        issued_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (os_id)       REFERENCES service_orders(id) ON DELETE SET NULL,
        FOREIGN KEY (client_id)   REFERENCES clients(id),
        FOREIGN KEY (issued_by)   REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS activity_logs (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT,
        action      VARCHAR(80),
        entity_type VARCHAR(60),
        entity_id   INT,
        description TEXT,
        ip_address  VARCHAR(45),
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS rate_limits (
        ip_hash      VARCHAR(32) PRIMARY KEY,
        count        INT NOT NULL DEFAULT 0,
        window_start INT NOT NULL,
        INDEX idx_window (window_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");

    // ── Migrações: adiciona colunas que podem não existir no DB antigo ───────
    // Cada ALTER é isolado num try/catch — falha silenciosa se já existir.
    $alters = [
        // clients
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS cpf_cnpj       VARCHAR(20)  NULL",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS type            VARCHAR(20)  NOT NULL DEFAULT 'cliente'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_main      VARCHAR(20)  NULL",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_whatsapp  VARCHAR(20)  NULL",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_street  VARCHAR(200) NULL",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_city    VARCHAR(80)  NULL",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_state   VARCHAR(2)   NULL",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_zip     VARCHAR(10)  NULL",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes           TEXT         NULL",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS active          TINYINT(1)   NOT NULL DEFAULT 1",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at      DATETIME     NULL",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS commission_pct  DECIMAL(5,2) NOT NULL DEFAULT 0",
        // service_orders
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS attendant_id    INT            NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS client_type     VARCHAR(20)    NOT NULL DEFAULT 'cliente'",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS production_id   INT            NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS notes           TEXT           NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS technical_notes TEXT           NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS width_m         DECIMAL(8,2)   NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS height_m        DECIMAL(8,2)   NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS area_m2         DECIMAL(10,4)  NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS quantity        DECIMAL(10,3)  NOT NULL DEFAULT 1",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS subtotal        DECIMAL(10,2)  NOT NULL DEFAULT 0",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS discount_pct    DECIMAL(5,2)   NOT NULL DEFAULT 0",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS discount_val    DECIMAL(10,2)  NOT NULL DEFAULT 0",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS payment_status  VARCHAR(20)    NOT NULL DEFAULT 'pendente'",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS payment_method  VARCHAR(40)    NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS payment_date    DATE           NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS due_date        DATE           NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS delivery_date   DATETIME       NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS tracking_token  VARCHAR(64)    NULL",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS n8n_notified    TINYINT(1)     NOT NULL DEFAULT 0",
        // materials
        "ALTER TABLE materials ADD COLUMN IF NOT EXISTS price_reseller DECIMAL(10,2) NOT NULL DEFAULT 0",
        "ALTER TABLE materials ADD COLUMN IF NOT EXISTS stock_qty      DECIMAL(10,3) DEFAULT 0",
        "ALTER TABLE materials ADD COLUMN IF NOT EXISTS active         TINYINT(1)    NOT NULL DEFAULT 1",
        // services
        "ALTER TABLE services ADD COLUMN IF NOT EXISTS price_reseller  DECIMAL(10,2) NOT NULL DEFAULT 0",
        "ALTER TABLE services ADD COLUMN IF NOT EXISTS estimated_days  INT           NOT NULL DEFAULT 1",
        "ALTER TABLE services ADD COLUMN IF NOT EXISTS active          TINYINT(1)    NOT NULL DEFAULT 1",
        // users
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS active TINYINT(1) NOT NULL DEFAULT 1",
    ];
    foreach ($alters as $sql) {
        try { $db->exec($sql); } catch (Throwable $e) { /* coluna já existe ou MySQL não suporta IF NOT EXISTS */ }
    }

    // Cria admin padrão se não existir
    $count = $db->query("SELECT COUNT(*) FROM users")->fetchColumn();
    if ($count == 0) {
        $hash = password_hash('admin123', PASSWORD_BCRYPT, ['cost'=>12]);
        $adminEmail = getenv('ADMIN_EMAIL') ?: 'admin@bemindmarketing.com.br';
        $db->prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)")
           ->execute(['Administrador', $adminEmail, $hash, 'admin']);

        $mats = [
            ['Lona Frontlit 440g',       'm²', 35.00, 22.00],
            ['Lona Blackout',             'm²', 42.00, 28.00],
            ['Adesivo Vinil Branco',      'm²', 28.00, 18.00],
            ['Adesivo Translúcido',       'm²', 38.00, 24.00],
            ['Placa ACM 3mm',             'm²', 95.00, 70.00],
            ['Tecido para Sublimação',    'm²', 45.00, 30.00],
            ['Lona Mesh 50%',             'm²', 32.00, 20.00],
            ['Adesivo Espelhado',         'm²', 55.00, 38.00],
        ];
        $sm = $db->prepare("INSERT INTO materials (name,unit,price_client,price_reseller) VALUES (?,?,?,?)");
        foreach ($mats as $m) $sm->execute($m);

        $svcs = [
            ['Impressão Digital',         'm²', 15.00, 10.00, 1],
            ['Instalação',                'un', 80.00, 60.00, 1],
            ['Arte e Diagramação',        'un', 120.00,90.00, 2],
            ['Acabamento (Ilhoses)',       'm²', 8.00,  5.00,  1],
            ['Corte a Laser',             'un', 50.00, 35.00, 1],
            ['Sublimação',                'm²', 25.00, 18.00, 2],
            ['Envelopamento Veicular',    'un', 350.00,250.00,3],
        ];
        $ss = $db->prepare("INSERT INTO services (name,unit,price_client,price_reseller,estimated_days) VALUES (?,?,?,?,?)");
        foreach ($svcs as $s) $ss->execute($s);
    }
}

// Executa instalação silenciosa
try { installDB(); } catch (Throwable $e) {
    error_log('VisãoOS DB Install: ' . $e->getMessage());
}
