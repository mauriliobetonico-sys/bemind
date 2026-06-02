-- ══════════════════════════════════════════════════════════════════════════
-- VISÃOOS — Schema do Banco de Dados (importação MANUAL opcional)
-- ══════════════════════════════════════════════════════════════════════════
-- ATENÇÃO: Você NÃO precisa importar este arquivo na maioria dos casos.
-- O sistema cria todas as tabelas automaticamente no primeiro acesso
-- (função installDB() em config/database.php).
--
-- Use este arquivo apenas se quiser criar as tabelas manualmente
-- (ex.: via phpMyAdmin → Importar, ou: mysql -u USER -p BANCO < schema.sql).
-- ══════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

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
    commission_pct  DECIMAL(5,2) NOT NULL DEFAULT 0,
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

SET FOREIGN_KEY_CHECKS = 1;

-- ══════════════════════════════════════════════════════════════════════════
-- NOTA: O usuário admin e os dados de exemplo (materiais/serviços) NÃO são
-- criados por este arquivo. Eles são inseridos automaticamente pelo sistema
-- no primeiro acesso, quando a tabela `users` está vazia (ver installDB()).
-- ══════════════════════════════════════════════════════════════════════════
