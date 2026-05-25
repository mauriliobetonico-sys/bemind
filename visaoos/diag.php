<?php
// Diagnóstico VisãoOS — delete após uso
error_reporting(E_ALL);
ini_set('display_errors', '1');
header('Content-Type: text/plain; charset=utf-8');

echo "=== DIAGNÓSTICO VISAOOS ===\n\n";
echo "PHP Version: " . PHP_VERSION . "\n";
echo "SAPI: " . php_sapi_name() . "\n";
echo "OS: " . PHP_OS . "\n";
echo "__DIR__: " . __DIR__ . "\n\n";

// Verifica se os arquivos existem
$files = [
    'config/database.php',
    'config/auth.php',
    'config/notifications.php',
    'config/storage.php',
    'index.php',
];
echo "=== ARQUIVOS ===\n";
foreach ($files as $f) {
    $path = __DIR__ . '/' . $f;
    echo $f . ': ' . (file_exists($path) ? 'OK (' . filesize($path) . ' bytes)' : 'FALTANDO') . "\n";
}

// Verifica .env
echo "\n=== .ENV ===\n";
$envPaths = [
    __DIR__ . '/.env',
    __DIR__ . '/../.env',
    __DIR__ . '/../../.env',
];
$found = false;
foreach ($envPaths as $p) {
    if (file_exists($p)) {
        echo ".env encontrado em: $p\n";
        $found = true;
        // Mostra chaves (sem valores)
        foreach (file($p) as $line) {
            $line = trim($line);
            if ($line && $line[0] !== '#' && strpos($line, '=') !== false) {
                $k = explode('=', $line, 2)[0];
                echo "  $k = (definido)\n";
            }
        }
        break;
    }
}
if (!$found) echo ".env NAO encontrado (usando defaults)\n";

// Testa carregamento de cada config
echo "\n=== CARREGAMENTO DE CONFIG ===\n";
$configs = ['config/database.php','config/auth.php','config/notifications.php','config/storage.php'];
foreach ($configs as $c) {
    $path = __DIR__ . '/' . $c;
    if (!file_exists($path)) { echo "$c: ARQUIVO NAO EXISTE\n"; continue; }
    try {
        ob_start();
        $result = include_once $path;
        ob_end_clean();
        echo "$c: OK\n";
    } catch (Throwable $e) {
        ob_end_clean();
        echo "$c: ERRO — " . $e->getMessage() . " em linha " . $e->getLine() . "\n";
    }
}

// Testa conexão com banco
echo "\n=== BANCO DE DADOS ===\n";
try {
    $pdo = getDB();
    $pdo->query('SELECT 1');
    echo "Conexão: OK\n";
    echo "DB_HOST: " . DB_HOST . "\n";
    echo "DB_NAME: " . DB_NAME . "\n";
    echo "DB_USER: " . DB_USER . "\n";
} catch (Throwable $e) {
    echo "ERRO de conexão: " . $e->getMessage() . "\n";
    echo "DB_HOST: " . (defined('DB_HOST') ? DB_HOST : 'NÃO DEFINIDO') . "\n";
    echo "DB_NAME: " . (defined('DB_NAME') ? DB_NAME : 'NÃO DEFINIDO') . "\n";
    echo "DB_USER: " . (defined('DB_USER') ? DB_USER : 'NÃO DEFINIDO') . "\n";
}

echo "\n=== FIM DO DIAGNÓSTICO ===\n";
