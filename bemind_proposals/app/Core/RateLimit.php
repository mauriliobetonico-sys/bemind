<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Rate limit por IP+chave via arquivos em /storage.
 * Simples, sem dependência externa; suficiente para volumetria típica de portal.
 */
final class RateLimit
{
    public static function hit(string $key, int $max = 10, int $windowSeconds = 60): void
    {
        $ip  = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        $bucket = hash('sha256', $key . '|' . $ip);
        $dir = BMP_ROOT . '/storage/ratelimit';
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $file = $dir . '/' . $bucket . '.json';

        $now = time();
        $data = ['w' => $now, 'n' => 0];
        if (is_file($file)) {
            $j = json_decode((string)@file_get_contents($file), true) ?: [];
            if (isset($j['w'], $j['n']) && ($now - (int)$j['w']) < $windowSeconds) $data = $j;
        }
        $data['n'] = (int)$data['n'] + 1;
        @file_put_contents($file, json_encode($data));

        if ($data['n'] > $max) {
            header('Retry-After: ' . max(1, $windowSeconds - ($now - (int)$data['w'])));
            Response::abort(429, 'Muitas requisições. Aguarde e tente novamente.');
        }
    }
}
