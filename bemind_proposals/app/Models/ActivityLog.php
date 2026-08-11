<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;
use App\Core\Session;

final class ActivityLog
{
    public static function log(string $action, string $entityType, ?int $entityId = null, array $meta = []): void
    {
        $user = Session::user();
        Db::conn()->prepare(
            'INSERT INTO activity_logs (user_id,action,entity_type,entity_id,meta,ip) VALUES (:u,:a,:et,:ei,:m,:ip)'
        )->execute([
            ':u'=>$user['id']??null,':a'=>$action,':et'=>$entityType,':ei'=>$entityId,
            ':m'=>$meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : null,
            ':ip'=>$_SERVER['REMOTE_ADDR']??null,
        ]);
    }
}
