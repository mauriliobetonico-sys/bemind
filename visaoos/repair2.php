<?php
// ══════════════════════════════════════════════════════════════════════════
// VISÃOOS — Reparo 2: corrige precedência de roteamento (apagar após uso)
// ══════════════════════════════════════════════════════════════════════════
error_reporting(E_ALL);
ini_set('display_errors', '1');
header('Content-Type: text/plain; charset=utf-8');

$dir = __DIR__;
echo "=== REPARO 2 — ROTEAMENTO ===\n\n";

$indexPhp = <<<'PHPEOT'
<?php
// ══════════════════════════════════════════════════════════════════════════
// VISÃOOS — Roteador Principal v2.4 (compatível PHP 7.4+)
// ══════════════════════════════════════════════════════════════════════════

$rawUri = parse_url(isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH);

$scriptDir = rtrim(dirname(isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : ''), '/');
if ($scriptDir && $scriptDir !== '/') {
    $replaced = preg_replace('#^' . preg_quote($scriptDir, '#') . '#', '', $rawUri);
    $rawUri   = ($replaced !== null && $replaced !== '') ? $replaced : '/';
}

$isApiCall = (bool)preg_match('#^/api(/|$)#', $rawUri)
          || (bool)preg_match('#^/rastreio/#', $rawUri)
          || (isset($_GET['resource']) && $_GET['resource'] !== '');

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

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . APP_URL);
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200); exit;
}

$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
checkRateLimit($ip, 200, 60);

$uri    = preg_replace('#^/api#', '', $rawUri);
$method = $_SERVER['REQUEST_METHOD'];
$parts  = array_values(array_filter(explode('/', trim($uri, '/'))));

$body = array();
$raw  = file_get_contents('php://input');
if ($raw) {
    $decoded = json_decode($raw, true);
    $body = is_array($decoded) ? $decoded : array();
}

function inp($key, $default = null) {
    global $body;
    if (isset($body[$key]) && $body[$key] !== null) return $body[$key];
    if (isset($_GET[$key]))  return $_GET[$key];
    if (isset($_POST[$key])) return $_POST[$key];
    return $default;
}

// Roteamento — query string tem precedência (fetch interceptor / sem mod_rewrite)
if (isset($_GET['resource']) && $_GET['resource'] !== '') {
    $resource = $_GET['resource'];
    $id       = isset($_GET['id'])   ? $_GET['id']   : null;
    $sub      = isset($_GET['sub'])  ? $_GET['sub']  : null;
    if (isset($_GET['sub2'])) { $parts[3] = $_GET['sub2']; }
} else {
    $resource = isset($parts[0]) ? $parts[0] : '';
    $id       = isset($parts[1]) ? $parts[1] : null;
    $sub      = isset($parts[2]) ? $parts[2] : null;
}

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
PHPEOT;

$bytes = file_put_contents("$dir/index.php", $indexPhp);
echo "index.php reescrito: " . ($bytes !== false ? "$bytes bytes OK" : "FALHOU (sem permissao de escrita?)") . "\n\n";

// Garante interceptor no index.html
$ih = "$dir/index.html";
if (file_exists($ih)) {
    $html = file_get_contents($ih);
    if (strpos($html, 'window.fetch = function') === false && strpos($html, 'FETCH INTERCEPTOR') === false) {
        $interceptor = "<script>\n(function(){var _f=window.fetch.bind(window);window.fetch=function(input,init){if(typeof input==='string'&&input.indexOf('/api/')===0){var qi=input.indexOf('?');var path=qi>=0?input.slice(0,qi):input;var qs=qi>=0?input.slice(qi+1):'';var parts=path.replace(/^\\/api\\/?/,'').split('/').filter(Boolean);var p=new URLSearchParams(qs);if(parts[0])p.set('resource',parts[0]);if(parts[1])p.set('id',parts[1]);if(parts[2])p.set('sub',parts[2]);if(parts[3])p.set('sub2',parts[3]);input='index.php?'+p.toString();}return _f(input,init);};})();\n</script>";
        $html2 = preg_replace('/<head([^>]*)>/i', '<head$1>' . "\n" . $interceptor, $html, 1);
        if ($html2 && $html2 !== $html) { file_put_contents($ih, $html2); echo "index.html: interceptor injetado\n"; }
        else echo "index.html: nao foi possivel injetar interceptor\n";
    } else {
        echo "index.html: interceptor ja presente, OK\n";
    }
}

echo "\n>>> Agora teste: /index.php?resource=health\n";
echo ">>> Deve retornar status ok. Depois faca login normalmente.\n";
echo ">>> Apague diag.php, repair.php e repair2.php do servidor depois.\n";
