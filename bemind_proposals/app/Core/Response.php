<?php
declare(strict_types=1);

namespace App\Core;

final class Response
{
    public static function redirect(string $to, int $status = 302): never
    {
        header("Location: {$to}", true, $status);
        exit;
    }

    public static function json(array $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function abort(int $status, string $message = ''): never
    {
        http_response_code($status);
        header('Content-Type: text/html; charset=utf-8');
        $title = match ($status) {
            404 => 'Página não encontrada',
            403 => 'Acesso negado',
            419 => 'Sessão expirada',
            429 => 'Muitas requisições',
            default => 'Erro',
        };
        $msg = htmlspecialchars($message ?: $title, ENT_QUOTES, 'UTF-8');
        echo "<!doctype html><meta charset='utf-8'><title>{$status} — {$title}</title>"
           . "<body style='font-family:system-ui,sans-serif;padding:40px;color:#2B2E35;background:#F6F4F1'>"
           . "<h1 style='margin:0 0 8px'>{$status} — {$title}</h1>"
           . "<p>{$msg}</p></body>";
        exit;
    }
}
