<?php
// /api/v1/ratings — avaliações bidirecionais após OS concluída
$user = requireAuth();
$db = getDB();

if ($method === 'POST' && !$id) {
    $orderId = (int) inp('order_id', 0);
    $targetUserId = (int) inp('target_user_id', 0);
    $stars = (int) inp('stars', 0);
    $comment = (string) inp('comment', '');
    if ($stars < 1 || $stars > 5) bad('Estrelas 1-5.');
    if (!$orderId || !$targetUserId) bad('order_id e target_user_id obrigatórios.');

    $so = $db->prepare('SELECT o.*, i.user_id AS iu, c.user_id AS cu FROM service_orders o LEFT JOIN installers i ON i.id=o.installer_id LEFT JOIN companies c ON c.id=o.company_id WHERE o.id=?');
    $so->execute([$orderId]);
    $ord = $so->fetch();
    if (!$ord) bad('OS não encontrada.', 404);
    if (!in_array($ord['status'], ['completed','paid_out'], true)) bad('OS ainda não concluída.');

    $isParticipant = (int)$user['id'] === (int)$ord['iu'] || (int)$user['id'] === (int)$ord['cu'];
    if (!$isParticipant) bad('Sem permissão.', 403);

    // Descobre role do alvo
    $tRole = $targetUserId === (int)$ord['iu'] ? 'instalador' : 'empresa';

    $db->prepare("INSERT INTO ratings (order_id,rater_id,target_id,target_role,stars,comment)
                  VALUES (?,?,?,?,?,?)
                  ON DUPLICATE KEY UPDATE stars=VALUES(stars), comment=VALUES(comment)")
       ->execute([$orderId, $user['id'], $targetUserId, $tRole, $stars, $comment]);

    // Recalcula média do instalador (quando alvo é instalador)
    if ($tRole === 'instalador') {
        $avg = $db->prepare("SELECT AVG(stars) AS avg_stars, COUNT(*) AS cnt FROM ratings WHERE target_id=? AND target_role='instalador'");
        $avg->execute([$targetUserId]);
        $r = $avg->fetch();
        $db->prepare("UPDATE installers SET rating_avg=?, rating_count=? WHERE user_id=?")
           ->execute([round((float)$r['avg_stars'], 2), (int)$r['cnt'], $targetUserId]);
    }
    auditLog($user['id'], 'rating.create', 'order', $orderId, ['stars' => $stars, 'target' => $targetUserId]);
    json_out(['ok' => true]);
}

if ($method === 'GET' && $id === 'user' && ctype_digit((string)$sub)) {
    $q = $db->prepare('SELECT r.*, o.os_number, u.name AS rater_name FROM ratings r LEFT JOIN service_orders o ON o.id=r.order_id JOIN users u ON u.id=r.rater_id WHERE r.target_id=? ORDER BY r.created_at DESC LIMIT 100');
    $q->execute([(int)$sub]);
    json_out($q->fetchAll());
}

bad('Rota não encontrada.', 404);
