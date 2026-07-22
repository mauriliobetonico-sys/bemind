<?php
// /api/v1/chat/:orderId  → GET (histórico), POST (envia)
$user = requireAuth();
$db = getDB();

$orderId = (int) ($id ?? 0);
if (!$orderId) bad('order_id obrigatório.');

$st = $db->prepare(
    "SELECT o.id, o.company_id, o.installer_id, i.user_id AS installer_user_id, c.user_id AS company_user_id
     FROM service_orders o
     LEFT JOIN installers i ON i.id = o.installer_id
     LEFT JOIN companies c  ON c.id = o.company_id
     WHERE o.id=?"
);
$st->execute([$orderId]);
$order = $st->fetch();
if (!$order) bad('OS não encontrada.', 404);

$isParticipant = in_array($user['role'], ['admin','operador'], true)
    || (int)$user['id'] === (int)$order['company_user_id']
    || (int)$user['id'] === (int)$order['installer_user_id'];
if (!$isParticipant) bad('Sem permissão.', 403);

if ($method === 'GET') {
    $q = $db->prepare(
        "SELECT m.id, m.sender_id, u.name AS sender_name, u.role AS sender_role,
                m.body, m.file_path, m.read_at, m.created_at
         FROM chat_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.order_id=? ORDER BY m.id ASC LIMIT 500"
    );
    $q->execute([$orderId]);
    json_out($q->fetchAll());
}

if ($method === 'POST') {
    $body = trim((string) inp('body', ''));
    $filePath = null;
    if (!empty($_FILES['file'])) {
        $saved = saveUploadedFile($_FILES['file'], "chat/$orderId");
        $filePath = $saved['file_path'];
    }
    if (!$body && !$filePath) bad('Mensagem vazia.');
    $db->prepare('INSERT INTO chat_messages (order_id,sender_id,body,file_path) VALUES (?,?,?,?)')
       ->execute([$orderId, $user['id'], $body, $filePath]);
    $msgId = (int)$db->lastInsertId();
    wsBroadcast('chat.message', [
        'order_id'  => $orderId,
        'id'        => $msgId,
        'sender_id' => $user['id'],
        'sender_name' => $user['name'],
        'sender_role' => $user['role'],
        'body'      => $body,
        'file_path' => $filePath,
        'at'        => date('c'),
    ]);
    json_out(['ok' => true, 'id' => $msgId]);
}

bad('Método não permitido.', 405);
