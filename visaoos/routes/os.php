<?php
// ── OS ROUTES ─────────────────────────────────────────────────────────────
$user = requireAuth();

function nextOsNumber(PDO $db): string {
    $stmt = $db->query("SELECT MAX(CAST(SUBSTRING(os_number,4) AS UNSIGNED)) AS n FROM service_orders");
    $n    = (int)($stmt->fetchColumn() ?? 0) + 1;
    return 'OS-' . str_pad($n, 5, '0', STR_PAD_LEFT);
}

// ── GET /api/os ───────────────────────────────────────────────────────────
if ($method === 'GET' && !$id) {
    $db     = getDB();
    $where  = ['so.deleted_at IS NULL'];
    $params = [];
    if ($s = inp('status'))    { $where[] = 'so.status=?';    $params[] = $s; }
    if ($c = inp('client_id')) { $where[] = 'so.client_id=?'; $params[] = $c; }
    if ($ps = inp('payment_status')) { $where[] = 'so.payment_status=?'; $params[] = $ps; }
    if ($q = inp('search')) {
        $where[]  = '(so.os_number LIKE ? OR so.description LIKE ? OR c.name LIKE ?)';
        $params   = array_merge($params, ["%$q%","%$q%","%$q%"]);
    }
    $limit  = min((int)(inp('limit', 50)), 100);
    $page   = max((int)(inp('page', 1)), 1);
    $offset = ($page - 1) * $limit;
    $w      = implode(' AND ', $where);

    $valueCol = $user['role'] === 'producao' ? '0 AS total, 0 AS subtotal' : 'so.total, so.subtotal';
    $sql = "SELECT so.id, so.os_number, so.description, so.status, so.client_type,
                   so.payment_status, $valueCol, so.due_date, so.tracking_token, so.created_at,
                   c.name AS client_name, ua.name AS attendant_name, up.name AS production_name
            FROM service_orders so
            JOIN clients c ON so.client_id=c.id
            LEFT JOIN users ua ON so.attendant_id=ua.id
            LEFT JOIN users up ON so.production_id=up.id
            WHERE $w ORDER BY so.created_at DESC LIMIT $limit OFFSET $offset";

    $count_sql = "SELECT COUNT(*) FROM service_orders so JOIN clients c ON so.client_id=c.id WHERE $w";
    $total_rows = (int)$db->prepare($count_sql)->execute($params) ? $db->prepare($count_sql) : null;

    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $countStmt = $db->prepare($count_sql);
    $countStmt->execute($params);
    $totalRows = (int)$countStmt->fetchColumn();

    json_out([
        'data'       => $stmt->fetchAll(),
        'total'      => $totalRows,
        'page'       => $page,
        'limit'      => $limit,
        'pages'      => ceil($totalRows / $limit),
    ]);
}

// ── GET /api/os/:id ───────────────────────────────────────────────────────
if ($method === 'GET' && $id && !$sub) {
    $db   = getDB();
    $stmt = $db->prepare(
        "SELECT so.*, c.name AS client_name, c.cpf_cnpj, c.phone_main, c.phone_whatsapp, c.email AS client_email,
                ua.name AS attendant_name, up.name AS production_name
         FROM service_orders so
         JOIN clients c ON so.client_id=c.id
         LEFT JOIN users ua ON so.attendant_id=ua.id
         LEFT JOIN users up ON so.production_id=up.id
         WHERE so.id=?"
    );
    $stmt->execute([$id]);
    $os = $stmt->fetch();
    if (!$os) json_out(['error'=>'OS não encontrada.'], 404);

    if ($user['role'] === 'producao') { unset($os['total'], $os['subtotal'], $os['discount_val']); }

    $items = $db->prepare('SELECT * FROM os_items WHERE os_id=?');
    $items->execute([$id]); $os['items'] = $items->fetchAll();

    $files = $db->prepare('SELECT id,filename,original_name,file_size,mime_type,nextcloud_path,created_at FROM os_files WHERE os_id=?');
    $files->execute([$id]); $os['files'] = $files->fetchAll();

    $hist = $db->prepare('SELECT sh.*,u.name AS changed_by_name FROM os_status_history sh LEFT JOIN users u ON sh.changed_by=u.id WHERE sh.os_id=? ORDER BY sh.created_at ASC');
    $hist->execute([$id]); $os['history'] = $hist->fetchAll();

    $payments = $db->prepare('SELECT * FROM payments WHERE os_id=? ORDER BY paid_at DESC');
    $payments->execute([$id]); $os['payments'] = $payments->fetchAll();

    json_out($os);
}

// ── POST /api/os ──────────────────────────────────────────────────────────
if ($method === 'POST' && !$id) {
    requireRole(['admin','atendimento'], $user);
    $db          = getDB();
    $client_id   = (int)inp('client_id', 0);
    $description = trim(inp('description', ''));
    if (!$client_id || !$description) json_out(['error'=>'Cliente e descrição são obrigatórios.'], 400);

    $cli = $db->prepare('SELECT id,name,type,email,phone_whatsapp FROM clients WHERE id=? AND active=1');
    $cli->execute([$client_id]); $client = $cli->fetch();
    if (!$client) json_out(['error'=>'Cliente não encontrado.'], 404);
    $isReseller = $client['type'] === 'revendedor';

    $w    = (float)inp('width_m', 0);
    $h    = (float)inp('height_m', 0);
    $qty  = max((float)inp('quantity', 1), 0.001);
    $disc = max(0, min(100, (float)inp('discount_pct', 0)));
    $area = $w * $h;

    $items      = inp('items', []);
    $unitPrice  = 0.0;
    $osItems    = [];

    if (is_array($items) && count($items) > 0) {
        foreach ($items as $item) {
            $type   = $item['type'] ?? '';
            $itemId = (int)($item['item_id'] ?? 0);
            $iQty   = max((float)($item['quantity'] ?? 1), 0.001);
            $iPrice = 0.0;
            $iName  = $item['name'] ?? '';
            $iUnit  = $item['unit'] ?? 'un';

            if ($type === 'material' && $itemId) {
                $m = $db->prepare('SELECT name,unit,price_client,price_reseller FROM materials WHERE id=?');
                $m->execute([$itemId]); $mat = $m->fetch();
                if ($mat) { $iPrice = $isReseller ? $mat['price_reseller'] : $mat['price_client']; $iName = $mat['name']; $iUnit = $mat['unit']; }
            } elseif ($type === 'service' && $itemId) {
                $s = $db->prepare('SELECT name,unit,price_client,price_reseller FROM services WHERE id=?');
                $s->execute([$itemId]); $svc = $s->fetch();
                if ($svc) { $iPrice = $isReseller ? $svc['price_reseller'] : $svc['price_client']; $iName = $svc['name']; $iUnit = $svc['unit']; }
            } else {
                $iPrice = (float)($item['unit_price'] ?? 0);
            }

            $iTotal = $iQty * $iPrice * ($area ?: 1);
            $unitPrice += $iTotal;
            $osItems[] = ['type'=>$type,'item_id'=>$itemId ?: null,'name'=>$iName,'unit'=>$iUnit,'quantity'=>$iQty,'unit_price'=>$iPrice,'total_price'=>$iTotal];
        }
    } elseif ($matId = (int)inp('material_id', 0)) {
        $m = $db->prepare('SELECT price_client,price_reseller FROM materials WHERE id=?');
        $m->execute([$matId]); $mat = $m->fetch();
        if ($mat) $unitPrice += $isReseller ? $mat['price_reseller'] : $mat['price_client'];
    }

    $subtotal = $unitPrice ?: ((float)inp('subtotal', 0));
    $discVal  = $subtotal * ($disc / 100);
    $total    = $subtotal - $discVal;
    $osNum    = nextOsNumber($db);
    $token    = bin2hex(random_bytes(32));

    $stmt = $db->prepare(
        "INSERT INTO service_orders
         (os_number,client_id,attendant_id,production_id,client_type,description,notes,technical_notes,
          width_m,height_m,area_m2,quantity,subtotal,discount_pct,discount_val,total,due_date,tracking_token)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    $stmt->execute([
        $osNum, $client_id,
        (int)inp('attendant_id', $user['id']),
        (int)inp('production_id', 0) ?: null,
        $client['type'], $description,
        inp('notes'), inp('technical_notes'),
        $w ?: null, $h ?: null, $area ?: null, $qty,
        $subtotal, $disc, $discVal, $total,
        inp('due_date') ?: null, $token
    ]);
    $osId = $db->lastInsertId();

    // Insere itens
    $si = $db->prepare('INSERT INTO os_items (os_id,type,item_id,name,unit,quantity,unit_price,total_price) VALUES (?,?,?,?,?,?,?,?)');
    foreach ($osItems as $oi) $si->execute([$osId, $oi['type'], $oi['item_id'], $oi['name'], $oi['unit'], $oi['quantity'], $oi['unit_price'], $oi['total_price']]);

    $db->prepare('INSERT INTO os_status_history (os_id,to_status,changed_by,notes) VALUES (?,?,?,?)')
       ->execute([$osId, 'aguardando', $user['id'], 'OS criada']);

    $db->prepare('INSERT INTO activity_logs (user_id,action,entity_type,entity_id,description,ip_address) VALUES (?,?,?,?,?,?)')
       ->execute([$user['id'],'create_os','service_order',$osId,"OS $osNum criada",$_SERVER['REMOTE_ADDR']??'']);

    // Dispara notificação n8n + WebSocket
    notifyOsCreated($osId, $osNum, $token, $client);

    json_out([
        'id'           => $osId,
        'os_number'    => $osNum,
        'tracking_url' => APP_URL . '/rastreio/' . $token,
        'total'        => $total,
    ], 201);
}

// ── PUT /api/os/:id (edição completa) ─────────────────────────────────────
if ($method === 'PUT' && $id && !$sub) {
    requireRole(['admin','atendimento'], $user);
    $db     = getDB();
    $fields = ['description','notes','technical_notes','due_date','attendant_id','production_id'];
    $sets = []; $vals = [];
    foreach ($fields as $f) {
        $v = inp($f, null);
        if ($v !== null) { $sets[] = "$f=?"; $vals[] = $v; }
    }
    if (!$sets) json_out(['error'=>'Nenhum campo informado.'], 400);
    $vals[] = $id;
    $db->prepare('UPDATE service_orders SET ' . implode(',', $sets) . ' WHERE id=?')->execute($vals);
    json_out(['message' => 'OS atualizada.']);
}

// ── PUT /api/os/:id/status ────────────────────────────────────────────────
if ($method === 'PUT' && $id && $sub === 'status') {
    requireRole(['admin','atendimento','producao'], $user);
    $status = inp('status', '');
    if (!in_array($status, ['aguardando','producao','finalizado','entregue'])) {
        json_out(['error'=>'Status inválido.'], 400);
    }
    $db  = getDB();
    $cur = $db->prepare(
        "SELECT so.status, c.name AS client_name, c.email AS client_email, c.phone_whatsapp,
                so.tracking_token, so.due_date, so.os_number
         FROM service_orders so JOIN clients c ON so.client_id=c.id WHERE so.id=?"
    );
    $cur->execute([$id]); $row = $cur->fetch();
    if (!$row) json_out(['error'=>'OS não encontrada.'], 404);

    $db->prepare('UPDATE service_orders SET status=? WHERE id=?')->execute([$status, $id]);
    $db->prepare('INSERT INTO os_status_history (os_id,from_status,to_status,notes,changed_by) VALUES (?,?,?,?,?)')
       ->execute([$id, $row['status'], $status, inp('notes'), $user['id']]);

    // Notificações
    notifyOsStatusChanged(array_merge($row, ['id' => $id]), $status, $user);

    json_out(['message' => "Status atualizado: $status", 'status' => $status]);
}

// ── POST /api/os/:id/files — Upload (local ou Nextcloud) ──────────────────
if ($method === 'POST' && $id && $sub === 'files') {
    if (empty($_FILES)) json_out(['error'=>'Nenhum arquivo enviado.'], 400);

    $db = getDB();
    $os = $db->prepare('SELECT id FROM service_orders WHERE id=?');
    $os->execute([$id]); if (!$os->fetch()) json_out(['error'=>'OS não encontrada.'], 404);

    $uploaded = [];
    foreach ($_FILES as $file) {
        if ($file['error'] !== UPLOAD_ERR_OK) continue;
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, ALLOWED_EXTS)) continue;
        if ($file['size'] > UPLOAD_MAX_MB * 1024 * 1024) continue;

        $filename = time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
        $stored   = storeFile($file['tmp_name'], $filename, $id);

        $db->prepare('INSERT INTO os_files (os_id,filename,original_name,file_path,nextcloud_path,file_size,mime_type,uploaded_by) VALUES (?,?,?,?,?,?,?,?)')
           ->execute([$id, $filename, $file['name'], $stored['file_path'], $stored['nextcloud_path'], $file['size'], $file['type'], $user['id']]);

        $uploaded[] = ['name' => $file['name'], 'size' => $file['size'], 'storage' => $stored['storage']];
    }
    json_out(['uploaded' => count($uploaded), 'files' => $uploaded]);
}

// ── GET /api/os/:id/files/:fid/download ───────────────────────────────────
if ($method === 'GET' && $id && $sub === 'files' && isset($parts[3]) && $parts[3] === 'download') {
    $fid  = $parts[2] ?? null;
    if (!$fid) json_out(['error'=>'ID do arquivo não informado.'], 400);
    $db   = getDB();
    $stmt = $db->prepare('SELECT * FROM os_files WHERE id=? AND os_id=?');
    $stmt->execute([$fid, $id]); $file = $stmt->fetch();
    if (!$file) json_out(['error'=>'Arquivo não encontrado.'], 404);

    if ($file['nextcloud_path']) {
        streamNextcloudFile($file['nextcloud_path'], $file['original_name'] ?? $file['filename'], $file['mime_type'] ?? '');
    } else {
        $path = $file['file_path'];
        if (!file_exists($path)) json_out(['error'=>'Arquivo não encontrado no disco.'], 404);
        header('Content-Type: ' . ($file['mime_type'] ?: 'application/octet-stream'));
        header('Content-Disposition: attachment; filename="' . addslashes($file['original_name'] ?? $file['filename']) . '"');
        readfile($path); exit;
    }
}

// ── POST /api/os/:id/payment ──────────────────────────────────────────────
if ($method === 'POST' && $id && $sub === 'payment') {
    requireRole(['admin','financeiro'], $user);
    $amount     = (float)inp('amount', 0);
    $method_pay = inp('method', '');
    if (!$amount || !$method_pay) json_out(['error'=>'Valor e método são obrigatórios.'], 400);

    $db = getDB();
    $db->prepare('INSERT INTO payments (os_id,amount,method,reference,notes,registered_by,paid_at) VALUES (?,?,?,?,?,?,?)')
       ->execute([$id, $amount, $method_pay, inp('reference'), inp('notes'), $user['id'], inp('paid_at') ?: date('Y-m-d H:i:s')]);

    $total = $db->prepare('SELECT total,os_number FROM service_orders WHERE id=?');
    $total->execute([$id]); $os = $total->fetch();
    $paid  = $db->prepare('SELECT SUM(amount) AS p FROM payments WHERE os_id=?');
    $paid->execute([$id]); $paidSum = (float)$paid->fetchColumn();
    $pstatus = $paidSum >= (float)$os['total'] ? 'pago' : ($paidSum > 0 ? 'parcial' : 'pendente');

    $db->prepare('UPDATE service_orders SET payment_status=?,payment_method=?,payment_date=? WHERE id=?')
       ->execute([$pstatus, $method_pay, date('Y-m-d'), $id]);

    notifyPaymentReceived($id, $os['os_number'], $paidSum, $method_pay, (float)$os['total']);

    json_out(['message'=>'Pagamento registrado.', 'payment_status'=>$pstatus, 'total_paid'=>$paidSum]);
}

// ── GET /api/os/:id/pdf ───────────────────────────────────────────────────
if ($method === 'GET' && $id && $sub === 'pdf') {
    requireRole(['admin','atendimento','financeiro'], $user);
    $db   = getDB();
    $stmt = $db->prepare(
        "SELECT so.*,c.name AS client_name,c.cpf_cnpj,c.phone_main,
                ua.name AS att_name, up.name AS prod_name
         FROM service_orders so JOIN clients c ON so.client_id=c.id
         LEFT JOIN users ua ON so.attendant_id=ua.id
         LEFT JOIN users up ON so.production_id=up.id WHERE so.id=?"
    );
    $stmt->execute([$id]); $os = $stmt->fetch();
    if (!$os) json_out(['error'=>'OS não encontrada.'], 404);

    $items = $db->prepare('SELECT * FROM os_items WHERE os_id=?');
    $items->execute([$id]); $osItems = $items->fetchAll();

    header('Content-Type: text/html; charset=utf-8');
    header('Content-Disposition: inline; filename="OS-' . $os['os_number'] . '.html"');
    $now  = date('d/m/Y H:i');
    $due  = $os['due_date'] ? date('d/m/Y', strtotime($os['due_date'])) : '—';
    $statusLabel = ['aguardando'=>'Aguardando','producao'=>'Em Produção','finalizado'=>'Finalizado','entregue'=>'Entregue'][$os['status']] ?? $os['status'];
    $totalFmt = 'R$ ' . number_format($os['total'], 2, ',', '.');
    $trackUrl = APP_URL . '/rastreio/' . $os['tracking_token'];
    echo <<<HTML
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>OS {$os['os_number']}</title>
<style>
  @media print{.no-print{display:none}body{margin:0}}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e2240;max-width:800px;margin:20px auto;padding:0 20px}
  .header{background:#3b5bdb;color:#fff;padding:16px 20px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
  .logo{font-size:22px;font-weight:800}.os-num{font-size:26px;font-weight:800;text-align:right}
  .section{background:#f5f6fa;border-radius:8px;padding:14px;margin-bottom:14px}
  .section h3{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#9299b5;margin:0 0 10px}
  .row{display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px}
  .lb{color:#5a607a}.vl{font-weight:600}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th{background:#3b5bdb;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
  td{padding:5px 8px;border-bottom:1px solid #e2e5ef;font-size:11px}
  .btn{background:#3b5bdb;color:#fff;border:none;padding:9px 18px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;margin-right:8px}
  .qr-link{font-size:11px;color:#3b5bdb;word-break:break-all}
  .footer{text-align:center;font-size:10px;color:#9299b5;margin-top:20px;border-top:1px solid #e2e5ef;padding-top:10px}
  .status{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#eef1ff;color:#3b5bdb}
</style></head><body>
<div class="no-print" style="margin-bottom:16px">
  <button class="btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
  <button class="btn" style="background:#f5f6fa;color:#1e2240;border:1.5px solid #cdd1e3" onclick="window.close()">Fechar</button>
</div>
<div class="header">
  <div><div class="logo">VisãoOS</div><div style="font-size:11px;opacity:.8">Ordem de Serviço — {$now}</div></div>
  <div class="os-num">{$os['os_number']}<br><div style="font-size:11px;font-weight:400;opacity:.85"><span class="status">{$statusLabel}</span></div></div>
</div>
<div class="section"><h3>Dados do Cliente</h3>
  <div class="row"><span class="lb">Nome</span><span class="vl">{$os['client_name']}</span></div>
  <div class="row"><span class="lb">CPF/CNPJ</span><span class="vl">{$os['cpf_cnpj']}</span></div>
  <div class="row"><span class="lb">Telefone</span><span class="vl">{$os['phone_main']}</span></div>
</div>
<div class="section"><h3>Serviço</h3>
  <div class="row"><span class="lb">Descrição</span><span class="vl">{$os['description']}</span></div>
  <div class="row"><span class="lb">Dimensões</span><span class="vl">{$os['width_m']}m × {$os['height_m']}m = {$os['area_m2']}m²</span></div>
  <div class="row"><span class="lb">Quantidade</span><span class="vl">{$os['quantity']} peça(s)</span></div>
  <div class="row"><span class="lb">Prazo</span><span class="vl">{$due}</span></div>
  <div class="row"><span class="lb">Total</span><span class="vl" style="color:#3b5bdb;font-size:14px">{$totalFmt}</span></div>
</div>
HTML;
    if ($osItems) {
        echo '<div class="section"><h3>Itens</h3><table><thead><tr><th>Item</th><th>Tipo</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr></thead><tbody>';
        foreach ($osItems as $it) {
            $ut = number_format($it['unit_price'],2,',','.'); $tt = number_format($it['total_price'],2,',','.');
            echo "<tr><td>{$it['name']}</td><td>{$it['type']}</td><td>{$it['quantity']} {$it['unit']}</td><td>R$ {$ut}</td><td>R$ {$tt}</td></tr>";
        }
        echo '</tbody></table></div>';
    }
    echo <<<HTML
<div class="section"><h3>Rastreio do Cliente</h3>
  <div class="row"><span class="lb">Link</span><span class="vl"><a class="qr-link" href="{$trackUrl}">{$trackUrl}</a></span></div>
</div>
<div class="section"><h3>Responsáveis</h3>
  <div class="row"><span class="lb">Atendimento</span><span class="vl">{$os['att_name']}</span></div>
  <div class="row"><span class="lb">Produção</span><span class="vl">{$os['prod_name']}</span></div>
</div>
<div class="footer">VisãoOS — Sistema de Gestão para Comunicação Visual | Emitido em {$now}</div>
</body></html>
HTML;
    exit;
}

// ── DELETE /api/os/:id ────────────────────────────────────────────────────
if ($method === 'DELETE' && $id && !$sub) {
    requireRole(['admin'], $user);
    $db = getDB();
    $stmt = $db->prepare('SELECT id,os_number FROM service_orders WHERE id=? AND deleted_at IS NULL');
    $stmt->execute([$id]); $os = $stmt->fetch();
    if (!$os) json_out(['error'=>'OS não encontrada.'], 404);

    $db->prepare('UPDATE service_orders SET deleted_at=NOW() WHERE id=?')->execute([$id]);
    $db->prepare('INSERT INTO activity_logs (user_id,action,entity_type,entity_id,description,ip_address) VALUES (?,?,?,?,?,?)')
       ->execute([$user['id'],'delete_os','service_order',$id,"OS {$os['os_number']} excluída",$_SERVER['REMOTE_ADDR']??'']);

    json_out(['message'=>'OS excluída com sucesso.']);
}

json_out(['error'=>'Rota de OS não encontrada.'], 404);
