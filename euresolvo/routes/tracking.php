<?php
// /api/v1/tracking — pings de localização + histórico
$user = requireAuth();
$db = getDB();

// POST /tracking/ping — instalador envia sua localização
if ($method === 'POST' && $id === 'ping') {
    requireRole(['instalador'], $user);
    $lat = (float) inp('lat', 0);
    $lng = (float) inp('lng', 0);
    if ($lat === 0.0 || $lng === 0.0) bad('lat/lng obrigatórios.');
    $orderId = inp('order_id');
    $accuracy = inp('accuracy_m');
    $speed    = inp('speed_kmh');
    $heading  = inp('heading_deg');

    $iid = $db->prepare('SELECT id FROM installers WHERE user_id=?'); $iid->execute([$user['id']]);
    $installerId = (int)$iid->fetchColumn();

    $db->prepare('INSERT INTO location_pings (order_id,installer_id,lat,lng,accuracy_m,speed_kmh,heading_deg) VALUES (?,?,?,?,?,?,?)')
       ->execute([$orderId, $installerId, $lat, $lng, $accuracy, $speed, $heading]);
    $db->prepare('UPDATE installers SET current_lat=?, current_lng=?, last_ping_at=NOW(), online=1 WHERE id=?')
       ->execute([$lat, $lng, $installerId]);

    wsBroadcast('location.ping', [
        'installer_id' => $installerId,
        'order_id'     => $orderId,
        'lat'          => $lat,
        'lng'          => $lng,
        'at'           => date('c'),
    ], ['empresa','admin','operador']);
    json_out(['ok' => true]);
}

// GET /tracking/order/:id — últimos pontos daquela OS (para replay)
if ($method === 'GET' && $id === 'order' && ctype_digit((string)$sub)) {
    $orderId = (int)$sub;
    // Verifica acesso
    $so = $db->prepare('SELECT o.*, i.user_id AS iu, c.user_id AS cu FROM service_orders o LEFT JOIN installers i ON i.id=o.installer_id LEFT JOIN companies c ON c.id=o.company_id WHERE o.id=?');
    $so->execute([$orderId]);
    $ord = $so->fetch();
    if (!$ord) bad('OS não encontrada.', 404);
    $ok = in_array($user['role'], ['admin','operador'], true)
       || (int)$user['id'] === (int)$ord['iu']
       || (int)$user['id'] === (int)$ord['cu'];
    if (!$ok) bad('Sem permissão.', 403);
    $q = $db->prepare('SELECT lat,lng,accuracy_m,speed_kmh,heading_deg,created_at FROM location_pings WHERE order_id=? ORDER BY id DESC LIMIT 500');
    $q->execute([$orderId]);
    json_out(array_reverse($q->fetchAll()));
}

// GET /tracking/live — mapa admin com todos os instaladores online
if ($method === 'GET' && $id === 'live') {
    requireRole(['admin', 'operador'], $user);
    $q = $db->query(
        "SELECT i.id, u.name, i.current_lat AS lat, i.current_lng AS lng, i.level, i.last_ping_at
         FROM installers i JOIN users u ON u.id=i.user_id
         WHERE i.online=1 AND i.last_ping_at > (NOW() - INTERVAL 5 MINUTE)"
    );
    json_out($q->fetchAll());
}

bad('Rota não encontrada.', 404);
