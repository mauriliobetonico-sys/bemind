<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Db;
use App\Models\CompanySettings;

/**
 * Gera números sequenciais por ano com FOR UPDATE.
 *  PROPOSTAS: BEMIND-2026-0001
 *  BRIEFINGS: BRIEF-2026-0014
 */
final class Numbering
{
    public static function proposal(): string
    {
        $prefix = rtrim((string)(CompanySettings::get()['proposal_prefix'] ?? 'BEMIND-'), '-') . '-';
        return self::nextFromTable('proposals', $prefix);
    }

    public static function briefing(): string
    {
        return self::nextFromTable('briefings', 'BRIEF-');
    }

    private static function nextFromTable(string $table, string $prefix): string
    {
        $year = (int)date('Y');
        $like = $prefix . $year . '-%';
        $pdo  = Db::conn();
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare("SELECT MAX(number) AS m FROM {$table} WHERE number LIKE :l FOR UPDATE");
            $st->execute([':l' => $like]);
            $max = $st->fetchColumn();
            $seq = 0;
            if ($max && preg_match('/(\d+)$/', (string)$max, $m)) $seq = (int)$m[1];
            $next = sprintf('%s%d-%04d', $prefix, $year, $seq + 1);
            $pdo->commit();
            return $next;
        } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
    }

    public static function publicToken(): string
    {
        return bin2hex(random_bytes(16));
    }
}
