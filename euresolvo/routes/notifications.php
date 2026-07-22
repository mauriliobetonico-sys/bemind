<?php
// /api/v1/notifications — lista/marca notificações do usuário logado
$user = requireAuth();
$db = getDB();

if ($method === 'GET' && !$id) {
    $q = $db->prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100');
    $q->execute([$user['id']]);
    json_out($q->fetchAll());
}
if ($method === 'POST' && $id === 'read-all') {
    $db->prepare('UPDATE notifications SET read_at=NOW() WHERE user_id=? AND read_at IS NULL')->execute([$user['id']]);
    json_out(['ok' => true]);
}
if ($method === 'POST' && ctype_digit((string)$id) && $sub === 'read') {
    $db->prepare('UPDATE notifications SET read_at=NOW() WHERE id=? AND user_id=?')->execute([(int)$id, $user['id']]);
    json_out(['ok' => true]);
}
bad('Rota não encontrada.', 404);
