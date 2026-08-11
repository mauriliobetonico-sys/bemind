-- BE MIND PROPOSALS — schema
-- MySQL 8 / MariaDB 10.6+  ·  utf8mb4_unicode_ci  ·  InnoDB
-- Monetários em DECIMAL(12,2). Formatação R$ 1.500,00 só na apresentação.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(120) NOT NULL,
  `email`          VARCHAR(190) NOT NULL,
  `password_hash`  VARCHAR(255) NOT NULL,
  `role`           ENUM('admin','comercial','editor','viewer') NOT NULL DEFAULT 'comercial',
  `active`         TINYINT(1) NOT NULL DEFAULT 1,
  `last_login_at`  DATETIME NULL,
  `remember_token` VARCHAR(100) NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `clients` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_name`  VARCHAR(180) NOT NULL,
  `trade_name`    VARCHAR(180) NULL,
  `doc`           VARCHAR(20) NULL,
  `contact_name`  VARCHAR(120) NULL,
  `email`         VARCHAR(190) NULL,
  `phone`         VARCHAR(30) NULL,
  `whatsapp`      VARCHAR(30) NULL,
  `address`       VARCHAR(255) NULL,
  `city`          VARCHAR(120) NULL,
  `state`         VARCHAR(2) NULL,
  `segment`       VARCHAR(80) NULL,
  `notes`         TEXT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_clients_company` (`company_name`),
  KEY `ix_clients_doc` (`doc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- client_contacts (histórico)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `client_contacts` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id`   INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NULL,
  `type`        VARCHAR(40) NOT NULL,
  `note`        TEXT NULL,
  `happened_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_client_contacts_client` (`client_id`),
  CONSTRAINT `fk_client_contacts_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_client_contacts_user`   FOREIGN KEY (`user_id`)   REFERENCES `users`   (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- service_categories
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `service_categories` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(80)  NOT NULL,
  `slug`       VARCHAR(80)  NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_service_categories_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- services
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `services` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id`       INT UNSIGNED NOT NULL,
  `name`              VARCHAR(160) NOT NULL,
  `short_description` VARCHAR(255) NULL,
  `full_description`  TEXT NULL,
  `deliverables`      JSON NULL,
  `lead_time`         VARCHAR(80)  NULL,
  `default_price`     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `unit`              ENUM('projeto','hora','mes','ano','unidade','pacote') NOT NULL DEFAULT 'projeto',
  `recurrence`        ENUM('unico','mensal','anual') NOT NULL DEFAULT 'unico',
  `icon`              VARCHAR(80)  NULL,
  `image`             VARCHAR(255) NULL,
  `active`            TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order`        INT NOT NULL DEFAULT 0,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_services_category` (`category_id`),
  CONSTRAINT `fk_services_category` FOREIGN KEY (`category_id`) REFERENCES `service_categories` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- cloud_plans
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cloud_plans` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(80)  NOT NULL,
  `monthly_price`  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `annual_price`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `min_price`      DECIMAL(12,2) NOT NULL DEFAULT 150.00,
  `disk`           VARCHAR(40)  NULL,
  `traffic`        VARCHAR(40)  NULL,
  `sites`          VARCHAR(40)  NULL,
  `mailboxes`      VARCHAR(40)  NULL,
  `databases`      VARCHAR(40)  NULL,
  `ssl`            VARCHAR(40)  NULL,
  `backup`         VARCHAR(80)  NULL,
  `support`        VARCHAR(80)  NULL,
  `migration`      VARCHAR(80)  NULL,
  `notes`          TEXT NULL,
  `active`         TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order`     INT NOT NULL DEFAULT 0,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- proposals
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `proposals` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `number`             VARCHAR(40)  NOT NULL,
  `public_token`       CHAR(32)     NOT NULL,
  `client_id`          INT UNSIGNED NOT NULL,
  `user_id`            INT UNSIGNED NULL,
  `title`              VARCHAR(200) NOT NULL,
  `project`            VARCHAR(200) NULL,
  `summary`            TEXT NULL,
  `status`             ENUM('rascunho','enviada','visualizada','negociacao','alteracao','aprovada','recusada','expirada','cancelada')
                       NOT NULL DEFAULT 'rascunho',
  `issue_date`         DATE NOT NULL,
  `valid_until`        DATE NULL,
  `payment_terms`      VARCHAR(160) NULL,
  `terms_text`         TEXT NULL,
  `discount_percent`   DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  `discount_value`     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `subtotal_monthly`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `subtotal_once`      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_monthly`      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_once`         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `currency`           CHAR(3) NOT NULL DEFAULT 'BRL',
  `template_id`        INT UNSIGNED NULL,
  `first_viewed_at`    DATETIME NULL,
  `last_viewed_at`     DATETIME NULL,
  `views_count`        INT UNSIGNED NOT NULL DEFAULT 0,
  `sent_at`            DATETIME NULL,
  `archived_at`        DATETIME NULL,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proposals_number` (`number`),
  UNIQUE KEY `uq_proposals_token`  (`public_token`),
  KEY `ix_proposals_status_date` (`status`,`issue_date`),
  KEY `ix_proposals_client` (`client_id`),
  CONSTRAINT `fk_proposals_client`   FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_proposals_user`     FOREIGN KEY (`user_id`)   REFERENCES `users`   (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- proposal_sections (seções de conteúdo da proposta pública)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `proposal_sections` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `proposal_id` INT UNSIGNED NOT NULL,
  `kind`        ENUM('capa','apresentacao','projeto','objetivos','solucao','escopo','investimento','cronograma','diferenciais','condicoes','hospedagem','aceite') NOT NULL,
  `title`       VARCHAR(180) NULL,
  `body`        MEDIUMTEXT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  `visible`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_prop_sections_prop` (`proposal_id`,`sort_order`),
  CONSTRAINT `fk_prop_sections_prop` FOREIGN KEY (`proposal_id`) REFERENCES `proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- proposal_items (linhas de escopo)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `proposal_items` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `proposal_id`      INT UNSIGNED NOT NULL,
  `service_id`       INT UNSIGNED NULL,
  `name`             VARCHAR(180) NOT NULL,
  `description`      TEXT NULL,
  `deliverables`     JSON NULL,
  `lead_time`        VARCHAR(80) NULL,
  `quantity`         INT UNSIGNED NOT NULL DEFAULT 1,
  `unit_price`       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `discount_percent` DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  `recurrence`       ENUM('unico','mensal','anual') NOT NULL DEFAULT 'unico',
  `sort_order`       INT NOT NULL DEFAULT 0,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_prop_items_prop` (`proposal_id`,`sort_order`),
  CONSTRAINT `fk_prop_items_prop`    FOREIGN KEY (`proposal_id`) REFERENCES `proposals` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_prop_items_service` FOREIGN KEY (`service_id`)  REFERENCES `services`  (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- proposal_schedule (cronograma)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `proposal_schedule` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `proposal_id` INT UNSIGNED NOT NULL,
  `phase`       VARCHAR(160) NOT NULL,
  `period`      VARCHAR(120) NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_prop_schedule_prop` (`proposal_id`,`sort_order`),
  CONSTRAINT `fk_prop_schedule_prop` FOREIGN KEY (`proposal_id`) REFERENCES `proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- proposal_views (rastreamento)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `proposal_views` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `proposal_id` INT UNSIGNED NOT NULL,
  `viewed_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip`          VARCHAR(45) NULL,
  `user_agent`  VARCHAR(255) NULL,
  `device`      VARCHAR(40) NULL,
  `referrer`    VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `ix_prop_views_prop_time` (`proposal_id`,`viewed_at`),
  CONSTRAINT `fk_prop_views_prop` FOREIGN KEY (`proposal_id`) REFERENCES `proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- proposal_acceptances (aceite digital)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `proposal_acceptances` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `proposal_id`    INT UNSIGNED NOT NULL,
  `name`           VARCHAR(160) NOT NULL,
  `email`          VARCHAR(190) NOT NULL,
  `doc`            VARCHAR(20)  NULL,
  `accepted_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip`             VARCHAR(45) NULL,
  `user_agent`     VARCHAR(255) NULL,
  `terms_version`  VARCHAR(20) NULL,
  PRIMARY KEY (`id`),
  KEY `ix_prop_accept_prop` (`proposal_id`),
  CONSTRAINT `fk_prop_accept_prop` FOREIGN KEY (`proposal_id`) REFERENCES `proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- proposal_requests (pedidos de alteração / recusa)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `proposal_requests` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `proposal_id` INT UNSIGNED NOT NULL,
  `kind`        ENUM('alteracao','recusa') NOT NULL DEFAULT 'alteracao',
  `name`        VARCHAR(160) NOT NULL,
  `email`       VARCHAR(190) NULL,
  `message`     TEXT NOT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `ix_prop_requests_prop` (`proposal_id`),
  CONSTRAINT `fk_prop_requests_prop` FOREIGN KEY (`proposal_id`) REFERENCES `proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- proposal_templates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `proposal_templates` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(160) NOT NULL,
  `payload`    JSON NOT NULL,
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_prop_templates_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- briefings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `briefings` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `number`            VARCHAR(40)  NOT NULL,
  `public_token`      CHAR(32)     NOT NULL,
  `client_id`         INT UNSIGNED NULL,
  `contact_name`      VARCHAR(160) NULL,
  `contact_email`     VARCHAR(190) NULL,
  `kind`              VARCHAR(60)  NULL,
  `status`            ENUM('rascunho','aguardando','respondido') NOT NULL DEFAULT 'aguardando',
  `sent_at`           DATETIME NULL,
  `first_viewed_at`   DATETIME NULL,
  `answered_at`       DATETIME NULL,
  `answers_count`     INT UNSIGNED NOT NULL DEFAULT 0,
  `total_questions`   INT UNSIGNED NOT NULL DEFAULT 12,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_briefings_number` (`number`),
  UNIQUE KEY `uq_briefings_token`  (`public_token`),
  KEY `ix_briefings_status` (`status`),
  CONSTRAINT `fk_briefings_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- briefing_questions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `briefing_questions` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `section`    ENUM('empresa','publico','objetivos','projeto') NOT NULL,
  `label`      VARCHAR(255) NOT NULL,
  `hint`       VARCHAR(255) NULL,
  `type`       ENUM('text','textarea','single','multi') NOT NULL,
  `options`    JSON NULL,
  `required`   TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_briefing_questions_section` (`section`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- briefing_answers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `briefing_answers` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `briefing_id` INT UNSIGNED NOT NULL,
  `question_id` INT UNSIGNED NOT NULL,
  `value`       MEDIUMTEXT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_briefing_answer` (`briefing_id`,`question_id`),
  KEY `ix_briefing_answers_brief` (`briefing_id`),
  CONSTRAINT `fk_brief_answers_brief` FOREIGN KEY (`briefing_id`) REFERENCES `briefings`          (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_brief_answers_q`     FOREIGN KEY (`question_id`) REFERENCES `briefing_questions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- company_settings (singleton — id=1)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `company_settings` (
  `id`                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`                     VARCHAR(180) NOT NULL,
  `logo_path`                VARCHAR(255) NULL,
  `email`                    VARCHAR(190) NULL,
  `phone`                    VARCHAR(30)  NULL,
  `whatsapp`                 VARCHAR(30)  NULL,
  `address`                  VARCHAR(255) NULL,
  `doc`                      VARCHAR(20)  NULL,
  `site`                     VARCHAR(190) NULL,
  `instagram`                VARCHAR(120) NULL,
  `bank_info`                TEXT NULL,
  `proposal_prefix`          VARCHAR(30)  NOT NULL DEFAULT 'BEMIND-',
  `default_validity_days`    INT UNSIGNED NOT NULL DEFAULT 15,
  `pix_key`                  VARCHAR(190) NULL,
  `pix_key_type`             ENUM('cpf','cnpj','email','celular','aleatoria') NULL,
  `pix_holder`               VARCHAR(160) NULL,
  `pix_bank`                 VARCHAR(120) NULL,
  `show_pix_in_proposals`    TINYINT(1) NOT NULL DEFAULT 1,
  `auto_save_enabled`        TINYINT(1) NOT NULL DEFAULT 1,
  `dark_mode`                TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NULL,
  `type`        ENUM('visualizacao','aprovacao','recusa','alteracao','envio','expiracao','info') NOT NULL DEFAULT 'info',
  `title`       VARCHAR(180) NOT NULL,
  `body`        TEXT NULL,
  `entity_type` VARCHAR(40) NULL,
  `entity_id`   INT UNSIGNED NULL,
  `read_at`     DATETIME NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_notifications_user_read` (`user_id`,`read_at`),
  CONSTRAINT `fk_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- activity_logs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NULL,
  `action`      VARCHAR(80) NOT NULL,
  `entity_type` VARCHAR(40) NOT NULL,
  `entity_id`   INT UNSIGNED NULL,
  `meta`        JSON NULL,
  `ip`          VARCHAR(45) NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_activity_entity` (`entity_type`,`entity_id`),
  KEY `ix_activity_user`   (`user_id`),
  CONSTRAINT `fk_activity_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- attachments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `attachments` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity_type`   VARCHAR(40) NOT NULL,
  `entity_id`     INT UNSIGNED NOT NULL,
  `path`          VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NULL,
  `mime`          VARCHAR(120) NULL,
  `size`          INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_attachments_entity` (`entity_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- payments (opcional)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payments` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `proposal_id` INT UNSIGNED NOT NULL,
  `due_date`    DATE NOT NULL,
  `amount`      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `status`      ENUM('pendente','pago','atrasado','cancelado') NOT NULL DEFAULT 'pendente',
  `paid_at`     DATETIME NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_payments_prop` (`proposal_id`),
  CONSTRAINT `fk_payments_prop` FOREIGN KEY (`proposal_id`) REFERENCES `proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- sessions (persistência simples, opcional; útil quando SESSION_DRIVER=db)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `id`            VARCHAR(128) NOT NULL,
  `user_id`       INT UNSIGNED NULL,
  `ip`            VARCHAR(45) NULL,
  `user_agent`    VARCHAR(255) NULL,
  `payload`       MEDIUMTEXT NOT NULL,
  `last_activity` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_sessions_user` (`user_id`),
  KEY `ix_sessions_last` (`last_activity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
