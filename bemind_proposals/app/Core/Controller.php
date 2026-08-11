<?php
declare(strict_types=1);

namespace App\Core;

abstract class Controller
{
    protected function view(string $view, array $data = [], ?string $layout = null): void
    {
        View::display($view, $data, $layout);
    }

    protected function json(array $data, int $status = 200): never
    {
        Response::json($data, $status);
    }

    protected function redirect(string $to, int $status = 302): never
    {
        Response::redirect($to, $status);
    }

    protected function assertCsrf(Request $req): void
    {
        $t = (string)($req->post['_csrf'] ?? $req->server['HTTP_X_CSRF_TOKEN'] ?? '');
        if (!Csrf::check($t)) Response::abort(419, 'Sessão expirada. Recarregue a página.');
    }

    protected function requireLogin(): array
    {
        $u = Session::user();
        if (!$u) Response::redirect('/login');
        return $u;
    }

    protected function requireRole(array $roles): array
    {
        $u = $this->requireLogin();
        if (!in_array($u['role'], $roles, true)) Response::abort(403, 'Sem permissão.');
        return $u;
    }
}
