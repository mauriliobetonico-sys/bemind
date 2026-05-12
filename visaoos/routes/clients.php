<?php
$user = requireAuth();
$db   = getDB();

if ($method === 'GET' && !$id) {
    $where = ['active=1']; $params = [];
    if ($t = inp('type'))   { $where[] = 'type=?';      $params[] = $t; }
    if ($q = inp('search')) { $where[] = '(name LIKE ? OR cpf_cnpj LIKE ? OR email LIKE ?)'; $params = array_merge($params, ["%$q%","%$q%","%$q%"]); }
    $w    = implode(' AND ', $where);
    $stmt = $db->prepare("SELECT id,name,cpf_cnpj,type,email,phone_main,phone_whatsapp,address_city,address_state,active,created_at FROM clients WHERE $w ORDER BY name ASC");
    $stmt->execute($params);
    json_out($stmt->fetchAll());
}

if ($method === 'GET' && $id) {
    $stmt = $db->prepare('SELECT * FROM clients WHERE id=?');
    $stmt->execute([$id]); $c = $stmt->fetch();
    if (!$c) json_out(['error'=>'Cliente não encontrado.'], 404);
    $os = $db->prepare('SELECT COUNT(*) AS cnt, SUM(total) AS total, SUM(CASE WHEN payment_status="pago" THEN total ELSE 0 END) AS paid FROM service_orders WHERE client_id=?');
    $os->execute([$id]); $c['stats'] = $os->fetch();
    json_out($c);
}

if ($method === 'POST' && !$id) {
    requireRole(['admin','atendimento'], $user);
    $name = trim(inp('name',''));
    $type = inp('type','cliente');
    if (!$name) json_out(['error'=>'Nome é obrigatório.'], 400);
    if (!in_array($type,['cliente','revendedor'])) json_out(['error'=>'Tipo inválido.'], 400);
    $db->prepare("INSERT INTO clients (name,cpf_cnpj,type,email,phone_main,phone_whatsapp,address_street,address_city,address_state,address_zip,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
       ->execute([$name, inp('cpf_cnpj'), $type, inp('email'), inp('phone_main'), inp('phone_whatsapp'), inp('address_street'), inp('address_city'), inp('address_state'), inp('address_zip'), inp('notes')]);
    json_out(['id'=>$db->lastInsertId(),'name'=>$name,'type'=>$type], 201);
}

if ($method === 'PUT' && $id) {
    requireRole(['admin','atendimento'], $user);
    $fields = ['name','cpf_cnpj','type','email','phone_main','phone_whatsapp','address_street','address_city','address_state','address_zip','notes','active'];
    $sets = []; $vals = [];
    foreach ($fields as $f) { $v = inp($f, null); if ($v !== null) { $sets[] = "$f=?"; $vals[] = ($f==='active') ? ($v?1:0) : $v; } }
    if (!$sets) json_out(['error'=>'Nenhum campo informado.'], 400);
    $vals[] = $id;
    $db->prepare('UPDATE clients SET ' . implode(',', $sets) . ' WHERE id=?')->execute($vals);
    json_out(['message'=>'Cliente atualizado.']);
}

if ($method === 'DELETE' && $id) {
    requireRole(['admin'], $user);
    $db->prepare('UPDATE clients SET active=0 WHERE id=?')->execute([$id]);
    json_out(['message'=>'Cliente desativado.']);
}

json_out(['error'=>'Rota de clientes não encontrada.'], 404);
