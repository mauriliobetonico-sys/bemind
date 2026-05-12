<?php
$user = requireAuth();
$db   = getDB();

if ($method === 'GET' && !$id) {
    requireRole(['admin'], $user);
    $stmt = $db->query("SELECT id,name,email,role,active,last_login,created_at FROM users ORDER BY name ASC");
    json_out($stmt->fetchAll());
}

if ($method === 'GET' && $id) {
    requireRole(['admin'], $user);
    $stmt = $db->prepare('SELECT id,name,email,role,active,last_login,created_at FROM users WHERE id=?');
    $stmt->execute([$id]); $u = $stmt->fetch();
    if (!$u) json_out(['error'=>'Usuário não encontrado.'], 404);
    json_out($u);
}

if ($method === 'POST' && !$id) {
    requireRole(['admin'], $user);
    $name  = trim(inp('name',''));
    $email = strtolower(trim(inp('email','')));
    $pass  = inp('password','');
    $role  = inp('role','atendimento');
    if (!$name || !$email || !$pass) json_out(['error'=>'Nome, e-mail e senha são obrigatórios.'], 400);
    if (!in_array($role,['admin','atendimento','producao','financeiro'])) json_out(['error'=>'Role inválido.'], 400);
    if (strlen($pass) < 8) json_out(['error'=>'Senha deve ter no mínimo 8 caracteres.'], 400);

    $exists = $db->prepare('SELECT COUNT(*) FROM users WHERE email=?');
    $exists->execute([$email]);
    if ($exists->fetchColumn() > 0) json_out(['error'=>'E-mail já cadastrado.'], 409);

    $hash = password_hash($pass, PASSWORD_BCRYPT, ['cost'=>12]);
    $db->prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)")->execute([$name,$email,$hash,$role]);
    json_out(['id'=>$db->lastInsertId(),'name'=>$name,'email'=>$email,'role'=>$role], 201);
}

if ($method === 'PUT' && $id) {
    if ($user['id'] != $id) requireRole(['admin'], $user);
    $sets = []; $vals = [];
    if ($n = inp('name'))   { $sets[] = 'name=?';  $vals[] = trim($n); }
    if ($e = inp('email'))  { $sets[] = 'email=?'; $vals[] = strtolower(trim($e)); }
    if ($r = inp('role'))   {
        requireRole(['admin'], $user);
        if (!in_array($r,['admin','atendimento','producao','financeiro'])) json_out(['error'=>'Role inválido.'], 400);
        $sets[] = 'role=?'; $vals[] = $r;
    }
    if ($a = inp('active', null)) {
        requireRole(['admin'], $user);
        $sets[] = 'active=?'; $vals[] = $a ? 1 : 0;
    }
    if ($p = inp('password')) {
        if (strlen($p) < 8) json_out(['error'=>'Senha deve ter no mínimo 8 caracteres.'], 400);
        $sets[] = 'password_hash=?'; $vals[] = password_hash($p, PASSWORD_BCRYPT, ['cost'=>12]);
    }
    if (!$sets) json_out(['error'=>'Nenhum campo informado.'], 400);
    $vals[] = $id;
    $db->prepare('UPDATE users SET ' . implode(',', $sets) . ' WHERE id=?')->execute($vals);
    json_out(['message'=>'Usuário atualizado.']);
}

if ($method === 'DELETE' && $id) {
    requireRole(['admin'], $user);
    if ($user['id'] == $id) json_out(['error'=>'Não é possível desativar seu próprio usuário.'], 400);
    $db->prepare('UPDATE users SET active=0 WHERE id=?')->execute([$id]);
    json_out(['message'=>'Usuário desativado.']);
}

json_out(['error'=>'Rota de usuários não encontrada.'], 404);
