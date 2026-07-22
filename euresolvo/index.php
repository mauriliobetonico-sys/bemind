<?php
// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — API Router v1
// Todas as rotas expostas em /api/v1/... (o .htaccess remove o /api)
// ══════════════════════════════════════════════════════════════════════════

require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/config/auth.php';
require_once __DIR__ . '/config/storage.php';
require_once __DIR__ . '/config/notifications.php';
require_once __DIR__ . '/config/ledger.php';
require_once __DIR__ . '/config/matching.php';
require_once __DIR__ . '/config/payments.php';

// Headers padrão
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . APP_URL);
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Signature, X-Request-Id');
header('Access-Control-Max-Age: 3600');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// Rate limit por IP (leve — rotas críticas podem impor mais)
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
checkRateLimit("global:$ip", 300, 60);

// Parse do caminho — remove prefixo de subpasta (compat com hospedagens)
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$scriptDir = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/');
if ($scriptDir && $scriptDir !== '/') {
    $uri = preg_replace('#^' . preg_quote($scriptDir, '#') . '#', '', $uri);
}
$uri    = preg_replace('#^/api(/v1)?#', '', $uri);
$method = $_SERVER['REQUEST_METHOD'];
$parts  = array_values(array_filter(explode('/', trim($uri, '/'))));

// Body JSON global (rotas leem via inp())
$body = [];
$raw  = file_get_contents('php://input');
if ($raw && str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
    $body = json_decode($raw, true) ?? [];
}

function inp(string $key, mixed $default = null): mixed {
    global $body;
    return $body[$key] ?? $_GET[$key] ?? $_POST[$key] ?? $default;
}

function json_out(mixed $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function bad(string $msg, int $code = 400, ?string $errorCode = null): void {
    json_out(['error' => $msg, 'code' => $errorCode ?: 'BAD_REQUEST'], $code);
}

// Roteamento
$resource = $parts[0] ?? '';
$id       = $parts[1] ?? null;
$sub      = $parts[2] ?? null;
$sub2     = $parts[3] ?? null;

try {
    match ($resource) {
        ''             => json_out(['name' => APP_NAME, 'version' => APP_VERSION, 'time' => date('c')]),
        'health'       => healthCheck(),
        'auth'         => require __DIR__ . '/routes/auth.php',
        'companies'    => require __DIR__ . '/routes/companies.php',
        'installers'   => require __DIR__ . '/routes/installers.php',
        'service-orders','orders' => require __DIR__ . '/routes/orders.php',
        'offers'       => require __DIR__ . '/routes/offers.php',
        'chat'         => require __DIR__ . '/routes/chat.php',
        'tracking'     => require __DIR__ . '/routes/tracking.php',
        'ratings'      => require __DIR__ . '/routes/ratings.php',
        'payments'     => require __DIR__ . '/routes/payments.php',
        'wallets'      => require __DIR__ . '/routes/wallets.php',
        'admin'        => require __DIR__ . '/routes/admin.php',
        'leads'        => require __DIR__ . '/routes/leads.php',
        'webhook'      => require __DIR__ . '/routes/webhook.php',
        'notifications'=> require __DIR__ . '/routes/notifications.php',
        'me'           => require __DIR__ . '/routes/me.php',
        default        => json_out(['error' => 'Rota não encontrada.', 'code' => 'NOT_FOUND'], 404),
    };
} catch (Throwable $e) {
    error_log('EU RESOLVO API: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (APP_ENV === 'production') {
        json_out(['error' => 'Erro interno do servidor.', 'code' => 'INTERNAL'], 500);
    } else {
        json_out(['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()], 500);
    }
}

function healthCheck(): void {
    $db = 'error';
    try { getDB()->query('SELECT 1'); $db = 'ok'; } catch (Throwable) {}
    $ws = 'offline';
    $sock = @fsockopen('127.0.0.1', (int)parse_url(WS_HTTP, PHP_URL_PORT) ?: 6001, $eno, $err, 0.5);
    if ($sock) { $ws = 'ok'; fclose($sock); }
    json_out([
        'status'  => 'ok',
        'db'      => $db,
        'ws'      => $ws,
        'version' => APP_VERSION,
        'time'    => date('c'),
    ]);
}
