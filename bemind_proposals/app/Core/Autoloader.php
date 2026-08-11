<?php
declare(strict_types=1);

namespace App\Core;

final class Autoloader
{
    public static function register(): void
    {
        spl_autoload_register(static function (string $class): void {
            $prefix = 'App\\';
            if (!str_starts_with($class, $prefix)) return;
            $rel  = substr($class, strlen($prefix));
            $file = BMP_ROOT . '/app/' . str_replace('\\', '/', $rel) . '.php';
            if (is_file($file)) require $file;
        });
    }
}
