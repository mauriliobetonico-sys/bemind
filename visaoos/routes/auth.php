<?php
// ── POST /api/auth/login ──────────────────────────────────────────────────
if ($method === 'POST' && $id === 'login') {
    $email = strtolower(trim(inp('email', '')));
    $pass  = inp('password', '');

    if (!$email || !$pass) {
        json_out(['error' => 'E-mail e senha são obrigatórios.'], 400);
    }

    $db   = getDB();
    $stmt = $db->prepare('SELECT id,name,email,password_hash,role,active,login_attempts,locked_until FROM users WHERE email=?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if ($user && $user['locked_until'] && strtotime($user['locked_until']) > time()) {
        $wait = ceil((strtotime($user['locked_until']) - time()) / 60);
        json_out(['error' => "Conta bloqueada. Aguarde {$wait} minuto(s)."], 429);
    }

    if (!$user || !$user['active'] || !password_verify($pass, $user['password_hash'])) {
        if ($user) {
            $attempts = (int)$user['login_attempts'] + 1;
            $lock     = $attempts >= 5 ? date('Y-m-d H:i:s', time() + 900) : null;
            $db->prepare('UPDATE users SET login_attempts=?, locked_until=? WHERE id=?')
               ->execute([$attempts, $lock, $user['id']]);
        }
        json_out(['error' => 'E-mail ou senha incorretos.'], 401);
    }

    $db->prepare('UPDATE users SET login_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=?')
       ->execute([$user['id']]);

    $accessToken  = generateToken($user);
    $refreshToken = generateRefreshToken($user['id'], $ip ?? '');

    json_out([
        'token'         => $accessToken,
        'refresh_token' => $refreshToken,
        'expires_in'    => JWT_EXPIRES,
        'user'          => [
            'id'    => $user['id'],
            'name'  => $user['name'],
            'email' => $user['email'],
            'role'  => $user['role'],
        ],
    ]);
}

// ── POST /api/auth/refresh ────────────────────────────────────────────────
if ($method === 'POST' && $id === 'refresh') {
    $refreshToken = inp('refresh_token', '');
    if (!$refreshToken) json_out(['error' => 'refresh_token não informado.'], 400);

    $userData = useRefreshToken($refreshToken);
    if (!$userData) json_out(['error' => 'Refresh token inválido ou expirado.', 'code' => 'REFRESH_EXPIRED'], 401);

    $newAccessToken  = generateToken($userData);
    $newRefreshToken = generateRefreshToken($userData['user_id'], $ip ?? '');

    json_out([
        'token'         => $newAccessToken,
        'refresh_token' => $newRefreshToken,
        'expires_in'    => JWT_EXPIRES,
    ]);
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────
if ($method === 'GET' && ($id === 'me' || !$id)) {
    $user = requireAuth();
    json_out([
        'id'    => $user['id'],
        'name'  => $user['name'],
        'email' => $user['email'],
        'role'  => $user['role'],
    ]);
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────
if ($method === 'POST' && $id === 'logout') {
    $refreshToken = inp('refresh_token', '');
    if ($refreshToken) {
        $tokenHash = hash('sha256', $refreshToken);
        getDB()->prepare("UPDATE refresh_tokens SET revoked=1 WHERE token_hash=?")->execute([$tokenHash]);
    }
    json_out(['message' => 'Logout realizado.']);
}

json_out(['error' => 'Rota de auth não encontrada.'], 404);
