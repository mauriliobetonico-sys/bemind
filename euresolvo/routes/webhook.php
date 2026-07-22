<?php
// /api/v1/webhook — endpoints públicos para PSP notificações (idempotente)
$db = getDB();

if ($id === 'mercadopago' && $method === 'POST') {
    $raw = file_get_contents('php://input');
    $payload = json_decode($raw, true) ?: [];

    // Dedup por event id
    $eventId = (string)($payload['id'] ?? $payload['data']['id'] ?? md5($raw));
    $eventType = (string)($payload['type'] ?? $payload['action'] ?? 'unknown');

    try {
        $db->prepare("INSERT INTO webhook_events (provider,event_id,event_type,payload) VALUES ('mercadopago',?,?,?)")
           ->execute([$eventId, $eventType, $raw]);
    } catch (Throwable) {
        // Já processado
        http_response_code(200); echo 'dup'; exit;
    }

    // Verifica assinatura (opcional em dev)
    $sig = $_SERVER['HTTP_X_SIGNATURE'] ?? '';
    $reqId = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';
    $dataId = (string)($payload['data']['id'] ?? '');
    if (MP_WEBHOOK_SECRET && !mpVerifyWebhook($reqId, $dataId, $sig)) {
        http_response_code(401); echo 'invalid signature'; exit;
    }

    try {
        // Processa cobrança confirmada
        if ($eventType === 'payment' || ($payload['type'] ?? '') === 'payment') {
            $paymentId = $dataId ?: (string)($payload['data']['id'] ?? '');
            if ($paymentId) {
                $mp = mpGetPayment($paymentId);
                $status = $mp['status'] ?? 'unknown';
                $extRef = $mp['external_reference'] ?? '';
                $orderId = 0;
                if (preg_match('/^ER-(\d+)$/', $extRef, $m)) $orderId = (int)$m[1];

                $stmt = $db->prepare("SELECT * FROM payment_transactions WHERE provider='mercadopago' AND provider_ref=?");
                $stmt->execute([$paymentId]);
                $tx = $stmt->fetch();

                if ($tx) {
                    $newStatus = match($status) {
                        'approved'  => 'captured',
                        'in_process','pending' => 'authorized',
                        'rejected'  => 'failed',
                        'refunded'  => 'refunded',
                        'cancelled' => 'cancelled',
                        default     => 'pending',
                    };
                    $db->prepare("UPDATE payment_transactions SET status=?, processed_at=NOW(), raw_payload=? WHERE id=?")
                       ->execute([$newStatus, json_encode($mp), $tx['id']]);

                    if ($newStatus === 'captured' && $orderId) {
                        // Funda o escrow
                        $amountCents = (int) round(((float)($mp['transaction_amount'] ?? 0)) * 100);
                        fundOrder($orderId, $amountCents, (int)$tx['user_id'], "mp-$paymentId");
                        $db->prepare("UPDATE service_orders SET status='matched' WHERE id=? AND status IN ('draft','published')")
                           ->execute([$orderId]);
                        wsBroadcast('order.funded', ['order_id' => $orderId, 'amount_cents' => $amountCents]);
                    }
                }
            }
        }

        $db->prepare("UPDATE webhook_events SET processed=1 WHERE event_id=? AND provider='mercadopago'")->execute([$eventId]);
    } catch (Throwable $e) {
        error_log('MP webhook error: ' . $e->getMessage());
        http_response_code(500); echo 'error'; exit;
    }
    http_response_code(200); echo 'ok'; exit;
}

if ($id === 'stripe' && $method === 'POST') {
    // Placeholder — implementar verificação stripe-signature + eventos correspondentes.
    http_response_code(200); echo 'ok'; exit;
}

http_response_code(404); echo 'unknown provider'; exit;
