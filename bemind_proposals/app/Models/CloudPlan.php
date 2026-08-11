<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;

final class CloudPlan
{
    public static function all(): array
    {
        return Db::conn()->query('SELECT * FROM cloud_plans WHERE active = 1 ORDER BY sort_order, id')->fetchAll();
    }

    public static function find(int $id): ?array
    {
        $st = Db::conn()->prepare('SELECT * FROM cloud_plans WHERE id = :id');
        $st->execute([':id' => $id]);
        return $st->fetch() ?: null;
    }

    public static function update(int $id, array $d): void
    {
        $sql = 'UPDATE cloud_plans SET name=:name, monthly_price=:m, annual_price=:a, min_price=:mp,
                disk=:disk, traffic=:traffic, sites=:sites, mailboxes=:mb, databases=:db,
                ssl=:ssl, backup=:bk, support=:sp, migration=:mg, notes=:notes, active=:active
                WHERE id = :id';
        $st = Db::conn()->prepare($sql);
        $st->execute([
            ':name'=>$d['name']??'',':m'=>(float)($d['monthly_price']??0),':a'=>(float)($d['annual_price']??0),
            ':mp'=>(float)($d['min_price']??150),':disk'=>$d['disk']??null,':traffic'=>$d['traffic']??null,
            ':sites'=>$d['sites']??null,':mb'=>$d['mailboxes']??null,':db'=>$d['databases']??null,
            ':ssl'=>$d['ssl']??null,':bk'=>$d['backup']??null,':sp'=>$d['support']??null,
            ':mg'=>$d['migration']??null,':notes'=>$d['notes']??null,':active'=>(int)($d['active']??1),
            ':id'=>$id,
        ]);
    }
}
