<?php
declare(strict_types=1);

namespace App\Core;

final class Request
{
    public string $method;
    public string $path;
    public array  $query;
    public array  $post;
    public array  $files;
    public array  $server;

    public function __construct()
    {
        $this->method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $path = parse_url($uri, PHP_URL_PATH) ?: '/';
        $this->path = '/' . trim($path, '/');
        if ($this->path === '') $this->path = '/';
        $this->query  = $_GET  ?? [];
        $this->post   = $_POST ?? [];
        $this->files  = $_FILES ?? [];
        $this->server = $_SERVER ?? [];

        if (in_array($this->method, ['POST','PUT','PATCH','DELETE'], true)) {
            $ct = $this->server['CONTENT_TYPE'] ?? '';
            if (stripos($ct, 'application/json') !== false) {
                $raw = file_get_contents('php://input') ?: '';
                $j = json_decode($raw, true);
                if (is_array($j)) $this->post = array_merge($this->post, $j);
            }
        }
    }

    public function ip(): string
    {
        return (string)($this->server['REMOTE_ADDR'] ?? '');
    }

    public function userAgent(): string
    {
        return (string)($this->server['HTTP_USER_AGENT'] ?? '');
    }

    public function wantsJson(): bool
    {
        $a = $this->server['HTTP_ACCEPT'] ?? '';
        return stripos($a, 'application/json') !== false;
    }
}
