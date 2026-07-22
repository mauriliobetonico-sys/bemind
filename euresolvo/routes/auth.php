<?php
// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — /api/v1/auth
// register (empresa|instalador), login, refresh, logout, me
// ══════════════════════════════════════════════════════════════════════════

$action = $id ?? '';
$ip     = $_SERVER['REMOTE_ADDR'] ?? '';
$ua     = $_SERVER['HTTP_USER_AGENT'] ?? '';

// Rate limit reforçado por endpoint de auth
checkRateLimit("auth:$ip", 30, 60);

switch ("$method:$action") {

    case 'POST:register': {
        $role = strtolower((string) inp('role', ''));
        if (!in_array($role, ['empresa', 'instalador'], true)) bad('Perfil inválido (empresa|instalador).');
        $email = strtolower(trim((string) inp('email', '')));
        $pass  = (string) inp('password', '');
        $name  = trim((string) inp('name', ''));
        $phone = preg_replace('/\D/', '', (string) inp('phone', ''));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) bad('E-mail inválido.');
        if (strlen($pass) < 8) bad('Senha deve ter pelo menos 8 caracteres.');
        if (strlen($name) < 3) bad('Nome inválido.');

        $db = getDB();
        $dup = $db->prepare('SELECT id FROM users WHERE email=?');
        $dup->execute([$email]);
        if ($dup->fetch()) bad('E-mail já cadastrado.', 409, 'EMAIL_TAKEN');

        $db->beginTransaction();
        try {
            $hash = password_hash($pass, PASSWORD_BCRYPT, ['cost' => 12]);
            $db->prepare('INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)')
               ->execute([$name, $email, $phone, $hash, $role]);
            $uid = (int)$db->lastInsertId();
            ensureWallet($uid);

            if ($role === 'empresa') {
                $cnpj = preg_replace('/\D/', '', (string) inp('cnpj', ''));
                if (!validCNPJ($cnpj)) throw new RuntimeException('CNPJ inválido.');
                $razao = trim((string) inp('razao_social', $name));
                $fantasia = trim((string) inp('nome_fantasia', $name));
                $db->prepare('INSERT INTO companies (user_id,cnpj,razao_social,nome_fantasia,contact_name,contact_email,contact_phone,status) VALUES (?,?,?,?,?,?,?,"ativa")')
                   ->execute([$uid, $cnpj, $razao, $fantasia, $name, $email, $phone]);
            } else {
                $cpf = preg_replace('/\D/', '', (string) inp('cpf', ''));
                if (!validCPF($cpf)) throw new RuntimeException('CPF inválido.');
                $db->prepare('INSERT INTO installers (user_id,cpf,full_name,status) VALUES (?,?,?,"pendente")')
                   ->execute([$uid, $cpf, $name]);
            }

            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            bad($e->getMessage(), 422, 'VALIDATION');
        }

        $user = ['id' => $uid, 'name' => $name, 'email' => $email, 'role' => $role];
        $token = generateToken($user);
        $refresh = generateRefreshToken($uid, $ip, $ua);
        auditLog($uid, 'auth.register', 'user', $uid, ['role' => $role]);
        json_out(['token' => $token, 'refresh' => $refresh, 'user' => $user], 201);
    }

    case 'POST:login': {
        $email = strtolower(trim((string) inp('email', '')));
        $pass  = (string) inp('password', '');
        if (!$email || !$pass) bad('Informe e-mail e senha.');

        $db = getDB();
        $stmt = $db->prepare('SELECT id,name,email,role,password_hash,active,login_attempts,locked_until FROM users WHERE email=?');
        $stmt->execute([$email]);
        $u = $stmt->fetch();
        if (!$u) bad('Credenciais inválidas.', 401, 'INVALID_CREDENTIALS');

        if ($u['locked_until'] && strtotime($u['locked_until']) > time()) {
            bad('Conta temporariamente bloqueada. Tente novamente em alguns minutos.', 423, 'LOCKED');
        }
        if (!$u['active']) bad('Conta desativada.', 403, 'INACTIVE');

        if (!password_verify($pass, $u['password_hash'])) {
            $attempts = (int)$u['login_attempts'] + 1;
            $lockUntil = $attempts >= 5 ? date('Y-m-d H:i:s', time() + 600) : null;
            $db->prepare('UPDATE users SET login_attempts=?, locked_until=? WHERE id=?')
               ->execute([$attempts, $lockUntil, $u['id']]);
            bad('Credenciais inválidas.', 401, 'INVALID_CREDENTIALS');
        }

        $db->prepare('UPDATE users SET login_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=?')
           ->execute([$u['id']]);

        $user = ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role']];
        $token = generateToken($user);
        $refresh = generateRefreshToken((int)$u['id'], $ip, $ua);
        auditLog((int)$u['id'], 'auth.login', 'user', (int)$u['id']);
        json_out(['token' => $token, 'refresh' => $refresh, 'user' => $user]);
    }

    case 'POST:refresh': {
        $rt = (string) inp('refresh', '');
        if (!$rt) bad('Refresh token obrigatório.');
        $row = useRefreshToken($rt);
        if (!$row) bad('Refresh token inválido ou expirado.', 401, 'REFRESH_INVALID');
        $user = ['id' => (int)$row['user_id'], 'name' => $row['name'], 'email' => $row['email'], 'role' => $row['role']];
        $token = generateToken($user);
        $refresh = generateRefreshToken((int)$row['user_id'], $ip, $ua);
        json_out(['token' => $token, 'refresh' => $refresh, 'user' => $user]);
    }

    case 'POST:logout': {
        $rt = (string) inp('refresh', '');
        if ($rt) {
            $db = getDB();
            $db->prepare('UPDATE refresh_tokens SET revoked=1 WHERE token_hash=?')
               ->execute([hash('sha256', $rt)]);
        }
        $user = currentUserOrNull();
        if ($user) auditLog($user['id'], 'auth.logout');
        json_out(['ok' => true]);
    }

    case 'GET:me': {
        json_out(requireAuth());
    }

    case 'POST:change-password': {
        $user = requireAuth();
        $cur  = (string) inp('current_password', '');
        $new  = (string) inp('new_password', '');
        if (strlen($new) < 8) bad('Nova senha deve ter pelo menos 8 caracteres.');
        $stmt = getDB()->prepare('SELECT password_hash FROM users WHERE id=?');
        $stmt->execute([$user['id']]);
        $hash = $stmt->fetchColumn();
        if (!password_verify($cur, $hash)) bad('Senha atual incorreta.', 401);
        getDB()->prepare('UPDATE users SET password_hash=? WHERE id=?')
            ->execute([password_hash($new, PASSWORD_BCRYPT, ['cost' => 12]), $user['id']]);
        auditLog($user['id'], 'auth.change-password');
        json_out(['ok' => true]);
    }

    default:
        json_out(['error' => 'Ação de auth desconhecida.'], 404);
}
