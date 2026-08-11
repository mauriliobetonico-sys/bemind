<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;

final class Briefing
{
    public static function all(?string $status = null, int $limit = 200): array
    {
        $sql = 'SELECT b.*, c.company_name AS client_name FROM briefings b
                LEFT JOIN clients c ON c.id = b.client_id';
        $args = [];
        if ($status && $status !== 'todos') { $sql .= ' WHERE b.status = :s'; $args[':s'] = $status; }
        $sql .= ' ORDER BY b.created_at DESC LIMIT ' . (int)$limit;
        $st = Db::conn()->prepare($sql);
        $st->execute($args);
        return $st->fetchAll();
    }

    public static function find(int $id): ?array
    {
        $st = Db::conn()->prepare('SELECT b.*, c.company_name AS client_name FROM briefings b
                                   LEFT JOIN clients c ON c.id = b.client_id WHERE b.id = :id');
        $st->execute([':id'=>$id]);
        return $st->fetch() ?: null;
    }

    public static function findByToken(string $token): ?array
    {
        $st = Db::conn()->prepare('SELECT b.*, c.company_name AS client_name FROM briefings b
                                   LEFT JOIN clients c ON c.id = b.client_id WHERE b.public_token = :t');
        $st->execute([':t'=>$token]);
        return $st->fetch() ?: null;
    }

    public static function create(array $d): int
    {
        Db::conn()->prepare(
            'INSERT INTO briefings (number, public_token, client_id, contact_name, contact_email, kind, status, total_questions)
             VALUES (:num,:tok,:cli,:cn,:ce,:kind,:st,:tq)'
        )->execute([
            ':num'=>$d['number'],':tok'=>$d['public_token'],
            ':cli'=>$d['client_id']??null,':cn'=>$d['contact_name']??null,
            ':ce'=>$d['contact_email']??null,':kind'=>$d['kind']??null,
            ':st'=>$d['status']??'aguardando',':tq'=>(int)($d['total_questions']??12),
        ]);
        return (int)Db::conn()->lastInsertId();
    }

    public static function questions(): array
    {
        return Db::conn()->query('SELECT * FROM briefing_questions ORDER BY section, sort_order')->fetchAll();
    }

    public static function answers(int $briefingId): array
    {
        $st = Db::conn()->prepare('SELECT question_id, value FROM briefing_answers WHERE briefing_id = :id');
        $st->execute([':id'=>$briefingId]);
        $out = [];
        foreach ($st->fetchAll() as $r) $out[(int)$r['question_id']] = $r['value'];
        return $out;
    }

    public static function saveAnswer(int $briefingId, int $questionId, mixed $value): void
    {
        if (is_array($value)) $value = json_encode(array_values($value), JSON_UNESCAPED_UNICODE);
        Db::conn()->prepare(
            'INSERT INTO briefing_answers (briefing_id,question_id,value) VALUES (:b,:q,:v)
             ON DUPLICATE KEY UPDATE value = VALUES(value)'
        )->execute([':b'=>$briefingId,':q'=>$questionId,':v'=>$value]);
    }

    public static function markViewed(int $id): void
    {
        Db::conn()->prepare('UPDATE briefings SET first_viewed_at = COALESCE(first_viewed_at, NOW()) WHERE id = :id')
            ->execute([':id'=>$id]);
    }

    public static function submit(int $id, int $answersCount): void
    {
        Db::conn()->prepare('UPDATE briefings SET status = "respondido", answered_at = NOW(), answers_count = :n WHERE id = :id')
            ->execute([':n'=>$answersCount,':id'=>$id]);
    }
}
