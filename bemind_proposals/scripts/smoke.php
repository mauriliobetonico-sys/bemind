<?php
declare(strict_types=1);

/**
 * BE MIND PROPOSALS — smoke test das rotas.
 * Sobe o servidor embutido do PHP, cria um lock temporário e faz curl em cada
 * rota principal. Detecta 5xx e imprime um relatório.
 *
 * Uso:  php scripts/smoke.php
 */

if (PHP_SAPI !== 'cli') { fwrite(STDERR, "Rode via CLI.\n"); exit(2); }

$root = dirname(__DIR__);
$port = 8930;
$base = "http://127.0.0.1:$port";

$fakeLock = false;
if (!file_exists("$root/storage/installed.lock")) {
    @file_put_contents("$root/storage/installed.lock", "smoke\n");
    $fakeLock = true;
}

$log = tempnam(sys_get_temp_dir(), 'bmp-smoke-');
$cmd = sprintf('php -S 127.0.0.1:%d -t %s %s > %s 2>&1 & echo $!',
    $port, escapeshellarg("$root/public"), escapeshellarg("$root/public/index.php"), escapeshellarg($log));
$pid = (int)trim((string)shell_exec($cmd));
if ($pid <= 0) { echo "não consegui subir o servidor\n"; exit(1); }

register_shutdown_function(static function () use ($pid, $fakeLock, $root) {
    if ($pid > 0) @posix_kill($pid, 15);
    if ($fakeLock) @unlink("$root/storage/installed.lock");
});

// espera o socket abrir
for ($i = 0; $i < 30; $i++) {
    $c = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.3);
    if ($c) { fclose($c); break; }
    usleep(150000);
}

$routes = [
    ['GET', '/login',                        [200]],
    ['GET', '/favicon.svg',                  [200]],
    ['GET', '/assets/css/app.css',           [200]],
    ['GET', '/assets/js/app.js',             [200]],
    ['GET', '/health',                       [200, 503]],
    ['GET', '/dashboard',                    [302]], // redireciona sem sessão
    ['GET', '/proposals',                    [302]],
    ['GET', '/proposals/express',            [302]],
    ['GET', '/proposals/new',                [302]],
    ['GET', '/clients',                      [302]],
    ['GET', '/services',                     [302]],
    ['GET', '/cloud',                        [302]],
    ['GET', '/reports',                      [302]],
    ['GET', '/notifications',                [302]],
    ['GET', '/settings',                     [302]],
    ['GET', '/more',                         [302]],
    ['GET', '/users',                        [302]],
    ['GET', '/templates',                    [302]],
    ['GET', '/briefings',                    [302]],
    // rotas públicas exigem DB — sem instalação real aceita 404 (found path)
    // OU 500 (DB indisponível). O importante é não haver falha de sintaxe/router.
    ['GET', '/p/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', [404, 500]],
    ['GET', '/b/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', [404, 500]],
    ['GET', '/rota-inexistente',             [404]],
];

$fail = 0;
$results = [];
foreach ($routes as [$method, $path, $expect]) {
    $ch = curl_init($base . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_NOBODY => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT => 3,
    ]);
    curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $ok = in_array($code, $expect, true);
    if (!$ok) $fail++;
    $results[] = [$ok, $code, $method, $path, $expect];
}

$width = max(array_map(fn($r) => strlen($r[3]), $results));
foreach ($results as [$ok, $code, $method, $path, $expect]) {
    printf("  %s  %s %-{$width}s   HTTP %d   (esperado: %s)\n",
        $ok ? '✓' : '✗', $method, $path, $code, implode('|', $expect));
}

echo "\n";
if ($fail === 0) {
    echo "Smoke OK · " . count($results) . " rotas.\n";
    exit(0);
}
echo "$fail falha(s) de " . count($results) . " rotas.\n";
echo "--- log do servidor ---\n" . (@file_get_contents($log) ?: '(vazio)') . "\n";
exit(1);
