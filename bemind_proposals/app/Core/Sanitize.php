<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Sanitização de HTML vindo do editor rico.
 * Se HTMLPurifier estiver disponível via Composer, usa-o; caso contrário
 * aplica um allowlist conservador com strip_tags + limpeza de atributos.
 */
final class Sanitize
{
    private const ALLOWED_TAGS = '<p><br><strong><em><b><i><u><a><ul><ol><li><h3><h4><blockquote><code>';

    public static function html(?string $input): string
    {
        $input = (string)$input;
        if ($input === '') return '';

        if (class_exists('\\HTMLPurifier')) {
            $config = \HTMLPurifier_Config::createDefault();
            $config->set('HTML.Allowed', 'p,br,strong,em,b,i,u,a[href|rel|target],ul,ol,li,h3,h4,blockquote,code');
            $config->set('URI.AllowedSchemes', ['http'=>true,'https'=>true,'mailto'=>true]);
            $config->set('AutoFormat.RemoveEmpty', true);
            $config->set('HTML.TargetBlank', true);
            $p = new \HTMLPurifier($config);
            return $p->purify($input);
        }

        $clean = strip_tags($input, self::ALLOWED_TAGS);
        // remove event handlers e javascript: nos <a>
        $clean = preg_replace('/\s(on\w+|style)="[^"]*"/i', '', $clean) ?? $clean;
        $clean = preg_replace('/href\s*=\s*"javascript:[^"]*"/i', 'href="#"', $clean) ?? $clean;
        return $clean;
    }

    public static function slug(string $s): string
    {
        $s = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s) ?: $s;
        $s = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $s) ?? '');
        return trim($s, '-');
    }

    public static function digits(?string $s): string
    {
        return preg_replace('/\D+/', '', (string)$s) ?? '';
    }

    public static function email(?string $s): ?string
    {
        $s = trim((string)$s);
        return $s === '' ? null : (filter_var($s, FILTER_VALIDATE_EMAIL) ?: null);
    }
}
