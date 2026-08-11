<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Db;
use App\Models\ActivityLog;
use App\Models\Notification;
use App\Models\Proposal;

final class Tracking
{
    public static function registerView(int $proposalId, string $ip, string $ua, ?string $ref = null): void
    {
        $device = self::detectDevice($ua);
        Db::conn()->prepare(
            'INSERT INTO proposal_views (proposal_id,viewed_at,ip,user_agent,device,referrer)
             VALUES (:p,NOW(),:ip,:ua,:d,:r)'
        )->execute([':p'=>$proposalId,':ip'=>$ip,':ua'=>$ua,':d'=>$device,':r'=>$ref]);

        Db::conn()->prepare(
            'UPDATE proposals SET
                views_count = views_count + 1,
                first_viewed_at = COALESCE(first_viewed_at, NOW()),
                last_viewed_at = NOW(),
                status = CASE
                    WHEN status = "enviada" THEN "visualizada"
                    ELSE status END
             WHERE id = :id'
        )->execute([':id'=>$proposalId]);

        $p = Proposal::find($proposalId);
        if ($p && ((int)$p['views_count'] === 1)) {
            Notification::create($p['user_id'] ?? null, 'visualizacao',
                'Cliente visualizou sua proposta',
                sprintf('%s abriu a proposta %s.', $p['client_name'] ?? 'Cliente', $p['number']),
                'proposal', $proposalId);
        }
        ActivityLog::log('viewed', 'proposal', $proposalId, ['ip'=>$ip,'device'=>$device]);
    }

    public static function detectDevice(string $ua): string
    {
        $ua = strtolower($ua);
        if (str_contains($ua, 'iphone'))  return 'iPhone';
        if (str_contains($ua, 'ipad'))    return 'iPad';
        if (str_contains($ua, 'android')) return 'Android';
        if (str_contains($ua, 'mac'))     return 'macOS';
        if (str_contains($ua, 'windows')) return 'Windows';
        if (str_contains($ua, 'linux'))   return 'Linux';
        return 'Desconhecido';
    }
}
