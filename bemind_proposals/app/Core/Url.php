<?php
declare(strict_types=1);

namespace App\Core;

final class Url
{
    public static function base(): string
    {
        $u = (string)Config::get('app.url', '');
        if ($u !== '') return rtrim($u, '/');
        $proto = (($_SERVER['HTTPS'] ?? 'off') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') ? 'https' : 'http';
        $host  = $_SERVER['HTTP_HOST'] ?? 'localhost';
        return $proto . '://' . $host;
    }

    public static function to(string $path): string
    {
        if (str_starts_with($path, 'http')) return $path;
        return self::base() . '/' . ltrim($path, '/');
    }

    public static function proposal(string $token): string { return self::to('/p/' . $token); }
    public static function briefing(string $token): string { return self::to('/b/' . $token); }
}
