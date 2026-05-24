<?php
// ── WEBHOOK ROUTES — Integração com Gateways de Pagamento ─────────────────
// POST /api/webhook          — Mercado Pago
// POST /api/webhook/picpay   — PicPay
// POST /api/webhook/pagseguro — PagSeguro
// POST /api/webhook/n8n      — n8n internal events

if ($method !== 'POST') {
    json_out(['error' => 'Método não permitido.'], 405);
}

$gateway = $id ?? 'mercadopago';
$db      = getDB();

// ── Mercado Pago ──────────────────────────────────────────────────────────
if ($gateway === 'mercadopago' || !$gateway) {
    // Valida assinatura (x-signature header)
    $xSignature  = $_SERVER['HTTP_X_SIGNATURE'] ?? '';
    $xRequestId  = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';
    if (MP_WEBHOOK_SECRET && $xSignature) {
        $parts    = [];
        foreach (explode(',', $xSignature) as $part) {
            [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
            $parts[$k] = $v;
        }
        $manifest  = 'id:' . ($body['data']['id'] ?? '') . ';request-id:' . $xRequestId . ';ts:' . ($parts['ts'] ?? '') . ';';
        $signature = hash_hmac('sha256', $manifest, MP_WEBHOOK_SECRET);
        if (!hash_equals($signature, $parts['v1'] ?? '')) {
            http_response_code(401);
            exit(json_encode(['error' => 'Assinatura inválida.']));
        }
    }

    $type       = $body['type'] ?? '';
    $resourceId = $body['data']['id'] ?? '';

    if ($type === 'payment' && $resourceId) {
        // Consulta detalhes do pagamento na API do MP
        $payment = fetchMercadoPagoPayment($resourceId);
        if ($payment) {
            processGatewayPayment(
                $payment['external_reference'] ?? '',
                $resourceId,
                $payment['status'] ?? '',
                (float)($payment['transaction_amount'] ?? 0),
                'Mercado Pago',
                $db
            );
        }
    }

    json_out(['received' => true, 'gateway' => 'mercadopago']);
}

// ── PicPay ────────────────────────────────────────────────────────────────
if ($gateway === 'picpay') {
    $referenceId = $body['referenceId'] ?? '';
    $status      = $body['status'] ?? '';
    $amount      = (float)($body['charge']['amount'] ?? 0);

    if ($status === 'completed' || $status === 'chargeback') {
        processGatewayPayment(
            $referenceId,
            $body['authorizationId'] ?? '',
            $status === 'completed' ? 'approved' : 'refunded',
            $amount,
            'PicPay',
            $db
        );
    }

    json_out(['received' => true, 'gateway' => 'picpay']);
}

// ── PagSeguro ─────────────────────────────────────────────────────────────
if ($gateway === 'pagseguro') {
    $notificationCode = $body['notificationCode'] ?? inp('notificationCode', '');
    error_log("VisãoOS PagSeguro webhook: $notificationCode");
    json_out(['received' => true, 'gateway' => 'pagseguro']);
}

// ── n8n internal (usado pelo n8n para confirmar ações executadas) ──────────
if ($gateway === 'n8n') {
    $event   = $body['event'] ?? '';
    $payload = $body['data'] ?? [];

    // Autentica com segredo compartilhado
    $secret = $body['secret'] ?? '';
    if ($secret !== WS_SECRET) {
        http_response_code(401);
        exit(json_encode(['error' => 'Acesso negado.']));
    }

    error_log("VisãoOS n8n event: $event — " . json_encode($payload));
    json_out(['received' => true, 'event' => $event]);
}

json_out(['received' => true]);

// ── Helpers ───────────────────────────────────────────────────────────────
function fetchMercadoPagoPayment(string $paymentId): ?array {
    if (!MP_ACCESS_TOKEN) return null;
    $ch = curl_init("https://api.mercadopago.com/v1/payments/{$paymentId}");
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . MP_ACCESS_TOKEN],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $result = curl_exec($ch);
    curl_close($ch);
    return json_decode($result, true);
}

function processGatewayPayment(string $reference, string $gatewayId, string $status, float $amount, string $method, PDO $db): void {
    if (!$reference || $amount <= 0) return;
    if (!in_array($status, ['approved', 'completed'])) return;

    // Tenta encontrar a OS pelo external_reference (formato: OS-00001)
    $stmt = $db->prepare("SELECT id, total, os_number FROM service_orders WHERE os_number=? OR id=?");
    $stmt->execute([$reference, is_numeric($reference) ? $reference : 0]);
    $os = $stmt->fetch();
    if (!$os) {
        error_log("VisãoOS Webhook: OS não encontrada para reference=$reference");
        return;
    }

    // Evita duplicatas pelo gateway_id
    $dup = $db->prepare("SELECT COUNT(*) FROM payments WHERE gateway_id=?");
    $dup->execute([$gatewayId]);
    if ($dup->fetchColumn() > 0) return;

    $db->prepare("INSERT INTO payments (os_id,amount,method,gateway_id,notes,paid_at) VALUES (?,?,?,?,?,NOW())")
       ->execute([$os['id'], $amount, $method, $gatewayId, "Pagamento automático via $method"]);

    $paid = $db->prepare("SELECT SUM(amount) FROM payments WHERE os_id=?");
    $paid->execute([$os['id']]); $paidSum = (float)$paid->fetchColumn();
    $pstatus = $paidSum >= (float)$os['total'] ? 'pago' : ($paidSum > 0 ? 'parcial' : 'pendente');

    $db->prepare("UPDATE service_orders SET payment_status=?,payment_method=?,payment_date=NOW() WHERE id=?")
       ->execute([$pstatus, $method, $os['id']]);

    $db->prepare("INSERT INTO activity_logs (action,entity_type,entity_id,description) VALUES (?,?,?,?)")
       ->execute(["payment_webhook","service_order",$os['id'],"Pagamento de R$ $amount via $method ($status)"]);

    notifyPaymentReceived($os['id'], $os['os_number'], $paidSum, $method, (float)$os['total']);
}
