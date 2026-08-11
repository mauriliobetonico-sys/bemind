<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;

final class ProposalTemplate
{
    public static function all(): array
    {
        return Db::conn()->query('SELECT * FROM proposal_templates ORDER BY created_at DESC')->fetchAll();
    }

    public static function find(int $id): ?array
    {
        $st = Db::conn()->prepare('SELECT * FROM proposal_templates WHERE id = :id');
        $st->execute([':id'=>$id]);
        return $st->fetch() ?: null;
    }

    public static function create(string $name, array $payload, ?int $userId): int
    {
        Db::conn()->prepare('INSERT INTO proposal_templates (name, payload, created_by) VALUES (:n,:p,:u)')
            ->execute([':n'=>$name,':p'=>json_encode($payload, JSON_UNESCAPED_UNICODE),':u'=>$userId]);
        return (int)Db::conn()->lastInsertId();
    }

    public static function delete(int $id): void
    {
        Db::conn()->prepare('DELETE FROM proposal_templates WHERE id = :id')->execute([':id'=>$id]);
    }
}
