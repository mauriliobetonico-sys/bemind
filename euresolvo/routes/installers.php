<?php
// /api/v1/installers — perfil do instalador, documentos, disponibilidade, listagem admin
$user = requireAuth();
$db = getDB();

// Descobre instalador do usuário logado (quando aplicável)
$myInstaller = null;
if ($user['role'] === 'instalador') {
    $st = $db->prepare('SELECT * FROM installers WHERE user_id=?');
    $st->execute([$user['id']]);
    $myInstaller = $st->fetch() ?: null;
}

// LISTAGEM (admin/operador) — GET /installers
if ($method === 'GET' && !$id) {
    requireRole(['admin', 'operador'], $user);
    $status = inp('status');
    $where = '1=1'; $vals = [];
    if ($status) { $where .= ' AND i.status=?'; $vals[] = $status; }
    $q = inp('q');
    if ($q) { $where .= ' AND (u.name LIKE ? OR u.email LIKE ? OR i.cpf LIKE ?)'; $vals[] = "%$q%"; $vals[] = "%$q%"; $vals[] = "%$q%"; }
    $sql = "SELECT i.*, u.name, u.email, u.phone
            FROM installers i JOIN users u ON u.id=i.user_id
            WHERE $where ORDER BY i.created_at DESC LIMIT 200";
    $st = $db->prepare($sql); $st->execute($vals);
    json_out($st->fetchAll());
}

// GET /installers/me
if ($method === 'GET' && $id === 'me') {
    requireRole(['instalador'], $user);
    json_out($myInstaller);
}

// PUT /installers/me — atualiza perfil (empresa é obrigada a aprovar antes de aceitar ofertas)
if (($method === 'PUT' || $method === 'PATCH') && $id === 'me') {
    requireRole(['instalador'], $user);
    $editable = ['full_name','birth_date','pix_key','pix_key_type','bank_name','bank_agency','bank_account','bank_account_type',
                 'base_address','base_lat','base_lng','service_radius_km'];
    $sets = []; $vals = [];
    foreach ($editable as $f) {
        $v = inp($f);
        if ($v !== null) { $sets[] = "$f=?"; $vals[] = $v; }
    }
    // JSON fields
    foreach (['specialties','tools','transport'] as $jf) {
        $v = inp($jf);
        if ($v !== null) { $sets[] = "$jf=?"; $vals[] = json_encode($v, JSON_UNESCAPED_UNICODE); }
    }
    if ($sets) {
        $vals[] = $myInstaller['id'];
        $db->prepare('UPDATE installers SET ' . implode(',', $sets) . ' WHERE id=?')->execute($vals);
        auditLog($user['id'], 'installer.update', 'installer', (int)$myInstaller['id']);
    }
    json_out(['ok' => true]);
}

// POST /installers/me/status — instalador liga/desliga "online" e "available"
if ($method === 'POST' && $id === 'me' && $sub === 'status') {
    requireRole(['instalador'], $user);
    $online    = (int)!!inp('online', 0);
    $available = (int)!!inp('available', 1);
    $db->prepare('UPDATE installers SET online=?, available=?, last_ping_at=NOW() WHERE id=?')
       ->execute([$online, $available, $myInstaller['id']]);
    json_out(['ok' => true]);
}

// POST /installers/me/documents (multipart) — envia documento
if ($method === 'POST' && $id === 'me' && $sub === 'documents') {
    requireRole(['instalador'], $user);
    $type = (string) inp('doc_type', 'other');
    if (empty($_FILES['file'])) bad('Arquivo obrigatório em "file".');
    $saved = saveUploadedFile($_FILES['file'], 'installers/' . $myInstaller['id'] . '/docs');
    $db->prepare('INSERT INTO installer_documents (installer_id,doc_type,file_path,original_name,mime_type) VALUES (?,?,?,?,?)')
       ->execute([$myInstaller['id'], $type, $saved['file_path'], $saved['original_name'], $saved['mime_type']]);
    json_out(['ok' => true, 'id' => (int)$db->lastInsertId(), 'file' => $saved]);
}

// GET /installers/:id — detalhe (público limitado)
if ($method === 'GET' && ctype_digit((string)$id)) {
    $st = $db->prepare(
        "SELECT i.*, u.name, u.email, u.phone
         FROM installers i JOIN users u ON u.id=i.user_id WHERE i.id=?"
    );
    $st->execute([(int)$id]);
    $row = $st->fetch();
    if (!$row) bad('Instalador não encontrado.', 404);
    // Se não for o próprio ou admin, remove dados sensíveis
    if ($user['role'] !== 'admin' && (int)$row['user_id'] !== (int)$user['id']) {
        foreach (['cpf','cnpj','pix_key','bank_account','bank_agency','bank_name'] as $f) unset($row[$f]);
    }
    json_out($row);
}

// POST /installers/:id/approve|reject|suspend (admin)
if ($method === 'POST' && ctype_digit((string)$id) && in_array($sub, ['approve','reject','suspend'], true)) {
    requireRole(['admin', 'operador'], $user);
    $status = ['approve' => 'aprovado', 'reject' => 'pendente', 'suspend' => 'suspenso'][$sub];
    $db->prepare('UPDATE installers SET status=? WHERE id=?')->execute([$status, (int)$id]);
    auditLog($user['id'], "installer.$sub", 'installer', (int)$id);
    json_out(['ok' => true, 'status' => $status]);
}

bad('Rota não encontrada.', 404);
