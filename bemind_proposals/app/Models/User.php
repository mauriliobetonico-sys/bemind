<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;

final class User
{
    public static function all(): array
    {
        return Db::conn()->query('SELECT id,name,email,role,active,last_login_at FROM users ORDER BY name')->fetchAll();
    }

    public static function find(int $id): ?array
    {
        $st = Db::conn()->prepare('SELECT id,name,email,role,active,last_login_at FROM users WHERE id = :id');
        $st->execute([':id' => $id]);
        return $st->fetch() ?: null;
    }

    public static function create(string $name, string $email, string $password, string $role = 'comercial'): int
    {
        $st = Db::conn()->prepare('INSERT INTO users (name,email,password_hash,role,active) VALUES (:n,:e,:h,:r,1)');
        $st->execute([':n'=>$name,':e'=>strtolower($email),':h'=>password_hash($password, PASSWORD_DEFAULT),':r'=>$role]);
        return (int)Db::conn()->lastInsertId();
    }

    public static function update(int $id, array $d): void
    {
        $set = []; $args = [':id'=>$id];
        foreach (['name','email','role','active'] as $c) {
            if (array_key_exists($c, $d)) { $set[]="$c=:$c"; $args[":$c"]=$d[$c]; }
        }
        if (!empty($d['password'])) { $set[]='password_hash=:h'; $args[':h']=password_hash($d['password'], PASSWORD_DEFAULT); }
        if (!$set) return;
        Db::conn()->prepare('UPDATE users SET ' . implode(',',$set) . ' WHERE id = :id')->execute($args);
    }
}
