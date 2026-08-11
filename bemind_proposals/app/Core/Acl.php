<?php
declare(strict_types=1);

namespace App\Core;

final class Acl
{
    // admin: tudo | comercial: clientes/propostas | editor: conteúdo/serviços | viewer: leitura
    private const CAPS = [
        'admin'     => ['*'],
        'comercial' => ['clients.*','proposals.*','briefings.*','notifications.*','reports.view','dashboard.view','services.view','cloud.view','settings.view'],
        'editor'    => ['services.*','cloud.*','proposals.view','clients.view','briefings.view','dashboard.view','notifications.view','reports.view','settings.view'],
        'viewer'    => ['dashboard.view','proposals.view','clients.view','services.view','cloud.view','briefings.view','reports.view','notifications.view','settings.view'],
    ];

    public static function can(?string $role, string $ability): bool
    {
        if (!$role || !isset(self::CAPS[$role])) return false;
        foreach (self::CAPS[$role] as $rule) {
            if ($rule === '*') return true;
            if ($rule === $ability) return true;
            if (str_ends_with($rule, '.*') && str_starts_with($ability, substr($rule, 0, -1))) return true;
        }
        return false;
    }

    public static function require(string $ability): void
    {
        $u = Session::user();
        if (!$u) Response::redirect('/login');
        if (!self::can($u['role'] ?? null, $ability)) Response::abort(403, 'Sem permissão para esta ação.');
    }
}
