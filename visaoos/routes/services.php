<?php
$user = requireAuth();
$db   = getDB();

if ($method === 'GET' && !$id) {
    $where = ['active=1']; $params = [];
    if ($q = inp('search')) { $where[] = 'name LIKE ?'; $params[] = "%$q%"; }
    $w = implode(' AND ', $where);
    $stmt = $db->prepare("SELECT * FROM services WHERE $w ORDER BY name ASC");
    $stmt->execute($params);
    json_out($stmt->fetchAll());
}

if ($method === 'GET' && $id) {
    $stmt = $db->prepare('SELECT * FROM services WHERE id=?');
    $stmt->execute([$id]); $s = $stmt->fetch();
    if (!$s) json_out(['error'=>'Serviço não encontrado.'], 404);
    json_out($s);
}

if ($method === 'POST' && !$id) {
    requireRole(['admin','atendimento'], $user);
    $name = trim(inp('name',''));
    if (!$name) json_out(['error'=>'Nome é obrigatório.'], 400);
    $db->prepare("INSERT INTO services (name,unit,price_client,price_reseller,estimated_days) VALUES (?,?,?,?,?)")
       ->execute([$name, inp('unit','un'), (float)inp('price_client',0), (float)inp('price_reseller',0), (int)inp('estimated_days',1)]);
    json_out(['id'=>$db->lastInsertId(),'name'=>$name], 201);
}

if ($method === 'PUT' && $id) {
    requireRole(['admin','atendimento'], $user);
    $fields = ['name','unit','price_client','price_reseller','estimated_days','active'];
    $sets = []; $vals = [];
    foreach ($fields as $f) { $v = inp($f, null); if ($v !== null) { $sets[] = "$f=?"; $vals[] = $v; } }
    if (!$sets) json_out(['error'=>'Nenhum campo informado.'], 400);
    $vals[] = $id;
    $db->prepare('UPDATE services SET ' . implode(',', $sets) . ' WHERE id=?')->execute($vals);
    json_out(['message'=>'Serviço atualizado.']);
}

if ($method === 'DELETE' && $id) {
    requireRole(['admin'], $user);
    $db->prepare('UPDATE services SET active=0 WHERE id=?')->execute([$id]);
    json_out(['message'=>'Serviço desativado.']);
}

json_out(['error'=>'Rota de serviços não encontrada.'], 404);
