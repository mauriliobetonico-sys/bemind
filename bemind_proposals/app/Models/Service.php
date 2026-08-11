<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;

final class Service
{
    public static function categories(): array
    {
        return Db::conn()->query('SELECT * FROM service_categories ORDER BY sort_order, name')->fetchAll();
    }

    public static function byCategory(?int $categoryId = null): array
    {
        $sql = 'SELECT s.*, c.name AS category_name, c.slug AS category_slug
                FROM services s JOIN service_categories c ON c.id = s.category_id
                WHERE s.active = 1';
        $args = [];
        if ($categoryId !== null) { $sql .= ' AND s.category_id = :c'; $args[':c'] = $categoryId; }
        $sql .= ' ORDER BY c.sort_order, s.sort_order, s.name';
        $st = Db::conn()->prepare($sql);
        $st->execute($args);
        return $st->fetchAll();
    }

    public static function find(int $id): ?array
    {
        $st = Db::conn()->prepare('SELECT * FROM services WHERE id = :id');
        $st->execute([':id' => $id]);
        return $st->fetch() ?: null;
    }

    public static function create(array $d): int
    {
        $sql = 'INSERT INTO services (category_id,name,short_description,full_description,deliverables,lead_time,default_price,unit,recurrence,active,sort_order)
                VALUES (:cat,:name,:short,:full,:del,:lead,:price,:unit,:rec,:active,:sort)';
        Db::conn()->prepare($sql)->execute(self::bind($d));
        return (int)Db::conn()->lastInsertId();
    }

    public static function update(int $id, array $d): void
    {
        $sql = 'UPDATE services SET category_id=:cat,name=:name,short_description=:short,full_description=:full,
                deliverables=:del,lead_time=:lead,default_price=:price,unit=:unit,recurrence=:rec,active=:active,sort_order=:sort
                WHERE id = :id';
        Db::conn()->prepare($sql)->execute(self::bind($d) + [':id' => $id]);
    }

    public static function delete(int $id): void
    {
        Db::conn()->prepare('UPDATE services SET active = 0 WHERE id = :id')->execute([':id' => $id]);
    }

    private static function bind(array $d): array
    {
        $del = $d['deliverables'] ?? null;
        if (is_array($del)) $del = json_encode(array_values($del), JSON_UNESCAPED_UNICODE);
        return [
            ':cat'    => (int)($d['category_id'] ?? 0),
            ':name'   => (string)($d['name'] ?? ''),
            ':short'  => $d['short_description'] ?? null,
            ':full'   => $d['full_description']  ?? null,
            ':del'    => $del,
            ':lead'   => $d['lead_time']         ?? null,
            ':price'  => (float)($d['default_price'] ?? 0),
            ':unit'   => (string)($d['unit'] ?? 'projeto'),
            ':rec'    => (string)($d['recurrence'] ?? 'unico'),
            ':active' => (int)($d['active'] ?? 1),
            ':sort'   => (int)($d['sort_order'] ?? 0),
        ];
    }
}
