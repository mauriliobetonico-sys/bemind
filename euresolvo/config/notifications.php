<?php
// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — Notificações (WebSocket broadcast, n8n webhooks, in-app, e-mail)
// ══════════════════════════════════════════════════════════════════════════

function wsBroadcast(string $event, array $data, array $roles = []): void {
    if (!WS_HTTP) return;
    $payload = json_encode([
        'event'  => $event,
        'data'   => $data,
        'secret' => WS_SECRET,
        'roles'  => $roles,
    ]);
    $ch = curl_init(rtrim(WS_HTTP, '/') . '/broadcast');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 2,
        CURLOPT_CONNECTTIMEOUT => 1,
    ]);
    @curl_exec($ch);
    curl_close($ch);
}

function n8nTrigger(string $workflowPath, array $data): void {
    if (!N8N_WEBHOOK_BASE) return;
    $url = rtrim(N8N_WEBHOOK_BASE, '/') . '/' . ltrim($workflowPath, '/');
    $ch  = curl_init($url);
    $headers = ['Content-Type: application/json'];
    if (N8N_API_KEY) $headers[] = 'X-N8N-API-KEY: ' . N8N_API_KEY;
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($data, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 4,
        CURLOPT_CONNECTTIMEOUT => 2,
    ]);
    @curl_exec($ch);
    curl_close($ch);
}

function notifyUser(int $userId, string $title, string $body = '', string $icon = 'bell', string $deepLink = ''): void {
    try {
        getDB()->prepare("INSERT INTO notifications (user_id,title,body,icon,deep_link) VALUES (?,?,?,?,?)")
            ->execute([$userId, $title, $body, $icon, $deepLink]);
        wsBroadcast('notification', [
            'user_id' => $userId,
            'title'   => $title,
            'body'    => $body,
            'icon'    => $icon,
            'link'    => $deepLink,
        ]);
    } catch (Throwable) {}
}

function sendEmail(string $to, string $subject, string $html): bool {
    if (!SMTP_HOST || !SMTP_USER) return false;
    $headers = [
        'From: ' . SMTP_FROM_NAME . ' <' . SMTP_FROM_ADDR . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'X-Mailer: EU RESOLVO/' . APP_VERSION,
    ];
    return @mail($to, $subject, $html, implode("\r\n", $headers));
}
