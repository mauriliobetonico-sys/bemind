<?php
// ══════════════════════════════════════════════════════════════════════════
// VISÃOOS API — Roteador Principal v2.0
// ══════════════════════════════════════════════════════════════════════════

require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/config/auth.php';
require_once __DIR__ . '/config/notifications.php';
require_once __DIR__ . '/config/storage.php';

// Headers CORS e JSON
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . APP_URL);
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200); exit;
}

// Rate limiting via banco de dados (resiliente)
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
checkRateLimit($ip, 200, 60);

// Parse da URI — detecta subfolder automaticamente e remove prefixos
$uri       = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$scriptDir = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
if ($scriptDir && $scriptDir !== '/') {
    $uri = preg_replace('#^' . preg_quote($scriptDir, '#') . '#', '', $uri);
}
$uri    = preg_replace('#^/api#', '', $uri);
$method = $_SERVER['REQUEST_METHOD'];
$parts  = array_values(array_filter(explode('/', trim($uri, '/'))));

// Body JSON
$body = [];
$raw  = file_get_contents('php://input');
if ($raw) $body = json_decode($raw, true) ?? [];

// Input helper
function inp(string $key, mixed $default = null): mixed {
    global $body;
    return $body[$key] ?? $_GET[$key] ?? $_POST[$key] ?? $default;
}

// Roteamento
$resource = $parts[0] ?? '';
$id       = $parts[1] ?? null;
$sub      = $parts[2] ?? null;

// Suporte à rota de rastreio via query string (vinda do .htaccess)
if (!$resource && isset($_GET['resource'])) {
    $resource = $_GET['resource'];
    $id       = $_GET['id'] ?? null;
}

try {
    match(true) {
        $resource === 'health'                              => health(),
        $resource === 'auth'                               => require __DIR__ . '/routes/auth.php',
        $resource === 'os'                                 => require __DIR__ . '/routes/os.php',
        $resource === 'clients'                            => require __DIR__ . '/routes/clients.php',
        $resource === 'materials'                          => require __DIR__ . '/routes/materials.php',
        $resource === 'services'                           => require __DIR__ . '/routes/services.php',
        $resource === 'quotes'                             => require __DIR__ . '/routes/quotes.php',
        $resource === 'finance'                            => require __DIR__ . '/routes/finance.php',
        $resource === 'users'                              => require __DIR__ . '/routes/users.php',
        $resource === 'track'                              => require __DIR__ . '/routes/tracking.php',
        $resource === 'rastreio'                           => require __DIR__ . '/routes/tracking.php',
        $resource === 'webhook'                            => require __DIR__ . '/routes/webhook.php',
        default                                            => notFound()
    };
} catch (Throwable $e) {
    http_response_code(500);
    error_log('VisãoOS API Error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    echo json_encode(['error' => 'Erro interno do servidor.']);
}

function health(): void {
    try { getDB()->query('SELECT 1'); $db = 'ok'; } catch(Exception $e) { $db = 'error'; }
    $ws = @fsockopen('localhost', (int)(getenv('WS_PORT') ?: 6001), $errno, $errstr, 1);
    $wsStatus = $ws ? 'ok' : 'offline';
    if ($ws) fclose($ws);
    echo json_encode([
        'status'  => 'ok',
        'db'      => $db,
        'ws'      => $wsStatus,
        'version' => APP_VERSION,
        'time'    => date('c'),
    ]);
}
function notFound(): void {
    http_response_code(404);
    echo json_encode(['error' => 'Rota não encontrada.']);
}
function json_out(mixed $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
