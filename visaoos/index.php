<?php
// ══════════════════════════════════════════════════════════════════════════
// VISÃOOS — Roteador Principal v2.1
// ══════════════════════════════════════════════════════════════════════════

$rawUri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

// Remove prefixo de subdiretório (ex: /bemind/api/os → /api/os)
$scriptDir = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/');
if ($scriptDir && $scriptDir !== '/') {
    $rawUri = preg_replace('#^' . preg_quote($scriptDir, '#') . '#', '', $rawUri) ?: '/';
}

// Detecta se é chamada de API
$isApiCall = preg_match('#^/api(/|$)#', $rawUri)
          || preg_match('#^/rastreio/#', $rawUri)
          || (isset($_GET['resource']) && $_GET['resource'] !== '');

// Qualquer rota que NÃO seja API serve o frontend (SPA)
if (!$isApiCall) {
    $html = __DIR__ . '/index.html';
    if (file_exists($html)) {
        header('Content-Type: text/html; charset=utf-8');
        readfile($html);
    } else {
        http_response_code(404);
        echo 'index.html não encontrado. Verifique o deploy.';
    }
    exit;
}

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

// Parse da URI — reusa $rawUri já normalizado (sem prefixo de subpasta)
$uri    = preg_replace('#^/api#', '', $rawUri);
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
        $resource === 'debug'                               => debugInfo(),
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
        $resource === 'suppliers'                          => require __DIR__ . '/routes/suppliers.php',
        $resource === 'receipts'                           => require __DIR__ . '/routes/receipts.php',
        default                                            => notFound()
    };
} catch (Throwable $e) {
    http_response_code(500);
    $msg = $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine();
    error_log('VisãoOS API Error: ' . $msg);
    // Em debug local, expõe a mensagem; em produção, exibe genérico
    $debug = (getenv('APP_DEBUG') === 'true');
    echo json_encode(['error' => $debug ? $msg : 'Erro interno do servidor.', 'code' => 'INTERNAL_ERROR']);
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
function debugInfo(): void {
    // Só admin autenticado pode acessar
    $user = requireAuth();
    if ($user['role'] !== 'admin') { http_response_code(403); echo json_encode(['error'=>'Acesso negado.']); return; }

    $db     = getDB();
    $tables = ['clients','users','service_orders','os_items','materials','services','quotes','receipts','suppliers','payments','refresh_tokens'];
    $info   = [];
    foreach ($tables as $t) {
        try {
            $cols = $db->query("SHOW COLUMNS FROM `$t`")->fetchAll(PDO::FETCH_COLUMN);
            $count = $db->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
            $info[$t] = ['columns' => $cols, 'rows' => (int)$count];
        } catch (Throwable $e) {
            $info[$t] = ['error' => $e->getMessage()];
        }
    }
    echo json_encode([
        'php'     => PHP_VERSION,
        'mysql'   => $db->query('SELECT VERSION()')->fetchColumn(),
        'tables'  => $info,
        'env'     => [
            'DB_HOST' => DB_HOST,
            'DB_NAME' => DB_NAME,
            'DB_USER' => DB_USER,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
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
