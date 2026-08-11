<?php
declare(strict_types=1);

/**
 * BE MIND PROPOSALS — runner de migrations (CLI).
 * Uso:  php scripts/migrate.php
 *
 * Lê arquivos SQL em /database/migrations por ordem alfabética
 * (recomendo prefixo com timestamp: 20260812-1200-add-column.sql).
 * Registra em `migrations` para não reaplicar.
 */

if (PHP_SAPI !== 'cli') { fwrite(STDERR, "Rode via CLI.\n"); exit(2); }

define('BMP_ROOT', dirname(__DIR__));
require BMP_ROOT . '/app/Core/Autoloader.php';
\App\Core\Autoloader::register();
\App\Core\Env::load(BMP_ROOT . '/.env');

$pdo = \App\Core\Db::conn();
$pdo->exec('CREATE TABLE IF NOT EXISTS migrations (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(190) NOT NULL UNIQUE,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

$done = [];
foreach ($pdo->query('SELECT filename FROM migrations') as $r) $done[$r['filename']] = true;

$files = glob(BMP_ROOT . '/database/migrations/*.sql') ?: [];
sort($files, SORT_NATURAL);
$applied = 0;
foreach ($files as $file) {
    $base = basename($file);
    if (isset($done[$base])) { echo "[=] $base (já aplicado)\n"; continue; }
    echo "[+] aplicando $base... ";
    try {
        $sql = file_get_contents($file) ?: '';
        $pdo->beginTransaction();
        $pdo->exec($sql);
        $pdo->prepare('INSERT INTO migrations (filename) VALUES (:f)')->execute([':f'=>$base]);
        $pdo->commit();
        echo "ok\n";
        $applied++;
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        echo "FALHOU\n" . $e->getMessage() . "\n";
        exit(1);
    }
}
echo "\n$applied migration(s) aplicada(s).\n";
