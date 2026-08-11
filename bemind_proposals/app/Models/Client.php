<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;
use PDO;

final class Client
{
    public static function all(?string $q = null, int $limit = 200): array
    {
        $sql = 'SELECT c.*,
                       (SELECT COUNT(*) FROM proposals p WHERE p.client_id = c.id) AS proposals_count,
                       (SELECT COALESCE(SUM(p.total_once + p.total_monthly*12),0)
                          FROM proposals p WHERE p.client_id = c.id AND p.status = "aprovada") AS total_contracted
                FROM clients c';
        $args = [];
        if ($q) {
            $sql .= ' WHERE c.company_name LIKE :q OR c.trade_name LIKE :q OR c.doc LIKE :q';
            $args[':q'] = '%' . $q . '%';
        }
        $sql .= ' ORDER BY c.company_name ASC LIMIT ' . (int)$limit;
        $st = Db::conn()->prepare($sql);
        $st->execute($args);
        return $st->fetchAll();
    }

    public static function find(int $id): ?array
    {
        $st = Db::conn()->prepare('SELECT * FROM clients WHERE id = :id');
        $st->execute([':id' => $id]);
        return $st->fetch() ?: null;
    }

    public static function create(array $d): int
    {
        $sql = 'INSERT INTO clients (company_name,trade_name,doc,contact_name,email,phone,whatsapp,address,city,state,segment,notes)
                VALUES (:company_name,:trade_name,:doc,:contact_name,:email,:phone,:whatsapp,:address,:city,:state,:segment,:notes)';
        $st = Db::conn()->prepare($sql);
        $st->execute(self::bind($d));
        return (int)Db::conn()->lastInsertId();
    }

    public static function update(int $id, array $d): void
    {
        $sql = 'UPDATE clients SET company_name=:company_name, trade_name=:trade_name, doc=:doc,
                contact_name=:contact_name, email=:email, phone=:phone, whatsapp=:whatsapp,
                address=:address, city=:city, state=:state, segment=:segment, notes=:notes
                WHERE id = :id';
        $st = Db::conn()->prepare($sql);
        $st->execute(self::bind($d) + [':id' => $id]);
    }

    public static function stats(int $id): array
    {
        $st = Db::conn()->prepare(
            'SELECT
                SUM(CASE WHEN status IN ("rascunho","enviada","visualizada","negociacao","alteracao") THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = "aprovada" THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN status = "recusada" THEN 1 ELSE 0 END) AS declined,
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status = "aprovada" THEN (total_once + total_monthly*12) ELSE 0 END),0) AS contracted
             FROM proposals WHERE client_id = :id');
        $st->execute([':id' => $id]);
        return $st->fetch() ?: ['pending'=>0,'approved'=>0,'declined'=>0,'total'=>0,'contracted'=>0.0];
    }

    public static function recentProposals(int $id, int $limit = 5): array
    {
        $st = Db::conn()->prepare('SELECT id, number, title, project, status, total_monthly, total_once
                                   FROM proposals WHERE client_id = :id ORDER BY created_at DESC LIMIT ' . (int)$limit);
        $st->execute([':id' => $id]);
        return $st->fetchAll();
    }

    private static function bind(array $d): array
    {
        return [
            ':company_name' => $d['company_name'] ?? '',
            ':trade_name'   => $d['trade_name']   ?? null,
            ':doc'          => $d['doc']          ?? null,
            ':contact_name' => $d['contact_name'] ?? null,
            ':email'        => $d['email']        ?? null,
            ':phone'        => $d['phone']        ?? null,
            ':whatsapp'     => $d['whatsapp']     ?? null,
            ':address'      => $d['address']      ?? null,
            ':city'         => $d['city']         ?? null,
            ':state'        => $d['state']        ?? null,
            ':segment'      => $d['segment']      ?? null,
            ':notes'        => $d['notes']        ?? null,
        ];
    }
}
