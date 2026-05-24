<?php
// Rota pública — sem autenticação
$token = $id ?? '';
if (!$token) { http_response_code(400); die(json_encode(['error'=>'Token não informado.'])); }

$db   = getDB();
$stmt = $db->prepare("SELECT so.os_number,so.description,so.status,so.created_at,so.due_date,so.delivery_date,c.name AS client_name FROM service_orders so JOIN clients c ON so.client_id=c.id WHERE so.tracking_token=?");
$stmt->execute([$token]);
$os = $stmt->fetch();

// Retorna JSON se solicitado
$httpAccept = isset($_SERVER['HTTP_ACCEPT']) ? $_SERVER['HTTP_ACCEPT'] : '';
if ($sub === 'json' || strpos($httpAccept, 'application/json') !== false) {
    if (!$os) json_out(['error'=>'Pedido não encontrado.'],404);
    $h = $db->prepare("SELECT to_status,notes,created_at FROM os_status_history WHERE os_id=(SELECT id FROM service_orders WHERE tracking_token=?) ORDER BY created_at ASC");
    $h->execute([$token]);
    json_out(array_merge($os,['history'=>$h->fetchAll()]));
}

// Retorna página HTML
header('Content-Type: text/html; charset=utf-8');
$hist = [];
if ($os) {
    $h = $db->prepare("SELECT to_status,notes,created_at FROM os_status_history WHERE os_id=(SELECT id FROM service_orders WHERE tracking_token=?) ORDER BY created_at ASC");
    $h->execute([$token]); $hist = $h->fetchAll();
}

$statuses = ['aguardando','producao','finalizado','entregue'];
$labels   = ['aguardando'=>'Aguardando','producao'=>'Em Produção','finalizado'=>'Finalizado','entregue'=>'Entregue'];
$icons    = ['aguardando'=>'⏳','producao'=>'⚙️','finalizado'=>'✅','entregue'=>'📦'];
$curIdx   = $os ? array_search($os['status'],$statuses) : -1;
$now      = date('d/m/Y H:i');
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VisãoOS — Rastreio <?= $os ? htmlspecialchars($os['os_number']) : '' ?></title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f5f6fa;min-height:100vh;padding:20px;color:#1e2240}
  .wrap{max-width:540px;margin:0 auto}
  .brand{font-size:22px;font-weight:800;color:#3b5bdb;margin-bottom:2px}
  .sub{font-size:12px;color:#9299b5;margin-bottom:20px}
  .card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 12px rgba(30,34,64,.08);margin-bottom:14px;border:1.5px solid #e2e5ef}
  .sec{font-size:10px;font-weight:700;color:#9299b5;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px}
  .os-num{font-size:24px;font-weight:800;color:#3b5bdb}
  .info{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:10px}
  .ii .l{font-size:11px;color:#9299b5}.ii .v{font-size:13px;font-weight:600;margin-top:1px}
  .steps{display:flex;align-items:center;width:100%}
  .step{display:flex;flex-direction:column;align-items:center;flex:0 0 auto}
  .dot{width:28px;height:28px;border-radius:50%;border:2px solid #e2e5ef;background:#f5f6fa;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#9299b5}
  .step.done .dot{background:#087f5b;border-color:#087f5b;color:#fff}
  .step.active .dot{background:#3b5bdb;border-color:#3b5bdb;color:#fff;box-shadow:0 0 0 4px rgba(59,91,219,.15)}
  .lbl{font-size:9px;margin-top:4px;color:#9299b5;font-weight:500;text-align:center}
  .step.done .lbl{color:#087f5b}.step.active .lbl{color:#3b5bdb;font-weight:700}
  .line{flex:1;height:2px;background:#e2e5ef;min-width:12px}
  .step.done+.line{background:#087f5b}
  .tl{padding-left:20px;position:relative;margin-top:4px}
  .tl::before{content:'';position:absolute;left:7px;top:0;bottom:0;width:1.5px;background:#e2e5ef}
  .tli{position:relative;margin-bottom:12px}
  .tld{position:absolute;left:-16px;top:5px;width:9px;height:9px;border-radius:50%;background:#3b5bdb;border:2px solid #fff}
  .tlc{background:#f5f6fa;border-radius:8px;padding:8px 11px}
  .tldt{font-size:10px;color:#9299b5;font-weight:600}
  .tlt{font-size:12px;margin-top:2px;color:#1e2240;font-weight:500}
  .err{text-align:center;padding:40px 20px}
  .footer{text-align:center;font-size:10px;color:#9299b5;margin-top:14px}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">VisãoOS</div>
  <div class="sub">Acompanhamento de Pedido — <?= $now ?></div>

<?php if (!$os): ?>
  <div class="card err">
    <div style="font-size:36px;margin-bottom:12px">❌</div>
    <h2 style="color:#c92a2a;margin-bottom:8px">Pedido não encontrado</h2>
    <p style="color:#5a607a;font-size:13px">O link de rastreio é inválido ou o pedido foi removido.<br>Entre em contato com a empresa.</p>
  </div>
<?php else:
  $created = date('d/m/Y', strtotime($os['created_at']));
  $due     = $os['due_date'] ? date('d/m/Y', strtotime($os['due_date'])) : '—';
?>
  <div class="card">
    <div class="sec">ORDEM DE SERVIÇO</div>
    <div class="os-num"><?= htmlspecialchars($os['os_number']) ?></div>
    <div style="font-size:13px;color:#5a607a;margin-top:6px"><?= htmlspecialchars($os['description']) ?></div>
    <div class="info">
      <div class="ii"><div class="l">Cliente</div><div class="v"><?= htmlspecialchars($os['client_name']) ?></div></div>
      <div class="ii"><div class="l">Abertura</div><div class="v"><?= $created ?></div></div>
      <div class="ii"><div class="l">Prazo</div><div class="v"><?= $due ?></div></div>
    </div>
  </div>

  <div class="card">
    <div class="sec">STATUS DO PEDIDO</div>
    <div class="steps">
    <?php foreach ($statuses as $i => $s):
      $done   = $i < $curIdx;
      $active = $i === $curIdx;
      $cls    = $done ? 'done' : ($active ? 'active' : '');
      $dotTxt = $done ? '✓' : ($i+1);
    ?>
      <div class="step <?= $cls ?>">
        <div class="dot"><?= $dotTxt ?></div>
        <div class="lbl"><?= $labels[$s] ?></div>
      </div>
      <?php if ($i < count($statuses)-1): ?><div class="line"></div><?php endif ?>
    <?php endforeach ?>
    </div>
  </div>

  <?php if ($hist): ?>
  <div class="card">
    <div class="sec">HISTÓRICO DE ATUALIZAÇÕES</div>
    <div class="tl">
    <?php foreach ($hist as $h):
      $hDate  = date('d/m/Y H:i', strtotime($h['created_at']));
      $hLabel = $labels[$h['to_status']] ?? $h['to_status'];
      $hNote  = $h['notes'] ? ' — ' . htmlspecialchars($h['notes']) : '';
      $hIcon  = $icons[$h['to_status']] ?? '•';
    ?>
      <div class="tli">
        <div class="tld"></div>
        <div class="tlc">
          <div class="tldt"><?= $hDate ?></div>
          <div class="tlt"><?= "$hIcon $hLabel$hNote" ?></div>
        </div>
      </div>
    <?php endforeach ?>
    </div>
  </div>
  <?php endif ?>
<?php endif ?>

  <div class="footer">VisãoOS — Sistema de Gestão para Comunicação Visual</div>
</div>
</body>
</html>
