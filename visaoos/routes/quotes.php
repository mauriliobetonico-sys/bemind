<?php
$user = requireAuth();
$db   = getDB();

function nextQuoteNumber(PDO $db): string {
    $stmt = $db->query("SELECT MAX(CAST(SUBSTRING(quote_number,4) AS UNSIGNED)) AS n FROM quotes");
    $n    = (int)($stmt->fetchColumn() ?? 0) + 1;
    return 'ORC-' . str_pad($n, 4, '0', STR_PAD_LEFT);
}

if ($method === 'GET' && !$id) {
    $where = ['1=1']; $params = [];
    if ($s = inp('status'))    { $where[] = 'q.status=?'; $params[] = $s; }
    if ($c = inp('client_id')) { $where[] = 'q.client_id=?'; $params[] = $c; }
    if ($q = inp('search'))    { $where[] = '(q.quote_number LIKE ? OR q.description LIKE ? OR c.name LIKE ?)'; $params = array_merge($params, ["%$q%","%$q%","%$q%"]); }
    $w    = implode(' AND ', $where);
    $stmt = $db->prepare("SELECT q.id,q.quote_number,q.description,q.total,q.status,q.valid_until,q.created_at,c.name AS client_name FROM quotes q JOIN clients c ON q.client_id=c.id WHERE $w ORDER BY q.created_at DESC");
    $stmt->execute($params);
    json_out($stmt->fetchAll());
}

if ($method === 'GET' && $id) {
    $stmt = $db->prepare("SELECT q.*,c.name AS client_name,c.email,c.phone_whatsapp FROM quotes q JOIN clients c ON q.client_id=c.id WHERE q.id=?");
    $stmt->execute([$id]); $q = $stmt->fetch();
    if (!$q) json_out(['error'=>'Orçamento não encontrado.'], 404);
    json_out($q);
}

if ($method === 'POST' && !$id) {
    requireRole(['admin','atendimento'], $user);
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
    $subtotal = (float)inp('subtotal', 0);
    $discVal  = $subtotal * ($disc / 100);
    $total    = $subtotal - $discVal;
    $quoteNum = nextQuoteNumber($db);
    $validUntil = inp('valid_until') ?: date('Y-m-d', strtotime('+7 days'));

    $db->prepare("INSERT INTO quotes (quote_number,client_id,attendant_id,client_type,description,notes,width_m,height_m,area_m2,quantity,subtotal,discount_pct,discount_val,total,valid_until) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
       ->execute([$quoteNum, $client_id, $user['id'], $client['type'], $description, inp('notes'), $w?:null, $h?:null, $area?:null, $qty, $subtotal, $disc, $discVal, $total, $validUntil]);

    $quoteId = $db->lastInsertId();
    notifyQuoteCreated($quoteId, $quoteNum, $client, $total, $validUntil);

    json_out(['id'=>$quoteId,'quote_number'=>$quoteNum,'total'=>$total], 201);
}

if ($method === 'PUT' && $id && $sub === 'status') {
    requireRole(['admin','atendimento'], $user);
    $status = inp('status', '');
    if (!in_array($status, ['pendente','aprovado','recusado','convertido'])) json_out(['error'=>'Status inválido.'], 400);
    $db->prepare('UPDATE quotes SET status=? WHERE id=?')->execute([$status, $id]);
    json_out(['message'=>"Status atualizado: $status"]);
}

// Converte orçamento em OS
if ($method === 'POST' && $id && $sub === 'convert') {
    requireRole(['admin','atendimento'], $user);
    $stmt = $db->prepare("SELECT q.*,c.name AS client_name,c.type,c.email,c.phone_whatsapp FROM quotes q JOIN clients c ON q.client_id=c.id WHERE q.id=? AND q.status!='convertido'");
    $stmt->execute([$id]); $quote = $stmt->fetch();
    if (!$quote) json_out(['error'=>'Orçamento não encontrado ou já convertido.'], 404);

    $osNum  = nextOsNumber($db);
    $token  = bin2hex(random_bytes(32));

    $db->prepare("INSERT INTO service_orders (os_number,client_id,attendant_id,client_type,description,notes,width_m,height_m,area_m2,quantity,subtotal,discount_pct,discount_val,total,due_date,tracking_token) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
       ->execute([$osNum, $quote['client_id'], $user['id'], $quote['client_type'], $quote['description'], $quote['notes'], $quote['width_m'], $quote['height_m'], $quote['area_m2'], $quote['quantity'], $quote['subtotal'], $quote['discount_pct'], $quote['discount_val'], $quote['total'], inp('due_date'), $token]);

    $osId = $db->lastInsertId();
    $db->prepare('INSERT INTO os_status_history (os_id,to_status,changed_by,notes) VALUES (?,?,?,?)')->execute([$osId, 'aguardando', $user['id'], "Convertido do orçamento $quote[quote_number]"]);
    $db->prepare('UPDATE quotes SET status="convertido", converted_os_id=? WHERE id=?')->execute([$osId, $id]);

    notifyOsCreated($osId, $osNum, $token, $quote);

    json_out(['message'=>'Orçamento convertido em OS.', 'os_id'=>$osId, 'os_number'=>$osNum, 'tracking_url'=>APP_URL.'/rastreio/'.$token], 201);
}

json_out(['error'=>'Rota de orçamentos não encontrada.'], 404);

function nextOsNumber(PDO $db): string {
    $stmt = $db->query("SELECT MAX(CAST(SUBSTRING(os_number,4) AS UNSIGNED)) AS n FROM service_orders");
    $n    = (int)($stmt->fetchColumn() ?? 0) + 1;
    return 'OS-' . str_pad($n, 5, '0', STR_PAD_LEFT);
}
