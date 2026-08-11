<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;

final class Notification
{
    public static function all(int $userId, int $limit = 50): array
    {
        $st = Db::conn()->prepare('SELECT * FROM notifications WHERE user_id IS NULL OR user_id = :u
                                   ORDER BY created_at DESC LIMIT ' . (int)$limit);
        $st->execute([':u'=>$userId]);
        return $st->fetchAll();
    }

    public static function unreadCount(int $userId): int
    {
        $st = Db::conn()->prepare('SELECT COUNT(*) FROM notifications WHERE (user_id IS NULL OR user_id = :u) AND read_at IS NULL');
        $st->execute([':u'=>$userId]);
        return (int)$st->fetchColumn();
    }

    public static function create(?int $userId, string $type, string $title, ?string $body = null, ?string $entityType = null, ?int $entityId = null): int
    {
        Db::conn()->prepare(
            'INSERT INTO notifications (user_id,type,title,body,entity_type,entity_id) VALUES (:u,:t,:ti,:b,:et,:ei)'
        )->execute([':u'=>$userId,':t'=>$type,':ti'=>$title,':b'=>$body,':et'=>$entityType,':ei'=>$entityId]);
        return (int)Db::conn()->lastInsertId();
    }

    public static function markRead(int $id, int $userId): void
    {
        Db::conn()->prepare('UPDATE notifications SET read_at = NOW() WHERE id = :id AND (user_id IS NULL OR user_id = :u)')
            ->execute([':id'=>$id,':u'=>$userId]);
    }
}
