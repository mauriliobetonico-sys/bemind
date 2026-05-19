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

// GET /api/quotes/:id/pdf
if ($method === 'GET' && $id && $sub === 'pdf') {
    $stmt = $db->prepare("SELECT q.*,c.name AS client_name,c.cpf_cnpj,c.phone_main,c.email AS client_email,ua.name AS att_name FROM quotes q JOIN clients c ON q.client_id=c.id LEFT JOIN users ua ON q.attendant_id=ua.id WHERE q.id=?");
    $stmt->execute([$id]); $q = $stmt->fetch();
    if (!$q) json_out(['error'=>'Orçamento não encontrado.'], 404);

    header('Content-Type: text/html; charset=utf-8');
    $now       = date('d/m/Y H:i');
    $valid     = $q['valid_until'] ? date('d/m/Y', strtotime($q['valid_until'])) : '—';
    $totalFmt  = 'R$ ' . number_format($q['total'], 2, ',', '.');
    $statusMap = ['pendente'=>'Pendente','aprovado'=>'Aprovado','recusado'=>'Recusado','convertido'=>'Convertido em OS'];
    $sLabel    = $statusMap[$q['status']] ?? $q['status'];
    $disc      = $q['discount_pct'] > 0 ? "Desconto: {$q['discount_pct']}% (R$ " . number_format($q['discount_val'],2,',','.') . ")" : '—';
    echo <<<HTML
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Orçamento {$q['quote_number']}</title>
<style>
  @media print{.no-print{display:none}body{margin:0}}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e2240;max-width:800px;margin:20px auto;padding:0 20px}
  .header{background:#3b5bdb;color:#fff;padding:16px 22px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
  .brand{font-size:20px;font-weight:800}.sub{font-size:11px;opacity:.75;margin-top:2px}
  .orc-num{font-size:26px;font-weight:800;text-align:right}.orc-num small{font-size:11px;font-weight:400;opacity:.8}
  .box{background:#f5f6fa;border-radius:8px;padding:14px 18px;margin-bottom:14px}
  .box h3{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#8892b0;margin:0 0 10px}
  .row{display:flex;justify-content:space-between;margin-bottom:5px}
  .lb{color:#5a607a;font-size:11px}.vl{font-weight:600;font-size:12px}
  .total-box{background:#f0f4ff;border:2px solid #3b5bdb;border-radius:10px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin:16px 0}
  .total-box .lbl{font-size:11px;color:#3b5bdb;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
  .total-box .val{font-size:28px;font-weight:800;color:#3b5bdb}
  .validity{background:#fff8e1;border:1px solid #fcd34d;border-radius:8px;padding:10px 16px;text-align:center;font-size:11px;color:#92400e;margin-bottom:14px}
  .btn{background:#3b5bdb;color:#fff;border:none;padding:9px 18px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;margin-right:8px}
  .footer{text-align:center;font-size:9px;color:#9299b5;margin-top:20px;border-top:1px solid #e2e5ef;padding-top:10px}
</style></head><body>
<div class="no-print" style="margin-bottom:14px">
  <button class="btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
  <button class="btn" style="background:#f5f6fa;color:#1e2240;border:1px solid #ccc" onclick="window.close()">Fechar</button>
</div>
<div class="header">
  <div><div class="brand">VisãoOS</div><div class="sub">Comunicação Visual — Orçamento</div></div>
  <div><div class="orc-num">{$q['quote_number']}<br><small>Status: {$sLabel}</small></div></div>
</div>
<div class="validity">⏳ Validade deste orçamento: até <strong>{$valid}</strong> | Emitido em: {$now}</div>
<div class="box"><h3>Dados do Cliente</h3>
  <div class="row"><span class="lb">Nome</span><span class="vl">{$q['client_name']}</span></div>
  <div class="row"><span class="lb">CPF/CNPJ</span><span class="vl">{$q['cpf_cnpj']}</span></div>
  <div class="row"><span class="lb">Telefone</span><span class="vl">{$q['phone_main']}</span></div>
  <div class="row"><span class="lb">E-mail</span><span class="vl">{$q['client_email']}</span></div>
</div>
<div class="box"><h3>Serviço / Proposta</h3>
  <div class="row"><span class="lb">Descrição</span><span class="vl">{$q['description']}</span></div>
  <div class="row"><span class="lb">Dimensões</span><span class="vl">{$q['width_m']}m × {$q['height_m']}m = {$q['area_m2']}m²</span></div>
  <div class="row"><span class="lb">Quantidade</span><span class="vl">{$q['quantity']} peça(s)</span></div>
  <div class="row"><span class="lb">Subtotal</span><span class="vl">R$ {$q['subtotal']}</span></div>
  <div class="row"><span class="lb">Desconto</span><span class="vl">{$disc}</span></div>
  <div class="row"><span class="lb">Observações</span><span class="vl">{$q['notes']}</span></div>
</div>
<div class="total-box">
  <div class="lbl">Total do Orçamento</div>
  <div class="val">{$totalFmt}</div>
</div>
<div class="box"><h3>Atendimento</h3>
  <div class="row"><span class="lb">Atendente</span><span class="vl">{$q['att_name']}</span></div>
  <div class="row"><span class="lb">Gerado em</span><span class="vl">{$now}</span></div>
</div>
<div class="footer">VisãoOS — Sistema de Gestão para Comunicação Visual | {$now}</div>
</body></html>
HTML;
    exit;
}

json_out(['error'=>'Rota de orçamentos não encontrada.'], 404);

function nextOsNumber(PDO $db): string {
    $stmt = $db->query("SELECT MAX(CAST(SUBSTRING(os_number,4) AS UNSIGNED)) AS n FROM service_orders");
    $n    = (int)($stmt->fetchColumn() ?? 0) + 1;
    return 'OS-' . str_pad($n, 5, '0', STR_PAD_LEFT);
}
