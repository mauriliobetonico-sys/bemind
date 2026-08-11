<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Db;
use PDO;

final class Proposal
{
    /* -------------------- CRUD principal -------------------- */

    public static function all(?string $status = null, ?string $q = null, int $limit = 200): array
    {
        $sql = 'SELECT p.*, c.company_name AS client_name
                FROM proposals p JOIN clients c ON c.id = p.client_id
                WHERE p.archived_at IS NULL';
        $args = [];
        if ($status && $status !== 'todas') { $sql .= ' AND p.status = :s'; $args[':s'] = $status; }
        if ($q) {
            $sql .= ' AND (p.number LIKE :q OR p.title LIKE :q OR c.company_name LIKE :q)';
            $args[':q'] = '%' . $q . '%';
        }
        $sql .= ' ORDER BY p.created_at DESC LIMIT ' . (int)$limit;
        $st = Db::conn()->prepare($sql);
        $st->execute($args);
        return $st->fetchAll();
    }

    public static function find(int $id): ?array
    {
        $st = Db::conn()->prepare('SELECT p.*, c.company_name AS client_name, c.contact_name, c.email AS client_email,
                                          c.whatsapp AS client_whatsapp
                                   FROM proposals p JOIN clients c ON c.id = p.client_id
                                   WHERE p.id = :id');
        $st->execute([':id' => $id]);
        return $st->fetch() ?: null;
    }

    public static function findByToken(string $token): ?array
    {
        $st = Db::conn()->prepare('SELECT p.*, c.company_name AS client_name, c.contact_name, c.email AS client_email
                                   FROM proposals p JOIN clients c ON c.id = p.client_id
                                   WHERE p.public_token = :t');
        $st->execute([':t' => $token]);
        return $st->fetch() ?: null;
    }

    public static function create(array $d): int
    {
        $sql = 'INSERT INTO proposals
                (number, public_token, client_id, user_id, title, project, summary, status,
                 issue_date, valid_until, payment_terms, terms_text, discount_percent, currency)
                VALUES (:num,:tok,:cli,:usr,:title,:project,:summary,:status,
                        :issue,:valid,:pay,:terms,:disc,"BRL")';
        Db::conn()->prepare($sql)->execute([
            ':num'=>$d['number'],':tok'=>$d['public_token'],':cli'=>(int)$d['client_id'],
            ':usr'=>$d['user_id']??null,':title'=>$d['title']??'Proposta comercial',
            ':project'=>$d['project']??null,':summary'=>$d['summary']??null,
            ':status'=>$d['status']??'rascunho',
            ':issue'=>$d['issue_date']??date('Y-m-d'),':valid'=>$d['valid_until']??null,
            ':pay'=>$d['payment_terms']??null,':terms'=>$d['terms_text']??null,
            ':disc'=>(float)($d['discount_percent']??0),
        ]);
        return (int)Db::conn()->lastInsertId();
    }

    public static function update(int $id, array $d): void
    {
        $cols = ['title','project','summary','status','issue_date','valid_until',
                 'payment_terms','terms_text','discount_percent','client_id','sent_at'];
        $set = []; $args = [':id'=>$id];
        foreach ($cols as $c) {
            if (array_key_exists($c, $d)) { $set[]="$c=:$c"; $args[":$c"]=$d[$c]; }
        }
        if (!$set) return;
        Db::conn()->prepare('UPDATE proposals SET ' . implode(',', $set) . ' WHERE id = :id')->execute($args);
    }

    public static function updateTotals(int $id, float $subMon, float $subOnce, float $totMon, float $totOnce, float $discValue): void
    {
        Db::conn()->prepare(
            'UPDATE proposals SET subtotal_monthly=:sm, subtotal_once=:so,
                                  total_monthly=:tm, total_once=:to, discount_value=:dv
             WHERE id = :id'
        )->execute([':sm'=>$subMon,':so'=>$subOnce,':tm'=>$totMon,':to'=>$totOnce,':dv'=>$discValue,':id'=>$id]);
    }

    public static function setStatus(int $id, string $status): void
    {
        Db::conn()->prepare('UPDATE proposals SET status = :s WHERE id = :id')->execute([':s'=>$status,':id'=>$id]);
    }

    public static function markSent(int $id): void
    {
        Db::conn()->prepare('UPDATE proposals SET sent_at = COALESCE(sent_at, NOW()),
                             status = CASE WHEN status = "rascunho" THEN "enviada" ELSE status END
                             WHERE id = :id')->execute([':id'=>$id]);
    }

    public static function archive(int $id, bool $on = true): void
    {
        Db::conn()->prepare('UPDATE proposals SET archived_at = ' . ($on ? 'NOW()' : 'NULL') . ' WHERE id = :id')
            ->execute([':id'=>$id]);
    }

    public static function renewValidity(int $id, int $days): void
    {
        Db::conn()->prepare('UPDATE proposals SET valid_until = DATE_ADD(CURDATE(), INTERVAL :d DAY),
                             status = CASE WHEN status = "expirada" THEN "enviada" ELSE status END
                             WHERE id = :id')->execute([':d'=>$days,':id'=>$id]);
    }

    /* -------------------- Itens -------------------- */

    public static function items(int $proposalId): array
    {
        $st = Db::conn()->prepare('SELECT * FROM proposal_items WHERE proposal_id = :id ORDER BY sort_order, id');
        $st->execute([':id'=>$proposalId]);
        return $st->fetchAll();
    }

    public static function addItem(int $proposalId, array $d): int
    {
        $sql = 'INSERT INTO proposal_items
                (proposal_id, service_id, name, description, deliverables, lead_time,
                 quantity, unit_price, discount_percent, recurrence, sort_order)
                VALUES (:pid,:sid,:n,:desc,:del,:lead,:qty,:price,:disc,:rec,:sort)';
        $del = $d['deliverables'] ?? null;
        if (is_array($del)) $del = json_encode(array_values($del), JSON_UNESCAPED_UNICODE);
        Db::conn()->prepare($sql)->execute([
            ':pid'=>$proposalId,':sid'=>$d['service_id']??null,
            ':n'=>$d['name']??'',':desc'=>$d['description']??null,':del'=>$del,
            ':lead'=>$d['lead_time']??null,':qty'=>(int)($d['quantity']??1),
            ':price'=>(float)($d['unit_price']??0),':disc'=>(float)($d['discount_percent']??0),
            ':rec'=>$d['recurrence']??'unico',':sort'=>(int)($d['sort_order']??0),
        ]);
        return (int)Db::conn()->lastInsertId();
    }

    public static function updateItem(int $itemId, array $d): void
    {
        // Nota: `unit_price` estava definido mas faltava no whitelist antes — corrigido.
        $cols = ['name','description','lead_time','quantity','unit_price',
                 'discount_percent','recurrence','sort_order'];
        $set = []; $args = [':id'=>$itemId];
        foreach ($cols as $c) {
            if (array_key_exists($c, $d)) { $set[]="$c=:$c"; $args[":$c"]=$d[$c]; }
        }
        if (!$set) return;
        Db::conn()->prepare('UPDATE proposal_items SET ' . implode(',',$set) . ' WHERE id = :id')->execute($args);
    }

    public static function deleteItem(int $itemId): void
    {
        Db::conn()->prepare('DELETE FROM proposal_items WHERE id = :id')->execute([':id'=>$itemId]);
    }

    public static function reorderItems(int $proposalId, array $ids): void
    {
        $st = Db::conn()->prepare('UPDATE proposal_items SET sort_order = :s WHERE id = :i AND proposal_id = :p');
        foreach ($ids as $i => $id) $st->execute([':s'=>$i,':i'=>(int)$id,':p'=>$proposalId]);
    }

    /* -------------------- Views (tracking) -------------------- */

    public static function views(int $proposalId, int $limit = 50): array
    {
        $st = Db::conn()->prepare('SELECT * FROM proposal_views WHERE proposal_id = :id
                                   ORDER BY viewed_at DESC LIMIT ' . (int)$limit);
        $st->execute([':id'=>$proposalId]);
        return $st->fetchAll();
    }

    /* -------------------- Acceptance -------------------- */

    public static function acceptance(int $proposalId): ?array
    {
        $st = Db::conn()->prepare('SELECT * FROM proposal_acceptances WHERE proposal_id = :id ORDER BY accepted_at DESC LIMIT 1');
        $st->execute([':id'=>$proposalId]);
        return $st->fetch() ?: null;
    }

    public static function recordAcceptance(int $proposalId, array $d): int
    {
        Db::conn()->prepare(
            'INSERT INTO proposal_acceptances (proposal_id,name,email,doc,ip,user_agent,terms_version)
             VALUES (:p,:n,:e,:d,:ip,:ua,:tv)'
        )->execute([
            ':p'=>$proposalId,':n'=>$d['name'],':e'=>$d['email'],':d'=>$d['doc']??null,
            ':ip'=>$d['ip']??null,':ua'=>$d['user_agent']??null,':tv'=>$d['terms_version']??'v1',
        ]);
        return (int)Db::conn()->lastInsertId();
    }

    /* -------------------- Requests (alteração/recusa) -------------------- */

    public static function recordRequest(int $proposalId, string $kind, array $d): int
    {
        Db::conn()->prepare(
            'INSERT INTO proposal_requests (proposal_id,kind,name,email,message) VALUES (:p,:k,:n,:e,:m)'
        )->execute([
            ':p'=>$proposalId,':k'=>$kind,
            ':n'=>$d['name']??'—',':e'=>$d['email']??null,':m'=>$d['message']??'',
        ]);
        return (int)Db::conn()->lastInsertId();
    }

    /* -------------------- Schedule -------------------- */

    public static function schedule(int $proposalId): array
    {
        $st = Db::conn()->prepare('SELECT * FROM proposal_schedule WHERE proposal_id = :id ORDER BY sort_order, id');
        $st->execute([':id'=>$proposalId]);
        return $st->fetchAll();
    }

    public static function setSchedule(int $proposalId, array $phases): void
    {
        $pdo = Db::conn();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM proposal_schedule WHERE proposal_id = :id')->execute([':id'=>$proposalId]);
            $st = $pdo->prepare('INSERT INTO proposal_schedule (proposal_id,phase,period,sort_order) VALUES (:p,:ph,:pe,:s)');
            foreach (array_values($phases) as $i => $ph) {
                $st->execute([':p'=>$proposalId,':ph'=>$ph['phase'],':pe'=>$ph['period']??null,':s'=>$i]);
            }
            $pdo->commit();
        } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
    }

    /* -------------------- Duplicar -------------------- */

    public static function duplicate(int $id, string $newNumber, string $newToken): int
    {
        $pdo = Db::conn(); $pdo->beginTransaction();
        try {
            $src = self::find($id);
            if (!$src) throw new \RuntimeException('Proposta origem não encontrada.');

            $newId = self::create([
                'number'=>$newNumber,'public_token'=>$newToken,
                'client_id'=>$src['client_id'],'user_id'=>$src['user_id'],
                'title'=>$src['title'],'project'=>$src['project'],'summary'=>$src['summary'],
                'status'=>'rascunho','issue_date'=>date('Y-m-d'),'valid_until'=>null,
                'payment_terms'=>$src['payment_terms'],'terms_text'=>$src['terms_text'],
                'discount_percent'=>$src['discount_percent'],
            ]);

            foreach (self::items($id) as $it) {
                self::addItem($newId, [
                    'service_id'=>$it['service_id'],'name'=>$it['name'],'description'=>$it['description'],
                    'deliverables'=>$it['deliverables'],'lead_time'=>$it['lead_time'],
                    'quantity'=>$it['quantity'],'unit_price'=>$it['unit_price'],
                    'discount_percent'=>$it['discount_percent'],'recurrence'=>$it['recurrence'],
                    'sort_order'=>$it['sort_order'],
                ]);
            }
            foreach (self::schedule($id) as $ph) {
                Db::conn()->prepare('INSERT INTO proposal_schedule (proposal_id,phase,period,sort_order) VALUES (:p,:ph,:pe,:s)')
                    ->execute([':p'=>$newId,':ph'=>$ph['phase'],':pe'=>$ph['period'],':s'=>$ph['sort_order']]);
            }

            $pdo->commit();
            return $newId;
        } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
    }

    /* -------------------- KPIs / relatórios -------------------- */

    public static function kpisForYear(int $year): array
    {
        $st = Db::conn()->prepare(
            'SELECT status, COUNT(*) AS c, COALESCE(SUM(total_once + total_monthly*12),0) AS v
             FROM proposals WHERE YEAR(issue_date) = :y AND archived_at IS NULL
             GROUP BY status');
        $st->execute([':y'=>$year]);
        $out = ['rascunho'=>0,'enviada'=>0,'visualizada'=>0,'aprovada'=>0,'recusada'=>0,'pendente'=>0,'expirada'=>0,'value_approved'=>0.0,'value_sent'=>0.0,'value_lost'=>0.0];
        foreach ($st->fetchAll() as $r) {
            $out[$r['status']] = (int)$r['c'];
            if ($r['status'] === 'aprovada')   $out['value_approved'] = (float)$r['v'];
            if ($r['status'] === 'recusada')   $out['value_lost']     = (float)$r['v'];
            if (in_array($r['status'], ['enviada','visualizada','negociacao','alteracao'], true)) {
                $out['value_sent'] += (float)$r['v'];
                $out['pendente']  += (int)$r['c'];
            }
        }
        $out['created'] = array_sum([$out['rascunho'],$out['enviada'],$out['visualizada'],$out['aprovada'],$out['recusada'],$out['expirada']]);
        return $out;
    }

    public static function topServices(int $limit = 5): array
    {
        $st = Db::conn()->prepare(
            'SELECT COALESCE(s.name, pi.name) AS name, COUNT(*) AS cnt,
                    COALESCE(SUM(pi.unit_price * pi.quantity),0) AS revenue
             FROM proposal_items pi
             LEFT JOIN services s ON s.id = pi.service_id
             JOIN proposals p ON p.id = pi.proposal_id
             WHERE p.status = "aprovada"
             GROUP BY name
             ORDER BY revenue DESC
             LIMIT ' . (int)$limit
        );
        $st->execute();
        return $st->fetchAll();
    }

    public static function recentActivity(int $limit = 5): array
    {
        return Db::conn()->query(
            'SELECT a.action, a.entity_type, a.entity_id, a.created_at, a.meta,
                    (SELECT p.number FROM proposals p WHERE p.id = a.entity_id) AS number
             FROM activity_logs a
             WHERE a.entity_type IN ("proposal","proposal_view","proposal_acceptance","briefing")
             ORDER BY a.created_at DESC
             LIMIT ' . (int)$limit
        )->fetchAll();
    }
}
