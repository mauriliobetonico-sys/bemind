<?php
// /api/v1/companies — perfil da empresa, filiais, centros de custo
$user = requireAuth();
requireRole(['empresa', 'admin', 'operador'], $user);
$db = getDB();

$stmt = $db->prepare('SELECT * FROM companies WHERE user_id=?');
$stmt->execute([$user['id']]);
$company = $stmt->fetch();
if (!$company && $user['role'] === 'empresa') bad('Empresa não encontrada.', 404);

// /companies/branches[/:id]
if ($id === 'branches') {
    $companyId = $user['role'] === 'admin'
        ? (int) inp('company_id', 0)
        : (int) $company['id'];
    if (!$companyId) bad('company_id obrigatório.');

    if ($method === 'GET') {
        $st = $db->prepare('SELECT * FROM company_branches WHERE company_id=? ORDER BY name');
        $st->execute([$companyId]);
        json_out($st->fetchAll());
    }
    if ($method === 'POST') {
        $fields = ['name','cost_center','address_street','address_number','address_complement','address_district','address_city','address_state','address_zip','lat','lng'];
        $vals = array_map(fn($f) => inp($f), $fields);
        $sql = 'INSERT INTO company_branches (company_id,' . implode(',', $fields) . ') VALUES (?' . str_repeat(',?', count($fields)) . ')';
        $db->prepare($sql)->execute(array_merge([$companyId], $vals));
        json_out(['id' => (int)$db->lastInsertId()], 201);
    }
    if ($method === 'DELETE' && $sub) {
        $db->prepare('DELETE FROM company_branches WHERE id=? AND company_id=?')->execute([(int)$sub, $companyId]);
        json_out(['ok' => true]);
    }
    bad('Método não permitido.', 405);
}

// /companies (perfil)
if ($method === 'GET') json_out($company);
if ($method === 'PUT' || $method === 'PATCH') {
    $editable = ['razao_social','nome_fantasia','segment','contact_name','contact_email','contact_phone','billing_email'];
    $sets = []; $vals = [];
    foreach ($editable as $f) {
        $v = inp($f);
        if ($v !== null) { $sets[] = "$f=?"; $vals[] = $v; }
    }
    if (!$sets) bad('Nada a atualizar.');
    $vals[] = $company['id'];
    $db->prepare('UPDATE companies SET ' . implode(',', $sets) . ' WHERE id=?')->execute($vals);
    auditLog($user['id'], 'company.update', 'company', (int)$company['id'], $body ?? []);
    json_out(['ok' => true]);
}

bad('Método não permitido.', 405);
