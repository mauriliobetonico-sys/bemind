<?php
// ══════════════════════════════════════════════════════════════════════════
// VISÃOOS — Sistema de Notificações (n8n + Email + WebSocket)
// ══════════════════════════════════════════════════════════════════════════

// ── Dispara evento no n8n via webhook ─────────────────────────────────────
function triggerN8n(string $event, array $data): bool {
    if (!N8N_WEBHOOK_BASE) return false;

    $url     = N8N_WEBHOOK_BASE . '/' . $event;
    $payload = json_encode(array_merge($data, [
        'event'      => $event,
        'app_url'    => APP_URL,
        'triggered_at' => date('c'),
    ]));

    $headers = ['Content-Type: application/json'];
    if (N8N_API_KEY) $headers[] = 'X-N8N-API-KEY: ' . N8N_API_KEY;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $result = curl_exec($ch);
    $code   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return $code >= 200 && $code < 300;
}

// ── Notifica mudança de status de OS ─────────────────────────────────────
function notifyOsStatusChanged(array $os, string $newStatus, array $user): void {
    $statusLabels = [
        'aguardando'  => 'Aguardando',
        'producao'    => 'Em Produção',
        'finalizado'  => 'Finalizado',
        'entregue'    => 'Entregue',
    ];

    $payload = [
        'os_id'          => $os['id'],
        'os_number'      => $os['os_number'],
        'status'         => $newStatus,
        'status_label'   => $statusLabels[$newStatus] ?? $newStatus,
        'client_name'    => $os['client_name'] ?? '',
        'client_email'   => $os['client_email'] ?? '',
        'client_whatsapp'=> $os['client_whatsapp'] ?? '',
        'tracking_url'   => APP_URL . '/rastreio/' . ($os['tracking_token'] ?? ''),
        'changed_by'     => $user['name'],
        'due_date'       => $os['due_date'] ?? '',
    ];

    triggerN8n('os-status', $payload);
    notifyWebSocket('os.status_changed', $payload);
}

// ── Notifica criação de OS ────────────────────────────────────────────────
function notifyOsCreated(int $osId, string $osNumber, string $trackingToken, array $client): void {
    $payload = [
        'os_id'          => $osId,
        'os_number'      => $osNumber,
        'client_name'    => $client['name'] ?? '',
        'client_email'   => $client['email'] ?? '',
        'client_whatsapp'=> $client['phone_whatsapp'] ?? '',
        'tracking_url'   => APP_URL . '/rastreio/' . $trackingToken,
    ];

    triggerN8n('os-created', $payload);
    notifyWebSocket('os.created', $payload);
}

// ── Notifica pagamento registrado ─────────────────────────────────────────
function notifyPaymentReceived(int $osId, string $osNumber, float $amount, string $method, float $total): void {
    $payload = [
        'os_id'      => $osId,
        'os_number'  => $osNumber,
        'amount'     => $amount,
        'method'     => $method,
        'total'      => $total,
        'percentage' => $total > 0 ? round(($amount / $total) * 100, 1) : 0,
    ];

    triggerN8n('payment-received', $payload);
    notifyWebSocket('payment.received', $payload);
}

// ── Notifica orçamento criado (para follow-up) ───────────────────────────
function notifyQuoteCreated(int $quoteId, string $quoteNumber, array $client, float $total, ?string $validUntil): void {
    $payload = [
        'quote_id'       => $quoteId,
        'quote_number'   => $quoteNumber,
        'client_name'    => $client['name'] ?? '',
        'client_email'   => $client['email'] ?? '',
        'client_whatsapp'=> $client['phone_whatsapp'] ?? '',
        'total'          => $total,
        'valid_until'    => $validUntil ?? '',
    ];

    triggerN8n('quote-created', $payload);
}

// ── Envia evento para o servidor WebSocket ────────────────────────────────
function notifyWebSocket(string $event, array $data): void {
    $wsPort = getenv('WS_PORT') ?: 6001;
    $wsUrl  = "http://localhost:{$wsPort}/broadcast";

    $payload = json_encode([
        'event'   => $event,
        'data'    => $data,
        'secret'  => WS_SECRET,
    ]);

    $ch = curl_init($wsUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 2,
        CURLOPT_CONNECTTIMEOUT => 1,
    ]);
    curl_exec($ch);
    curl_close($ch);
}

// ── Envia e-mail via SMTP (usando sockets nativos do PHP) ─────────────────
function sendMail(string $to, string $subject, string $htmlBody): bool {
    $smtpHost = getenv('SMTP_HOST') ?: '';
    if (!$smtpHost) return false;

    $smtpPort = (int)(getenv('SMTP_PORT') ?: 587);
    $smtpUser = getenv('SMTP_USER') ?: '';
    $smtpPass = getenv('SMTP_PASS') ?: '';
    $fromName = getenv('SMTP_FROM_NAME') ?: 'VisãoOS';
    $fromEmail= $smtpUser;

    try {
        $boundary = md5(uniqid());
        $headers  = implode("\r\n", [
            "From: {$fromName} <{$fromEmail}>",
            "To: {$to}",
            "Subject: =?UTF-8?B?" . base64_encode($subject) . "?=",
            "MIME-Version: 1.0",
            "Content-Type: multipart/alternative; boundary=\"{$boundary}\"",
        ]);

        $body  = "--{$boundary}\r\n";
        $body .= "Content-Type: text/html; charset=UTF-8\r\n\r\n";
        $body .= $htmlBody . "\r\n";
        $body .= "--{$boundary}--";

        // usa mail() nativo como fallback simples
        return mail($to, $subject, $body, $headers);
    } catch (Throwable) {
        return false;
    }
}
