<?php
$user = requireAuth();
requireRole(['admin'], $user);
$db     = getDB();
$action = $id ?? '';

if ($method === 'GET' && $action === 'summary') {
    $paid  = $db->query("SELECT SUM(total) AS t, COUNT(*) AS c FROM service_orders WHERE payment_status='pago'")->fetch();
    $pend  = $db->query("SELECT SUM(total) AS t, COUNT(*) AS c FROM service_orders WHERE payment_status IN ('pendente','parcial')")->fetch();
    $rev   = $db->query("SELECT SUM(total) AS t FROM service_orders WHERE payment_status='pago' AND client_type='revendedor'")->fetchColumn();
    $mon   = $db->query("SELECT SUM(total) AS t FROM service_orders WHERE payment_status='pago' AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())")->fetchColumn();
    $overdue = $db->query("SELECT COUNT(*) FROM service_orders WHERE payment_status!='pago' AND due_date < CURDATE()")->fetchColumn();
    $avgTicket = $db->query("SELECT AVG(total) FROM service_orders WHERE payment_status='pago'")->fetchColumn();

    json_out([
        'total_paid'     => (float)($paid['t']??0),
        'paid_count'     => (int)($paid['c']??0),
        'total_pending'  => (float)($pend['t']??0),
        'pending_count'  => (int)($pend['c']??0),
        'reseller_paid'  => (float)($rev??0),
        'month_revenue'  => (float)($mon??0),
        'overdue_count'  => (int)$overdue,
        'avg_ticket'     => round((float)($avgTicket??0), 2),
    ]);
}

if ($method === 'GET' && $action === 'monthly') {
    $year  = (int)inp('year', date('Y'));
    $stmt  = $db->prepare("SELECT MONTH(created_at) AS month, SUM(total) AS revenue, COUNT(*) AS count FROM service_orders WHERE payment_status='pago' AND YEAR(created_at)=? GROUP BY MONTH(created_at) ORDER BY month ASC");
    $stmt->execute([$year]);
    json_out($stmt->fetchAll());
}

if ($method === 'GET' && $action === 'report') {
    $where = ['1=1']; $params = [];
    if ($df = inp('date_from'))    { $where[] = 'DATE(so.created_at)>=?'; $params[] = $df; }
    if ($dt = inp('date_to'))      { $where[] = 'DATE(so.created_at)<=?'; $params[] = $dt; }
    if ($ct = inp('client_type'))  { $where[] = 'so.client_type=?';       $params[] = $ct; }
    if ($ci = inp('client_id'))    { $where[] = 'so.client_id=?';          $params[] = $ci; }
    if ($ps = inp('payment_status')){ $where[] = 'so.payment_status=?';   $params[] = $ps; }
    $w    = implode(' AND ', $where);
    $stmt = $db->prepare("SELECT so.id,so.os_number,so.description,so.client_type,so.total,so.payment_status,so.payment_method,so.payment_date,so.created_at,so.due_date,c.name AS client_name,ua.name AS attendant_name FROM service_orders so JOIN clients c ON so.client_id=c.id LEFT JOIN users ua ON so.attendant_id=ua.id WHERE $w ORDER BY so.created_at DESC");
    $stmt->execute($params);
    $rows  = $stmt->fetchAll();
    $paid  = array_sum(array_column(array_filter($rows, fn($r)=>$r['payment_status']==='pago'),'total'));
    $pend  = array_sum(array_column(array_filter($rows, fn($r)=>$r['payment_status']!=='pago'),'total'));
    json_out(['rows'=>$rows,'summary'=>['total_paid'=>$paid,'total_pending'=>$pend,'total'=>$paid+$pend,'count'=>count($rows)]]);
}

if ($method === 'GET' && ($action === 'export' || ($action === 'report' && $sub === 'export'))) {
    $df   = inp('date_from'); $dt = inp('date_to');
    $stmt = $db->prepare("SELECT so.os_number,so.description,so.client_type,so.total,so.payment_status,so.payment_method,so.payment_date,so.created_at,c.name AS client_name FROM service_orders so JOIN clients c ON so.client_id=c.id WHERE (? IS NULL OR DATE(so.created_at)>=?) AND (? IS NULL OR DATE(so.created_at)<=?) ORDER BY so.created_at DESC");
    $stmt->execute([$df,$df,$dt,$dt]);
    $rows  = $stmt->fetchAll();
    $paid  = array_sum(array_column(array_filter($rows,fn($r)=>$r['payment_status']==='pago'),'total'));
    $pend  = array_sum(array_column(array_filter($rows,fn($r)=>$r['payment_status']!=='pago'),'total'));
    $now   = date('d/m/Y H:i');
    $per   = $df ? " | Período: $df até " . ($dt??$now) : '';

    header('Content-Type: text/html; charset=utf-8');
    header('Content-Disposition: inline; filename="relatorio-financeiro.html"');
    echo <<<HTML
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório Financeiro</title>
<style>
  @media print{.no-print{display:none}}
  body{font-family:Arial,sans-serif;font-size:11px;color:#1e2240;margin:20px;max-width:1000px}
  h1{color:#3b5bdb;font-size:18px}h2{font-size:11px;color:#9299b5;font-weight:400;margin:0 0 16px}
  table{width:100%;border-collapse:collapse}
  th{background:#3b5bdb;color:#fff;padding:7px 9px;text-align:left;font-size:10px}
  td{padding:6px 9px;border-bottom:1px solid #e2e5ef;font-size:10px}
  tr:nth-child(even){background:#f5f6fa}
  .pago{color:#065f44;font-weight:700}.pendente{color:#9a3309;font-weight:700}
  .summary{margin-top:14px;display:flex;gap:16px}
  .sm{flex:1;background:#f5f6fa;border-radius:8px;padding:10px;text-align:center}
  .sm .l{font-size:9px;text-transform:uppercase;color:#9299b5;letter-spacing:.5px}
  .sm .v{font-size:18px;font-weight:800;margin-top:3px}
  .btn{background:#3b5bdb;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;margin-bottom:14px}
  footer{text-align:center;font-size:9px;color:#9299b5;margin-top:16px;border-top:1px solid #e2e5ef;padding-top:10px}
</style></head><body>
<div class="no-print"><button class="btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button></div>
<h1>VisãoOS — Relatório Financeiro</h1>
<h2>Gerado em {$now}{$per}</h2>
<table><thead><tr><th>Nº OS</th><th>Cliente</th><th>Tipo</th><th>Serviço</th><th>Valor</th><th>Status</th><th>Método</th><th>Data</th></tr></thead><tbody>
HTML;
    foreach ($rows as $r) {
        $d  = date('d/m/Y', strtotime($r['created_at']));
        $t  = $r['client_type']==='revendedor'?'Revendedor':'Cliente';
        $v  = number_format($r['total'],2,',','.');
        $ps = $r['payment_status'];
        $m  = $r['payment_method']??'—';
        echo "<tr><td>{$r['os_number']}</td><td>{$r['client_name']}</td><td>$t</td><td>{$r['description']}</td><td>R$ $v</td><td class='$ps'>$ps</td><td>$m</td><td>$d</td></tr>\n";
    }
    $tp  = number_format($paid,2,',','.');
    $tpe = number_format($pend,2,',','.');
    $tt  = number_format($paid+$pend,2,',','.');
    $cnt = count($rows);
    echo <<<HTML
</tbody></table>
<div class="summary">
  <div class="sm"><div class="l">Total Pago</div><div class="v" style="color:#065f44">R$ {$tp}</div></div>
  <div class="sm"><div class="l">A Receber</div><div class="v" style="color:#9a3309">R$ {$tpe}</div></div>
  <div class="sm"><div class="l">Total Geral</div><div class="v">R$ {$tt}</div></div>
  <div class="sm"><div class="l">Registros</div><div class="v">{$cnt} OS</div></div>
</div>
<footer>VisãoOS — Sistema de Gestão para Comunicação Visual | {$now}</footer>
</body></html>
HTML;
    exit;
}

if ($method === 'GET' && $action === 'client' && $sub) {
    $stmt = $db->prepare("SELECT so.os_number,so.description,so.total,so.payment_status,so.payment_method,so.payment_date,so.created_at FROM service_orders so WHERE so.client_id=? ORDER BY so.created_at DESC");
    $stmt->execute([$sub]); $orders = $stmt->fetchAll();
    $cli   = $db->prepare('SELECT name,type FROM clients WHERE id=?');
    $cli->execute([$sub]);
    $paid  = array_sum(array_column(array_filter($orders,fn($o)=>$o['payment_status']==='pago'),'total'));
    $pend  = array_sum(array_column(array_filter($orders,fn($o)=>$o['payment_status']!=='pago'),'total'));
    json_out(['client'=>$cli->fetch(),'orders'=>$orders,'summary'=>['total_paid'=>$paid,'total_pending'=>$pend]]);
}

json_out(['error'=>'Rota não encontrada.'],404);
