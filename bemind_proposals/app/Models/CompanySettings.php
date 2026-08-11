<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;

final class CompanySettings
{
    public static function get(): array
    {
        $row = Db::conn()->query('SELECT * FROM company_settings WHERE id = 1')->fetch();
        return $row ?: [];
    }

    public static function update(array $d): void
    {
        $cols = ['name','logo_path','email','phone','whatsapp','address','doc','site','instagram',
                 'bank_info','proposal_prefix','default_validity_days','pix_key','pix_key_type',
                 'pix_holder','pix_bank','show_pix_in_proposals','auto_save_enabled','dark_mode'];
        $set = []; $args = [':id' => 1];
        foreach ($cols as $c) {
            if (array_key_exists($c, $d)) { $set[] = "$c = :$c"; $args[":$c"] = $d[$c]; }
        }
        if (!$set) return;
        Db::conn()->prepare('UPDATE company_settings SET ' . implode(',', $set) . ' WHERE id = :id')->execute($args);
    }
}
