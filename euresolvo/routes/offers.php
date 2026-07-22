<?php
// /api/v1/offers — ofertas enviadas a instaladores; aceitar/recusar/contra-proposta
$user = requireAuth();
$db = getDB();

// Listagem: instalador vê suas próprias; empresa vê as de suas OS; admin vê tudo
if ($method === 'GET' && !$id) {
    $where = '1=1'; $vals = [];
    if ($user['role'] === 'instalador') {
        $iid = $db->prepare('SELECT id FROM installers WHERE user_id=?'); $iid->execute([$user['id']]);
        $where .= ' AND o.installer_id=?'; $vals[] = (int)$iid->fetchColumn();
        $where .= " AND o.status='pending' AND o.expires_at > NOW()";
    } elseif ($user['role'] === 'empresa') {
        $cid = $db->prepare('SELECT id FROM companies WHERE user_id=?'); $cid->execute([$user['id']]);
        $where .= ' AND so.company_id=?'; $vals[] = (int)$cid->fetchColumn();
    }
    $sql = "SELECT o.*, so.os_number, so.title, so.category, so.urgency, so.offered_value,
                   so.address_city, so.address_state, so.lat AS o_lat, so.lng AS o_lng,
                   u.name AS installer_name, i.rating_avg, i.level
            FROM offers o
            JOIN service_orders so ON so.id = o.order_id
            LEFT JOIN installers i ON i.id = o.installer_id
            LEFT JOIN users u      ON u.id = i.user_id
            WHERE $where ORDER BY o.created_at DESC LIMIT 100";
    $st = $db->prepare($sql); $st->execute($vals);
    json_out($st->fetchAll());
}

// POST /offers/:id/accept | reject | counter
if ($method === 'POST' && ctype_digit((string)$id) && in_array($sub, ['accept','reject','counter','choose'], true)) {
    $st = $db->prepare(
        "SELECT o.*, so.company_id, so.installer_id AS current_installer, i.user_id AS installer_user_id
         FROM offers o
         JOIN service_orders so ON so.id = o.order_id
         LEFT JOIN installers i ON i.id = o.installer_id
         WHERE o.id=?"
    );
    $st->execute([(int)$id]);
    $offer = $st->fetch();
    if (!$offer) bad('Oferta não encontrada.', 404);
    if ($offer['status'] !== 'pending') bad('Oferta já respondida ou expirada.');
    if (strtotime($offer['expires_at']) < time()) {
        $db->prepare("UPDATE offers SET status='expired' WHERE id=?")->execute([(int)$id]);
        bad('Oferta expirada.');
    }

    if ($sub === 'accept') {
        // Só o instalador destinatário aceita
        if ($user['role'] !== 'instalador' || (int)$user['id'] !== (int)$offer['installer_user_id']) bad('Sem permissão.', 403);
        $db->beginTransaction();
        try {
            $db->prepare("UPDATE offers SET status='accepted', responded_at=NOW() WHERE id=?")->execute([(int)$id]);
            $db->prepare("UPDATE offers SET status='withdrawn' WHERE order_id=? AND id<>? AND status='pending'")
               ->execute([(int)$offer['order_id'], (int)$id]);
            $db->prepare("UPDATE service_orders SET installer_id=?, status='accepted' WHERE id=?")
               ->execute([(int)$offer['installer_id'], (int)$offer['order_id']]);
            $db->commit();
        } catch (Throwable $e) { $db->rollBack(); throw $e; }
        wsBroadcast('offer.accepted', ['offer_id' => (int)$id, 'order_id' => (int)$offer['order_id']]);
        auditLog($user['id'], 'offer.accept', 'offer', (int)$id);
        json_out(['ok' => true]);
    }

    if ($sub === 'reject') {
        if ($user['role'] !== 'instalador' || (int)$user['id'] !== (int)$offer['installer_user_id']) bad('Sem permissão.', 403);
        $db->prepare("UPDATE offers SET status='declined', responded_at=NOW() WHERE id=?")->execute([(int)$id]);
        auditLog($user['id'], 'offer.reject', 'offer', (int)$id);
        json_out(['ok' => true]);
    }

    if ($sub === 'counter') {
        if ($user['role'] !== 'instalador' || (int)$user['id'] !== (int)$offer['installer_user_id']) bad('Sem permissão.', 403);
        $value = (float) inp('value', 0);
        $notes = (string) inp('notes', '');
        if ($value <= 0) bad('Valor inválido.');
        $db->prepare("UPDATE offers SET status='counter', counter_value=?, counter_notes=?, responded_at=NOW() WHERE id=?")
           ->execute([$value, $notes, (int)$id]);
        wsBroadcast('offer.counter', ['offer_id' => (int)$id, 'value' => $value]);
        json_out(['ok' => true]);
    }

    if ($sub === 'choose') {
        // Empresa escolhe uma oferta no modo manual
        requireRole(['empresa','admin'], $user);
        $db->beginTransaction();
        try {
            $db->prepare("UPDATE offers SET status='accepted', responded_at=NOW() WHERE id=?")->execute([(int)$id]);
            $db->prepare("UPDATE offers SET status='withdrawn' WHERE order_id=? AND id<>? AND status='pending'")
               ->execute([(int)$offer['order_id'], (int)$id]);
            $db->prepare("UPDATE service_orders SET installer_id=?, status='accepted' WHERE id=?")
               ->execute([(int)$offer['installer_id'], (int)$offer['order_id']]);
            $db->commit();
        } catch (Throwable $e) { $db->rollBack(); throw $e; }
        wsBroadcast('offer.chosen', ['offer_id' => (int)$id, 'order_id' => (int)$offer['order_id']]);
        json_out(['ok' => true]);
    }
}

bad('Rota não encontrada.', 404);
