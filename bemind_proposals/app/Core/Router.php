<?php
declare(strict_types=1);

namespace App\Core;

final class Router
{
    /** @var array<string, array<int, array{pattern:string,handler:mixed,middleware:array}>> */
    private array $routes = [
        'GET' => [], 'POST' => [], 'PUT' => [], 'PATCH' => [], 'DELETE' => [],
    ];

    public function get(string $path, mixed $handler, array $middleware = []): void   { $this->add('GET',    $path, $handler, $middleware); }
    public function post(string $path, mixed $handler, array $middleware = []): void  { $this->add('POST',   $path, $handler, $middleware); }
    public function put(string $path, mixed $handler, array $middleware = []): void   { $this->add('PUT',    $path, $handler, $middleware); }
    public function patch(string $path, mixed $handler, array $middleware = []): void { $this->add('PATCH',  $path, $handler, $middleware); }
    public function delete(string $path, mixed $handler, array $middleware = []): void{ $this->add('DELETE', $path, $handler, $middleware); }

    private function add(string $method, string $path, mixed $handler, array $middleware): void
    {
        $pattern = $this->compile($path);
        $this->routes[$method][] = ['pattern' => $pattern, 'handler' => $handler, 'middleware' => $middleware];
    }

    private function compile(string $path): string
    {
        $path = '/' . trim($path, '/');
        // {name} → named capture
        $regex = preg_replace('#\{([a-zA-Z_][a-zA-Z0-9_]*)\}#', '(?P<$1>[^/]+)', $path);
        return '#^' . $regex . '$#u';
    }

    public function dispatch(Request $req): void
    {
        $method = $req->method === 'HEAD' ? 'GET' : $req->method;
        // Método override para forms HTML (_method=PUT|PATCH|DELETE)
        if ($method === 'POST' && !empty($req->post['_method'])) {
            $override = strtoupper($req->post['_method']);
            if (in_array($override, ['PUT','PATCH','DELETE'], true)) $method = $override;
        }

        $candidates = $this->routes[$method] ?? [];
        foreach ($candidates as $r) {
            if (preg_match($r['pattern'], $req->path, $m)) {
                $params = [];
                foreach ($m as $k => $v) if (!is_int($k)) $params[$k] = $v;

                foreach ($r['middleware'] as $mw) {
                    if (is_callable($mw)) { $mw($req, $params); }
                    elseif (is_string($mw) && class_exists($mw)) {
                        $inst = new $mw();
                        if (method_exists($inst, 'handle')) $inst->handle($req, $params);
                    }
                }

                $this->call($r['handler'], $req, $params);
                return;
            }
        }

        Response::abort(404, 'Rota não encontrada: ' . $req->path);
    }

    private function call(mixed $handler, Request $req, array $params): void
    {
        if (is_callable($handler)) { $handler($req, $params); return; }
        if (is_array($handler) && count($handler) === 2) {
            [$class, $method] = $handler;
            if (is_string($class)) $class = new $class();
            $class->$method($req, $params);
            return;
        }
        Response::abort(500, 'Handler inválido.');
    }
}
