<?php
// ══════════════════════════════════════════════════════════════════════════
// VISÃOOS — Roteador Principal v2.2 (compatível PHP 7.4+)
// ══════════════════════════════════════════════════════════════════════════

$rawUri = parse_url(isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH);

// Remove prefixo de subdiretório (ex: /bemind/api/os → /api/os)
$scriptDir = rtrim(dirname(isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : ''), '/');
if ($scriptDir && $scriptDir !== '/') {
    $replaced = preg_replace('#^' . preg_quote($scriptDir, '#') . '#', '', $rawUri);
    $rawUri   = ($replaced !== null && $replaced !== '') ? $replaced : '/';
}

// Detecta se é chamada de API
$isApiCall = (bool)preg_match('#^/api(/|$)#', $rawUri)
          || (bool)preg_match('#^/rastreio/#', $rawUri)
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

// Rate limiting
$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
checkRateLimit($ip, 200, 60);

// Parse da URI
$uri    = preg_replace('#^/api#', '', $rawUri);
$method = $_SERVER['REQUEST_METHOD'];
$parts  = array_values(array_filter(explode('/', trim($uri, '/'))));

// Body JSON
$body = array();
$raw  = file_get_contents('php://input');
if ($raw) {
    $decoded = json_decode($raw, true);
    $body = is_array($decoded) ? $decoded : array();
}

// Input helper — compatível PHP 7.4
function inp($key, $default = null) {
    global $body;
    if (isset($body[$key]) && $body[$key] !== null) return $body[$key];
    if (isset($_GET[$key]))  return $_GET[$key];
    if (isset($_POST[$key])) return $_POST[$key];
    return $default;
}

// Roteamento
$resource = isset($parts[0]) ? $parts[0] : '';
$id       = isset($parts[1]) ? $parts[1] : null;
$sub      = isset($parts[2]) ? $parts[2] : null;

if (!$resource && isset($_GET['resource'])) {
    $resource = $_GET['resource'];
    $id       = isset($_GET['id'])  ? $_GET['id']  : null;
    $sub      = isset($_GET['sub']) ? $_GET['sub'] : null;
}
// Lê sub via GET quando hosting não tem mod_rewrite (fetch interceptor usa query string)
if ($sub === null && isset($_GET['sub']))  $sub = $_GET['sub'];
if (isset($_GET['sub2'])) $parts[3] = $_GET['sub2'];

try {
    if      ($resource === 'health')    { health(); }
    elseif  ($resource === 'debug')     { debugInfo(); }
    elseif  ($resource === 'auth')      { require __DIR__ . '/routes/auth.php'; }
    elseif  ($resource === 'os')        { require __DIR__ . '/routes/os.php'; }
    elseif  ($resource === 'clients')   { require __DIR__ . '/routes/clients.php'; }
    elseif  ($resource === 'materials') { require __DIR__ . '/routes/materials.php'; }
    elseif  ($resource === 'services')  { require __DIR__ . '/routes/services.php'; }
    elseif  ($resource === 'quotes')    { require __DIR__ . '/routes/quotes.php'; }
    elseif  ($resource === 'finance')   { require __DIR__ . '/routes/finance.php'; }
    elseif  ($resource === 'users')     { require __DIR__ . '/routes/users.php'; }
    elseif  ($resource === 'track')     { require __DIR__ . '/routes/tracking.php'; }
    elseif  ($resource === 'rastreio')  { require __DIR__ . '/routes/tracking.php'; }
    elseif  ($resource === 'webhook')   { require __DIR__ . '/routes/webhook.php'; }
    elseif  ($resource === 'suppliers') { require __DIR__ . '/routes/suppliers.php'; }
    elseif  ($resource === 'receipts')  { require __DIR__ . '/routes/receipts.php'; }
    else    { notFound(); }
} catch (Throwable $e) {
    http_response_code(500);
    $msg = $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine();
    error_log('VisaOS API Error: ' . $msg);
    $debug = (getenv('APP_DEBUG') === 'true');
    echo json_encode(array('error' => $debug ? $msg : 'Erro interno do servidor.', 'code' => 'INTERNAL_ERROR'));
}

function health() {
    try { getDB()->query('SELECT 1'); $db = 'ok'; } catch (Exception $e) { $db = 'error: ' . $e->getMessage(); }
    echo json_encode(array(
        'status'  => 'ok',
        'db'      => $db,
        'php'     => PHP_VERSION,
        'version' => APP_VERSION,
        'time'    => date('c'),
    ));
    exit;
}

function debugInfo() {
    $user = requireAuth();
    if ($user['role'] !== 'admin') {
        http_response_code(403);
        echo json_encode(array('error' => 'Acesso negado.'));
        exit;
    }
    $db     = getDB();
    $tables = array('clients','users','service_orders','os_items','materials','services','quotes','receipts','suppliers','payments','refresh_tokens');
    $info   = array();
    foreach ($tables as $t) {
        try {
            $cols  = $db->query("SHOW COLUMNS FROM `$t`")->fetchAll(PDO::FETCH_COLUMN);
            $count = $db->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
            $info[$t] = array('columns' => $cols, 'rows' => (int)$count);
        } catch (Throwable $e) {
            $info[$t] = array('error' => $e->getMessage());
        }
    }
    echo json_encode(array(
        'php'    => PHP_VERSION,
        'mysql'  => $db->query('SELECT VERSION()')->fetchColumn(),
        'tables' => $info,
        'env'    => array('DB_HOST' => DB_HOST, 'DB_NAME' => DB_NAME, 'DB_USER' => DB_USER),
    ), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function notFound() {
    http_response_code(404);
    echo json_encode(array('error' => 'Rota não encontrada.'));
    exit;
}

function json_out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
