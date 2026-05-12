<?php
// ══════════════════════════════════════════════════════════════════════════
// VISÃOOS — Autenticação JWT + Refresh Tokens (sem dependências externas)
// ══════════════════════════════════════════════════════════════════════════

// ── JWT puro (HS256) ──────────────────────────────────────────────────────
function jwtEncode(array $payload): string {
    $header  = base64url(json_encode(['alg'=>'HS256','typ'=>'JWT']));
    $payload = base64url(json_encode($payload));
    $sig     = base64url(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));
    return "$header.$payload.$sig";
}

function jwtDecode(string $token): ?array {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$header, $payload, $sig] = $parts;
    $expected = base64url(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));
    if (!hash_equals($expected, $sig)) return null;
    $data = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
    if (!$data || ($data['exp'] ?? 0) < time()) return null;
    return $data;
}

function base64url(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

// ── Gera access token (curto prazo) ──────────────────────────────────────
function generateToken(array $user): string {
    return jwtEncode([
        'sub'   => $user['id'],
        'email' => $user['email'],
        'role'  => $user['role'],
        'name'  => $user['name'],
        'iat'   => time(),
        'exp'   => time() + JWT_EXPIRES,
    ]);
}

// ── Gera refresh token (longo prazo) ─────────────────────────────────────
function generateRefreshToken(int $userId, string $ip = ''): string {
    $token     = bin2hex(random_bytes(40));
    $tokenHash = hash('sha256', $token);
    $expiresAt = date('Y-m-d H:i:s', time() + JWT_REFRESH_EXPIRES);

    $db = getDB();
    // Remove tokens expirados deste usuário
    $db->prepare("DELETE FROM refresh_tokens WHERE user_id=? AND (expires_at < NOW() OR revoked=1)")
       ->execute([$userId]);

    $db->prepare("INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address) VALUES (?,?,?,?)")
       ->execute([$userId, $tokenHash, $expiresAt, $ip]);

    return $token;
}

// ── Valida e usa refresh token ────────────────────────────────────────────
function useRefreshToken(string $token): ?array {
    $tokenHash = hash('sha256', $token);
    $db = getDB();
    $stmt = $db->prepare(
        "SELECT rt.id, rt.user_id, u.name, u.email, u.role, u.active
         FROM refresh_tokens rt
         JOIN users u ON rt.user_id = u.id
         WHERE rt.token_hash=? AND rt.revoked=0 AND rt.expires_at > NOW()"
    );
    $stmt->execute([$tokenHash]);
    $row = $stmt->fetch();
    if (!$row || !$row['active']) return null;

    // Rotaciona: revoga o token usado
    $db->prepare("UPDATE refresh_tokens SET revoked=1 WHERE id=?")->execute([$row['id']]);

    return $row;
}

// ── Verifica autenticação (Bearer token) ─────────────────────────────────
function requireAuth(): array {
    $token = null;

    $auth = $_SERVER['HTTP_AUTHORIZATION']
         ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
         ?? '';
    if (preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
        $token = $m[1];
    }

    if (!$token && !empty($_GET['token'])) {
        $token = $_GET['token'];
    }

    if (!$token) {
        http_response_code(401);
        die(json_encode(['error' => 'Token de autenticação não informado.']));
    }

    $payload = jwtDecode($token);
    if (!$payload) {
        http_response_code(401);
        die(json_encode(['error' => 'Token inválido ou expirado.', 'code' => 'TOKEN_EXPIRED']));
    }

    try {
        $db   = getDB();
        $stmt = $db->prepare('SELECT id,name,email,role,active FROM users WHERE id=? AND active=1');
        $stmt->execute([$payload['sub']]);
        $user = $stmt->fetch();
    } catch (Throwable $e) {
        http_response_code(500);
        die(json_encode(['error' => 'Erro de banco de dados.']));
    }

    if (!$user) {
        http_response_code(401);
        die(json_encode(['error' => 'Usuário não encontrado ou desativado.']));
    }

    return $user;
}

// ── Verifica permissão por role ──────────────────────────────────────────
function requireRole(array $roles, array $user): void {
    if (!in_array($user['role'], $roles)) {
        http_response_code(403);
        die(json_encode(['error' => 'Acesso negado para seu nível de usuário.']));
    }
}
