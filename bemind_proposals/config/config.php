<?php
declare(strict_types=1);

use App\Core\Env;
use App\Core\Config;

// Boot mínimo. BMP_ROOT é definido em public/index.php e install/index.php.
require_once BMP_ROOT . '/app/Core/Autoloader.php';
\App\Core\Autoloader::register();

Env::load(BMP_ROOT . '/.env');

Config::set('app.env',      Env::get('APP_ENV', 'production'));
Config::set('app.url',      rtrim((string)Env::get('APP_URL', ''), '/'));
Config::set('app.key',      (string)Env::get('APP_KEY', ''));
Config::set('app.timezone', Env::get('APP_TIMEZONE', 'America/Sao_Paulo'));

date_default_timezone_set((string)Config::get('app.timezone'));
mb_internal_encoding('UTF-8');

$env = Config::get('app.env');
if ($env === 'production') {
    ini_set('display_errors', '0');
    error_reporting(E_ALL & ~E_DEPRECATED & ~E_STRICT);
} else {
    ini_set('display_errors', '1');
    error_reporting(E_ALL);
}
ini_set('log_errors', '1');
ini_set('error_log', BMP_ROOT . '/storage/logs/php-error.log');

// Cabeçalhos de segurança (podem ser reforçados no servidor).
if (!headers_sent()) {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: interest-cohort=()');
    if (($_SERVER['HTTPS'] ?? 'off') === 'on') {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
}
