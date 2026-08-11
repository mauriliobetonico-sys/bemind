<?php
declare(strict_types=1);

namespace App\Services;

final class Csv
{
    public static function stream(string $filename, array $header, iterable $rows): never
    {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        $out = fopen('php://output', 'w');
        // BOM p/ Excel
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, $header, ';');
        foreach ($rows as $r) fputcsv($out, $r, ';');
        fclose($out);
        exit;
    }
}
