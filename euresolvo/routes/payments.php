<?php
// /api/v1/payments — cobrança da empresa (PIX/cartão) → escrow → payout ao instalador
$user = requireAuth();
$db = getDB();

// POST /payments/fund/:order_id  — empresa cria a cobrança do escrow
if ($method === 'POST' && $id === 'fund' && ctype_digit((string)$sub)) {
    requireRole(['empresa', 'admin'], $user);
    $orderId = (int)$sub;
    $st = $db->prepare("SELECT * FROM service_orders WHERE id=?");
    $st->execute([$orderId]);
    $order = $st->fetch();
    if (!$order) bad('OS não encontrada.', 404);

    // Snapshot do pagador
    $payerStmt = $db->prepare('SELECT u.name,u.email,c.cnpj FROM users u JOIN companies c ON c.user_id=u.id WHERE u.id=?');
    $payerStmt->execute([$user['id']]);
    $p = $payerStmt->fetch() ?: [];
    $payer = [
        'email'      => $p['email'] ?? $user['email'],
        'first_name' => explode(' ', $p['name'] ?? $user['name'])[0] ?? '',
        'last_name'  => trim(strstr(($p['name'] ?? $user['name']) . ' ', ' ')),
        'doc_type'   => 'CNPJ',
        'doc'        => $p['cnpj'] ?? '',
    ];

    $method_ = strtolower((string) inp('method', $order['payment_method']));
    $amountCents = (int) round(((float)$order['offered_value']) * 100);

    // Registra transação em pending
    $db->prepare("INSERT INTO payment_transactions (order_id,user_id,provider,kind,method,status,gross_cents,net_cents)
                  VALUES (?,?,?,?,?,?,?,?)")
       ->execute([$orderId, $user['id'], 'mercadopago', 'funding', $method_, 'pending', $amountCents, $amountCents]);
    $txId = (int)$db->lastInsertId();

    try {
        if ($method_ === 'pix') {
            $res = mpCreatePixCharge($order, $payer);
            $qr    = $res['point_of_interaction']['transaction_data']['qr_code'] ?? null;
            $qr64  = $res['point_of_interaction']['transaction_data']['qr_code_base64'] ?? null;
            $ticket = $res['point_of_interaction']['transaction_data']['ticket_url'] ?? null;
            $db->prepare("UPDATE payment_transactions SET provider_ref=?, raw_payload=? WHERE id=?")
               ->execute([(string)($res['id'] ?? ''), json_encode($res), $txId]);
            json_out(['tx_id' => $txId, 'pix' => ['copy_paste' => $qr, 'qr_base64' => $qr64, 'ticket_url' => $ticket]]);
        } else {
            $pref = mpCreateCardPreference($order, $payer);
            $db->prepare("UPDATE payment_transactions SET provider_ref=?, raw_payload=? WHERE id=?")
               ->execute([(string)($pref['id'] ?? ''), json_encode($pref), $txId]);
            json_out(['tx_id' => $txId, 'checkout_url' => $pref['init_point'] ?? $pref['sandbox_init_point'] ?? null]);
        }
    } catch (Throwable $e) {
        $db->prepare("UPDATE payment_transactions SET status='failed', raw_payload=? WHERE id=?")
           ->execute([json_encode(['error' => $e->getMessage()]), $txId]);
        bad('Falha na cobrança: ' . $e->getMessage(), 502, 'PSP_ERROR');
    }
}

// POST /payments/simulate/:order_id — captura simulada (dev/homologação): funda escrow diretamente
if ($method === 'POST' && $id === 'simulate' && ctype_digit((string)$sub)) {
    requireRole(['admin'], $user);
    $orderId = (int)$sub;
    $o = $db->prepare('SELECT * FROM service_orders WHERE id=?'); $o->execute([$orderId]);
    $order = $o->fetch(); if (!$order) bad('OS não encontrada.', 404);
    $amountCents = (int) round(((float)$order['offered_value']) * 100);
    fundOrder($orderId, $amountCents, (int)$order['created_by'], 'simulate');
    $db->prepare("UPDATE service_orders SET status='matched' WHERE id=? AND status IN ('draft','published')")->execute([$orderId]);
    json_out(['ok' => true, 'funded_cents' => $amountCents]);
}

// GET /payments/tx?order_id=
if ($method === 'GET' && $id === 'tx') {
    $orderId = (int) inp('order_id', 0);
    if (!$orderId) bad('order_id obrigatório.');
    $q = $db->prepare('SELECT * FROM payment_transactions WHERE order_id=? ORDER BY id DESC');
    $q->execute([$orderId]);
    json_out($q->fetchAll());
}

bad('Rota não encontrada.', 404);
