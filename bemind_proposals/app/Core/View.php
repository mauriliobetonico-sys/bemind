<?php
declare(strict_types=1);

namespace App\Core;

final class View
{
    public static function render(string $view, array $data = [], ?string $layout = null): string
    {
        $file = self::path($view);
        if (!is_file($file)) throw new \RuntimeException("View não encontrada: {$view}");

        extract($data, EXTR_SKIP);
        ob_start();
        include $file;
        $content = ob_get_clean() ?: '';

        if ($layout) {
            $lfile = self::path($layout);
            if (!is_file($lfile)) throw new \RuntimeException("Layout não encontrado: {$layout}");
            ob_start();
            include $lfile;
            $content = ob_get_clean() ?: '';
        }
        return $content;
    }

    public static function display(string $view, array $data = [], ?string $layout = null): void
    {
        echo self::render($view, $data, $layout);
    }

    private static function path(string $view): string
    {
        $rel = str_replace('.', DIRECTORY_SEPARATOR, $view) . '.php';
        return BMP_ROOT . '/app/Views/' . $rel;
    }

    public static function e(mixed $v): string
    {
        return htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
