<?php
// /api/v1/service-orders — ciclo completo da OS
// listar, criar (draft), publicar (dispara match), aceitar/recusar, timeline, uploads
$user = requireAuth();
$db = getDB();

function loadOrder(int $orderId): array {
    $st = getDB()->prepare(
        "SELECT o.*, c.razao_social, c.nome_fantasia, c.cnpj,
                iu.name AS installer_name, i.rating_avg AS installer_rating, i.level AS installer_level, i.current_lat, i.current_lng
         FROM service_orders o
         LEFT JOIN companies c ON c.id = o.company_id
         LEFT JOIN installers i ON i.id = o.installer_id
         LEFT JOIN users iu     ON iu.id = i.user_id
         WHERE o.id=?"
    );
    $st->execute([$orderId]);
    $row = $st->fetch();
    if (!$row) bad('OS não encontrada.', 404);

    $r = getDB()->prepare('SELECT requirement FROM order_requirements WHERE order_id=?');
    $r->execute([$orderId]);
    $row['requirements'] = array_column($r->fetchAll(), 'requirement');

    $a = getDB()->prepare('SELECT id,kind,file_path,original_name,mime_type,created_at FROM order_attachments WHERE order_id=? ORDER BY id');
    $a->execute([$orderId]);
    $row['attachments'] = $a->fetchAll();

    $c = getDB()->prepare('SELECT id,item,done,done_at,seq FROM order_checklist_items WHERE order_id=? ORDER BY seq,id');
    $c->execute([$orderId]);
    $row['checklist'] = $c->fetchAll();

    return $row;
}

function ensureOrderAccess(array $user, array $order): void {
    if ($user['role'] === 'admin' || $user['role'] === 'operador') return;
    if ($user['role'] === 'empresa' && (int)$order['created_by'] === (int)$user['id']) return;
    // Empresa pode ver OS de sua companhia
    if ($user['role'] === 'empresa') {
        $cid = getDB()->prepare('SELECT id FROM companies WHERE user_id=?');
        $cid->execute([$user['id']]);
        if ((int)$cid->fetchColumn() === (int)$order['company_id']) return;
    }
    if ($user['role'] === 'instalador' && $order['installer_id']) {
        $iid = getDB()->prepare('SELECT id FROM installers WHERE user_id=?');
        $iid->execute([$user['id']]);
        if ((int)$iid->fetchColumn() === (int)$order['installer_id']) return;
    }
    bad('Sem permissão para esta OS.', 403, 'FORBIDDEN');
}

function generateOsNumber(): string {
    return 'ER' . date('Ymd') . strtoupper(bin2hex(random_bytes(2)));
}

// LISTAGEM ─────────────────────────────────────────────
if ($method === 'GET' && !$id) {
    $status = inp('status');
    $where = '1=1'; $vals = [];
    if ($user['role'] === 'empresa') {
        $cid = $db->prepare('SELECT id FROM companies WHERE user_id=?'); $cid->execute([$user['id']]);
        $companyId = (int)$cid->fetchColumn();
        $where .= ' AND o.company_id=?'; $vals[] = $companyId;
    } elseif ($user['role'] === 'instalador') {
        $iid = $db->prepare('SELECT id FROM installers WHERE user_id=?'); $iid->execute([$user['id']]);
        $installerId = (int)$iid->fetchColumn();
        $where .= ' AND o.installer_id=?'; $vals[] = $installerId;
    }
    if ($status) { $where .= ' AND o.status=?'; $vals[] = $status; }
    $limit = min(200, max(10, (int)inp('limit', 50)));
    $sql = "SELECT o.*, c.razao_social, u.name AS installer_name
            FROM service_orders o
            LEFT JOIN companies c ON c.id=o.company_id
            LEFT JOIN installers i ON i.id=o.installer_id
            LEFT JOIN users u ON u.id=i.user_id
            WHERE $where ORDER BY o.created_at DESC LIMIT $limit";
    $st = $db->prepare($sql); $st->execute($vals);
    json_out($st->fetchAll());
}

// GET /orders/:id
if ($method === 'GET' && ctype_digit((string)$id) && !$sub) {
    $order = loadOrder((int)$id);
    ensureOrderAccess($user, $order);
    json_out($order);
}

// POST /orders — cria (draft)
if ($method === 'POST' && !$id) {
    requireRole(['empresa', 'admin', 'operador'], $user);
    $cid = $db->prepare('SELECT id FROM companies WHERE user_id=?'); $cid->execute([$user['id']]);
    $companyId = (int)$cid->fetchColumn();
    if (!$companyId && $user['role'] === 'empresa') bad('Empresa não encontrada.', 404);
    if ($user['role'] !== 'empresa') $companyId = (int) inp('company_id', 0);
    if (!$companyId) bad('company_id obrigatório.');

    $fields = ['category','title','description','scheduled_for','urgency','match_mode',
               'address_street','address_number','address_complement','address_district',
               'address_city','address_state','address_zip','lat','lng',
               'offered_value','payment_method'];
    $vals = [];
    foreach ($fields as $f) $vals[$f] = inp($f);

    if (!$vals['category'] || !$vals['title']) bad('Categoria e título são obrigatórios.');
    if (!$vals['offered_value'] || (float)$vals['offered_value'] <= 0) bad('Valor oferecido inválido.');

    $osNumber = generateOsNumber();
    $sql = "INSERT INTO service_orders (os_number,company_id,branch_id,created_by," . implode(',', $fields) . ",status)
            VALUES (?,?,?,?" . str_repeat(',?', count($fields)) . ",'draft')";
    $params = array_merge([$osNumber, $companyId, inp('branch_id'), $user['id']], array_values($vals));
    $db->prepare($sql)->execute($params);
    $orderId = (int)$db->lastInsertId();

    // Requisitos
    $reqs = inp('requirements', []);
    if (is_array($reqs)) {
        $r = $db->prepare('INSERT IGNORE INTO order_requirements (order_id,requirement) VALUES (?,?)');
        foreach ($reqs as $req) $r->execute([$orderId, substr((string)$req, 0, 60)]);
    }

    // Checklist inicial (padrão)
    $ck = $db->prepare('INSERT INTO order_checklist_items (order_id,item,seq) VALUES (?,?,?)');
    $defaults = ['Fotos antes', 'Check-in no local', 'Execução conforme brief', 'Fotos depois', 'Assinatura do responsável'];
    foreach ($defaults as $i => $step) $ck->execute([$orderId, $step, $i + 1]);

    auditLog($user['id'], 'order.create', 'order', $orderId);
    json_out(['id' => $orderId, 'os_number' => $osNumber], 201);
}

// POST /orders/:id/attachments
if ($method === 'POST' && ctype_digit((string)$id) && $sub === 'attachments') {
    $order = loadOrder((int)$id);
    ensureOrderAccess($user, $order);
    if (empty($_FILES['file'])) bad('Arquivo obrigatório.');
    $kind = (string) inp('kind', 'brief');
    if (!in_array($kind, ['brief','before','after','signature','doc'], true)) $kind = 'brief';
    $saved = saveUploadedFile($_FILES['file'], "orders/{$id}/{$kind}");
    $db->prepare('INSERT INTO order_attachments (order_id,kind,file_path,original_name,mime_type,uploaded_by) VALUES (?,?,?,?,?,?)')
       ->execute([(int)$id, $kind, $saved['file_path'], $saved['original_name'], $saved['mime_type'], $user['id']]);
    json_out(['ok' => true, 'id' => (int)$db->lastInsertId(), 'file' => $saved]);
}

// POST /orders/:id/publish — dispara match
if ($method === 'POST' && ctype_digit((string)$id) && $sub === 'publish') {
    $order = loadOrder((int)$id);
    ensureOrderAccess($user, $order);
    if (!in_array($order['status'], ['draft', 'cancelled'], true)) bad('OS não está em rascunho.');
    if (!$order['lat'] || !$order['lng']) bad('Endereço com coordenadas é obrigatório para publicar.');

    $db->prepare("UPDATE service_orders SET status='published' WHERE id=?")->execute([(int)$id]);

    $candidates = scoreInstallersFor($order);
    $sent = 0;
    if ($order['match_mode'] === 'automatico') {
        // Envia oferta ao melhor
        $sent = sendOffers((int)$id, $candidates, 1);
    } else {
        // Manual — envia para top 5 e a empresa escolhe
        $sent = sendOffers((int)$id, $candidates, 5);
    }
    if ($sent > 0) {
        $db->prepare("UPDATE service_orders SET status='matched' WHERE id=?")->execute([(int)$id]);
    }
    wsBroadcast('order.published', ['order_id' => (int)$id, 'candidates' => count($candidates)]);
    auditLog($user['id'], 'order.publish', 'order', (int)$id, ['candidates' => count($candidates)]);
    json_out(['ok' => true, 'candidates' => $candidates, 'offers_sent' => $sent]);
}

// POST /orders/:id/status  → transições (accept, en_route, checkin, start, complete, cancel)
if ($method === 'POST' && ctype_digit((string)$id) && $sub === 'status') {
    $order = loadOrder((int)$id);
    ensureOrderAccess($user, $order);
    $to = (string) inp('to', '');
    $allowed = ['accepted','en_route','checked_in','in_progress','completed','cancelled'];
    if (!in_array($to, $allowed, true)) bad('Transição inválida.');

    $stamps = [
        'accepted'    => null,
        'en_route'    => 'started_at',
        'checked_in'  => 'checked_in_at',
        'in_progress' => null,
        'completed'   => 'completed_at',
        'cancelled'   => 'cancelled_at',
    ];
    $set = "status=?"; $vals = [$to];
    if ($stamps[$to]) { $set .= ", {$stamps[$to]}=NOW()"; }
    if ($to === 'cancelled') { $set .= ", cancelled_reason=?"; $vals[] = (string)inp('reason', ''); }
    $vals[] = (int)$id;
    $db->prepare("UPDATE service_orders SET $set WHERE id=?")->execute($vals);

    // On completion, dispara release do escrow → paid_out
    if ($to === 'completed') {
        try {
            $result = releaseToInstaller((int)$id);
            wsBroadcast('order.paid_out', ['order_id' => (int)$id, 'net_cents' => $result['net']]);
            if ($order['installer_id']) {
                $iu = $db->prepare('SELECT user_id FROM installers WHERE id=?'); $iu->execute([$order['installer_id']]);
                $installerUserId = (int)$iu->fetchColumn();
                if ($installerUserId) {
                    notifyUser($installerUserId, 'Pagamento liberado', 'R$ ' . number_format($result['net']/100, 2, ',', '.') . ' creditado na sua carteira.', 'dollar-sign', '/portal/instalador#carteira');
                }
            }
        } catch (Throwable $e) {
            error_log('Release escrow failed: ' . $e->getMessage());
        }
    }

    wsBroadcast('order.status', ['order_id' => (int)$id, 'to' => $to]);
    auditLog($user['id'], 'order.status', 'order', (int)$id, ['to' => $to]);
    json_out(['ok' => true, 'status' => $to]);
}

// POST /orders/:id/checklist/:item_id/toggle
if ($method === 'POST' && ctype_digit((string)$id) && $sub === 'checklist' && ctype_digit((string)$sub2)) {
    $order = loadOrder((int)$id);
    ensureOrderAccess($user, $order);
    $db->prepare('UPDATE order_checklist_items SET done = 1 - done, done_at = IF(done=0, NOW(), NULL) WHERE id=? AND order_id=?')
       ->execute([(int)$sub2, (int)$id]);
    json_out(['ok' => true]);
}

bad('Rota não encontrada.', 404);
