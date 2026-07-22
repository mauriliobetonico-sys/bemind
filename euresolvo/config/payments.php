<?php
// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — Pagamentos (Mercado Pago primary; Stripe placeholder)
// Escrow: usamos "captured amount" na wallet da plataforma e liberamos no
// completion trigger (releaseToInstaller). Payout por PIX via /v1/payments.
// ══════════════════════════════════════════════════════════════════════════

function mpRequest(string $method, string $path, array $body = []): array {
    if (!MP_ACCESS_TOKEN) throw new RuntimeException('MP_ACCESS_TOKEN não configurado.');
    $url = 'https://api.mercadopago.com' . $path;
    $ch  = curl_init($url);
    $headers = [
        'Authorization: Bearer ' . MP_ACCESS_TOKEN,
        'Content-Type: application/json',
        'X-Idempotency-Key: ' . bin2hex(random_bytes(16)),
    ];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_POSTFIELDS     => $body ? json_encode($body, JSON_UNESCAPED_UNICODE) : null,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $out  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    $data = json_decode($out ?: '[]', true) ?: [];
    if ($code >= 400) {
        throw new RuntimeException("Mercado Pago erro $code: " . ($data['message'] ?? substr($out ?? '', 0, 200)));
    }
    return $data;
}

/** Cria cobrança PIX (retorna QR code + código copia-e-cola). */
function mpCreatePixCharge(array $order, array $payer): array {
    $body = [
        'transaction_amount' => (float)$order['offered_value'],
        'description'        => 'OS ' . $order['os_number'] . ' — ' . ($order['title'] ?? ''),
        'payment_method_id'  => 'pix',
        'external_reference' => 'ER-' . $order['id'],
        'notification_url'   => APP_URL . '/api/webhook/mercadopago',
        'payer' => [
            'email'      => $payer['email'],
            'first_name' => $payer['first_name'] ?? '',
            'last_name'  => $payer['last_name'] ?? '',
            'identification' => [
                'type'   => $payer['doc_type'] ?? 'CPF',
                'number' => preg_replace('/\D/', '', $payer['doc'] ?? ''),
            ],
        ],
    ];
    return mpRequest('POST', '/v1/payments', $body);
}

/** Cria cobrança em cartão (checkout Preference). */
function mpCreateCardPreference(array $order, array $payer): array {
    $body = [
        'items' => [[
            'title'       => 'OS ' . $order['os_number'],
            'quantity'    => 1,
            'unit_price'  => (float)$order['offered_value'],
            'currency_id' => 'BRL',
        ]],
        'payer' => ['email' => $payer['email']],
        'external_reference' => 'ER-' . $order['id'],
        'notification_url'   => APP_URL . '/api/webhook/mercadopago',
        'back_urls' => [
            'success' => APP_URL . '/portal/pagamento/sucesso',
            'failure' => APP_URL . '/portal/pagamento/falha',
            'pending' => APP_URL . '/portal/pagamento/pendente',
        ],
        'auto_return' => 'approved',
    ];
    return mpRequest('POST', '/checkout/preferences', $body);
}

/** Consulta um pagamento por id. */
function mpGetPayment(string $paymentId): array {
    return mpRequest('GET', '/v1/payments/' . urlencode($paymentId));
}

/** Payout PIX ao instalador (transferência bancária via MP Money Out). */
function mpPayoutPix(array $installer, int $amountCents): array {
    $body = [
        'amount' => $amountCents / 100.0,
        'currency_id' => 'BRL',
        'payment_method_id' => 'pix',
        'pix_key' => $installer['pix_key'],
        'external_reference' => 'PAYOUT-' . ($installer['id'] ?? '') . '-' . time(),
    ];
    // NOTA: endpoint de saída exige merchant habilitado como marketplace.
    return mpRequest('POST', '/v1/transfers', $body);
}

/** Verifica assinatura do webhook do Mercado Pago (x-signature). */
function mpVerifyWebhook(string $requestId, string $dataId, string $signatureHeader): bool {
    if (!MP_WEBHOOK_SECRET) return true; // dev: sem verificação
    if (!$signatureHeader) return false;
    $ts = null; $sig = null;
    foreach (explode(',', $signatureHeader) as $part) {
        [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($k === 'ts') $ts = $v;
        if ($k === 'v1') $sig = $v;
    }
    if (!$ts || !$sig) return false;
    $manifest = "id:$dataId;request-id:$requestId;ts:$ts;";
    $expected = hash_hmac('sha256', $manifest, MP_WEBHOOK_SECRET);
    return hash_equals($expected, $sig);
}
