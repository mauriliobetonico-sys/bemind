<?php
declare(strict_types=1);

namespace App\Core;

final class Money
{
    /** Formata como R$ 1.500,00 (pt-BR). */
    public static function br(float|int|string $value): string
    {
        $v = is_string($value) ? (float)str_replace([','], ['.'], $value) : (float)$value;
        return 'R$ ' . number_format($v, 2, ',', '.');
    }

    /** Recebe "1.500,00" | "1500.00" | "1500" → float. */
    public static function parse(string $input): float
    {
        $s = trim($input);
        if ($s === '') return 0.0;
        // remove tudo que não é dígito, vírgula, ponto, sinal
        $s = preg_replace('/[^\d,\.\-]/', '', $s) ?? '';
        // formato br: se tem vírgula, ponto é milhar
        if (str_contains($s, ',')) $s = str_replace(['.', ','], ['', '.'], $s);
        return (float)$s;
    }
}
