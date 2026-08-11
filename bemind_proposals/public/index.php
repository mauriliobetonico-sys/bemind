<?php
declare(strict_types=1);

/**
 * BE MIND PROPOSALS — front controller.
 * O docroot do domínio aponta para /public.
 */

// Suporte ao servidor embutido (`php -S ... public/index.php`):
// se a URI aponta para um arquivo real ou diretório com index.php próprio,
// delega para eles (imitando o comportamento normal do Apache/Nginx).
if (PHP_SAPI === 'cli-server') {
    $reqPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if ($reqPath !== '/') {
        $localFile = __DIR__ . $reqPath;
        if (is_file($localFile)) return false;
        if (is_dir($localFile) && is_file($localFile . '/index.php')) {
            require $localFile . '/index.php';
            return true;
        }
    }
}

define('BMP_ROOT', dirname(__DIR__));
require BMP_ROOT . '/config/config.php';

use App\Core\Request;
use App\Core\Router;
use App\Core\Session;
use App\Core\Response;

// Se o instalador ainda não rodou, encaminha para /install.
if (!is_file(BMP_ROOT . '/storage/installed.lock')) {
    if (!str_starts_with($_SERVER['REQUEST_URI'] ?? '/', '/install')) {
        Response::redirect('/install/');
    }
}

Session::start();

$router = new Router();
require BMP_ROOT . '/config/routes.php';

try {
    $router->dispatch(new Request());
} catch (\Throwable $e) {
    error_log('[BMP] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (\App\Core\Config::get('app.env') !== 'production') {
        Response::abort(500, $e->getMessage());
    }
    Response::abort(500, 'Erro interno. Tente novamente em instantes.');
}
