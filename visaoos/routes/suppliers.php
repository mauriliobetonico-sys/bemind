<?php
$user = requireAuth();
$db   = getDB();

// GET /api/suppliers
if ($method === 'GET' && !$id) {
    $where = ['active=1']; $params = [];
    if ($q = inp('search')) {
        $where[] = '(name LIKE ? OR contact_name LIKE ? OR material_types LIKE ?)';
        $params  = array_merge($params, ["%$q%", "%$q%", "%$q%"]);
    }
    $w    = implode(' AND ', $where);
    $stmt = $db->prepare("SELECT id,name,contact_name,cnpj,email,phone,whatsapp,address_city,address_state,material_types,active,created_at FROM suppliers WHERE $w ORDER BY name ASC");
    $stmt->execute($params);
    json_out($stmt->fetchAll());
}

// GET /api/suppliers/:id
if ($method === 'GET' && $id) {
    $stmt = $db->prepare('SELECT * FROM suppliers WHERE id=?');
    $stmt->execute([$id]); $s = $stmt->fetch();
    if (!$s) json_out(['error'=>'Fornecedor não encontrado.'], 404);
    // Histórico de compras (itens de OS associados por material)
    json_out($s);
}

// POST /api/suppliers
if ($method === 'POST' && !$id) {
    requireRole(['admin','atendimento'], $user);
    $name = trim(inp('name',''));
    if (!$name) json_out(['error'=>'Nome é obrigatório.'], 400);
    $db->prepare("INSERT INTO suppliers (name,contact_name,cnpj,email,phone,whatsapp,address_street,address_city,address_state,material_types,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
       ->execute([$name, inp('contact_name'), inp('cnpj'), inp('email'), inp('phone'), inp('whatsapp'), inp('address_street'), inp('address_city'), inp('address_state'), inp('material_types'), inp('notes')]);
    json_out(['id'=>$db->lastInsertId(),'name'=>$name], 201);
}

// PUT /api/suppliers/:id
if ($method === 'PUT' && $id) {
    requireRole(['admin','atendimento'], $user);
    $fields = ['name','contact_name','cnpj','email','phone','whatsapp','address_street','address_city','address_state','material_types','notes','active'];
    $sets = []; $vals = [];
    foreach ($fields as $f) {
        $v = inp($f, null);
        if ($v !== null) { $sets[] = "$f=?"; $vals[] = ($f==='active') ? ($v?1:0) : $v; }
    }
    if (!$sets) json_out(['error'=>'Nenhum campo informado.'], 400);
    $vals[] = $id;
    $db->prepare('UPDATE suppliers SET ' . implode(',', $sets) . ' WHERE id=?')->execute($vals);
    json_out(['message'=>'Fornecedor atualizado.']);
}

// DELETE /api/suppliers/:id
if ($method === 'DELETE' && $id) {
    requireRole(['admin'], $user);
    $db->prepare('UPDATE suppliers SET active=0 WHERE id=?')->execute([$id]);
    json_out(['message'=>'Fornecedor desativado.']);
}

json_out(['error'=>'Rota de fornecedores não encontrada.'], 404);
