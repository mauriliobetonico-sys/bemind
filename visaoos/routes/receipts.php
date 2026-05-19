<?php
$user = requireAuth();
$db   = getDB();

function nextReceiptNumber(PDO $db): string {
    $stmt = $db->query("SELECT MAX(CAST(SUBSTRING(receipt_number,4) AS UNSIGNED)) AS n FROM receipts");
    $n    = (int)($stmt->fetchColumn() ?? 0) + 1;
    return 'REC-' . str_pad($n, 4, '0', STR_PAD_LEFT);
}

// GET /api/receipts
if ($method === 'GET' && !$id) {
    $where = ['1=1']; $params = [];
    if ($c = inp('client_id')) { $where[] = 'r.client_id=?'; $params[] = $c; }
    if ($o = inp('os_id'))     { $where[] = 'r.os_id=?';     $params[] = $o; }
    if ($q = inp('search'))    { $where[] = '(r.receipt_number LIKE ? OR r.description LIKE ? OR c.name LIKE ?)'; $params = array_merge($params, ["%$q%","%$q%","%$q%"]); }
    $w    = implode(' AND ', $where);
    $stmt = $db->prepare("SELECT r.id,r.receipt_number,r.amount,r.description,r.payment_method,r.issued_at,c.name AS client_name,so.os_number FROM receipts r JOIN clients c ON r.client_id=c.id LEFT JOIN service_orders so ON r.os_id=so.id WHERE $w ORDER BY r.issued_at DESC");
    $stmt->execute($params);
    json_out($stmt->fetchAll());
}

// GET /api/receipts/:id
if ($method === 'GET' && $id && $sub !== 'pdf') {
    $stmt = $db->prepare("SELECT r.*,c.name AS client_name,c.cpf_cnpj,c.phone_main,so.os_number,u.name AS issued_by_name FROM receipts r JOIN clients c ON r.client_id=c.id LEFT JOIN service_orders so ON r.os_id=so.id LEFT JOIN users u ON r.issued_by=u.id WHERE r.id=?");
    $stmt->execute([$id]); $r = $stmt->fetch();
    if (!$r) json_out(['error'=>'Recibo não encontrado.'], 404);
    json_out($r);
}

// POST /api/receipts
if ($method === 'POST' && !$id) {
    requireRole(['admin','financeiro','atendimento'], $user);
    $client_id  = (int)inp('client_id', 0);
    $amount     = (float)inp('amount', 0);
    $description= trim(inp('description', ''));
    if (!$client_id || !$amount || !$description) json_out(['error'=>'Cliente, valor e descrição são obrigatórios.'], 400);

    $cli = $db->prepare('SELECT id,name FROM clients WHERE id=? AND active=1');
    $cli->execute([$client_id]); $client = $cli->fetch();
    if (!$client) json_out(['error'=>'Cliente não encontrado.'], 404);

    $recNum = nextReceiptNumber($db);
    $db->prepare("INSERT INTO receipts (receipt_number,os_id,client_id,amount,description,payment_method,notes,issued_by) VALUES (?,?,?,?,?,?,?,?)")
       ->execute([$recNum, inp('os_id') ?: null, $client_id, $amount, $description, inp('payment_method'), inp('notes'), $user['id']]);
    $rid = $db->lastInsertId();

    // Update OS payment if os_id provided
    if ($osId = inp('os_id')) {
        $os = $db->prepare('SELECT total FROM service_orders WHERE id=?');
        $os->execute([$osId]); $osData = $os->fetch();
        $paid = $db->prepare('SELECT SUM(amount) FROM receipts WHERE os_id=?');
        $paid->execute([$osId]); $paidSum = (float)$paid->fetchColumn();
        $pstatus = $paidSum >= (float)($osData['total']??0) ? 'pago' : ($paidSum > 0 ? 'parcial' : 'pendente');
        $db->prepare('UPDATE service_orders SET payment_status=? WHERE id=?')->execute([$pstatus, $osId]);
    }

    json_out(['id'=>$rid,'receipt_number'=>$recNum,'amount'=>$amount], 201);
}

// DELETE /api/receipts/:id
if ($method === 'DELETE' && $id && $sub !== 'pdf') {
    requireRole(['admin','financeiro'], $user);
    $db->prepare('DELETE FROM receipts WHERE id=?')->execute([$id]);
    json_out(['message'=>'Recibo excluído.']);
}

// GET /api/receipts/:id/pdf
if ($method === 'GET' && $id && $sub === 'pdf') {
    $stmt = $db->prepare("SELECT r.*,c.name AS client_name,c.cpf_cnpj,c.phone_main,c.address_street,c.address_city,c.address_state,so.os_number,u.name AS issued_by_name FROM receipts r JOIN clients c ON r.client_id=c.id LEFT JOIN service_orders so ON r.os_id=so.id LEFT JOIN users u ON r.issued_by=u.id WHERE r.id=?");
    $stmt->execute([$id]); $r = $stmt->fetch();
    if (!$r) json_out(['error'=>'Recibo não encontrado.'], 404);

    header('Content-Type: text/html; charset=utf-8');
    header('Content-Disposition: inline; filename="' . $r['receipt_number'] . '.html"');
    $now       = date('d/m/Y H:i');
    $issuedAt  = date('d/m/Y H:i', strtotime($r['issued_at']));
    $amountFmt = 'R$ ' . number_format($r['amount'], 2, ',', '.');
    $osRef     = $r['os_number'] ? " (OS {$r['os_number']})" : '';
    echo <<<HTML
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Recibo {$r['receipt_number']}</title>
<style>
  @media print{.no-print{display:none}body{margin:0}}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e2240;max-width:700px;margin:20px auto;padding:0 20px}
  .header{background:#1e2a4a;color:#fff;padding:18px 22px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}
  .brand{font-size:20px;font-weight:800;letter-spacing:.5px}.brand small{display:block;font-size:10px;opacity:.7;font-weight:400;letter-spacing:.3px}
  .rec-num{font-size:28px;font-weight:800;text-align:right}.rec-num small{font-size:10px;opacity:.7;font-weight:400}
  .box{background:#f5f6fa;border-radius:8px;padding:16px 20px;margin-bottom:14px}
  .box h3{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#8892b0;margin:0 0 12px;font-weight:600}
  .row{display:flex;justify-content:space-between;margin-bottom:6px}
  .lb{color:#5a607a;font-size:11px}.vl{font-weight:600;font-size:12px}
  .amount-box{background:linear-gradient(135deg,#1e2a4a,#3b5bdb);border-radius:10px;padding:20px;text-align:center;margin:20px 0;color:#fff}
  .amount-box .lbl{font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.8;margin-bottom:6px}
  .amount-box .val{font-size:36px;font-weight:800}
  .signature{border-top:2px solid #1e2a4a;margin-top:40px;padding-top:8px;text-align:center;font-size:10px;color:#5a607a}
  .btn{background:#1e2a4a;color:#fff;border:none;padding:9px 18px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;margin-right:8px}
  .footer{text-align:center;font-size:9px;color:#9299b5;margin-top:20px;border-top:1px solid #e2e5ef;padding-top:10px}
</style></head><body>
<div class="no-print" style="margin-bottom:16px">
  <button class="btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
  <button class="btn" style="background:#f5f6fa;color:#1e2240;border:1px solid #ccc" onclick="window.close()">Fechar</button>
</div>
<div class="header">
  <div><div class="brand">VisãoOS<small>Comunicação Visual</small></div></div>
  <div><div class="rec-num">{$r['receipt_number']}<br><small>RECIBO</small></div></div>
</div>
<div class="box"><h3>Dados do Cliente</h3>
  <div class="row"><span class="lb">Nome</span><span class="vl">{$r['client_name']}</span></div>
  <div class="row"><span class="lb">CPF/CNPJ</span><span class="vl">{$r['cpf_cnpj']}</span></div>
  <div class="row"><span class="lb">Telefone</span><span class="vl">{$r['phone_main']}</span></div>
</div>
<div class="amount-box">
  <div class="lbl">Valor Recebido</div>
  <div class="val">{$amountFmt}</div>
</div>
<div class="box"><h3>Referência</h3>
  <div class="row"><span class="lb">Descrição</span><span class="vl">{$r['description']}{$osRef}</span></div>
  <div class="row"><span class="lb">Forma de Pagamento</span><span class="vl">{$r['payment_method']}</span></div>
  <div class="row"><span class="lb">Emitido em</span><span class="vl">{$issuedAt}</span></div>
  <div class="row"><span class="lb">Emitido por</span><span class="vl">{$r['issued_by_name']}</span></div>
</div>
<div class="signature">
  <p style="margin-bottom:40px">Recebi a importância acima referente ao serviço descrito.</p>
  <p>____________________________________</p>
  <p style="margin-top:4px">{$r['client_name']}</p>
  <p style="font-size:9px;margin-top:2px">{$r['cpf_cnpj']}</p>
</div>
<div class="footer">VisãoOS — Sistema de Gestão para Comunicação Visual | Emitido em {$now}</div>
</body></html>
HTML;
    exit;
}

json_out(['error'=>'Rota de recibos não encontrada.'], 404);
