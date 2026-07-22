<?php
// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — Autenticação JWT (HS256) + Refresh Tokens
// ══════════════════════════════════════════════════════════════════════════

function jwtEncode(array $payload): string {
    $header  = base64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
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

function generateToken(array $user): string {
    return jwtEncode([
        'sub'   => (int)$user['id'],
        'email' => $user['email'],
        'role'  => $user['role'],
        'name'  => $user['name'],
        'iat'   => time(),
        'exp'   => time() + JWT_EXPIRES,
    ]);
}

function generateRefreshToken(int $userId, string $ip = '', string $ua = ''): string {
    $token     = bin2hex(random_bytes(40));
    $tokenHash = hash('sha256', $token);
    $expiresAt = date('Y-m-d H:i:s', time() + JWT_REFRESH_EXPIRES);

    $db = getDB();
    $db->prepare("DELETE FROM refresh_tokens WHERE user_id=? AND (expires_at < NOW() OR revoked=1)")
       ->execute([$userId]);

    $db->prepare("INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent) VALUES (?,?,?,?,?)")
       ->execute([$userId, $tokenHash, $expiresAt, $ip, substr($ua, 0, 255)]);

    return $token;
}

function useRefreshToken(string $token): ?array {
    $hash = hash('sha256', $token);
    $db = getDB();
    $stmt = $db->prepare(
        "SELECT rt.id, u.id AS user_id, u.name, u.email, u.role, u.active
         FROM refresh_tokens rt
         JOIN users u ON rt.user_id = u.id
         WHERE rt.token_hash=? AND rt.revoked=0 AND rt.expires_at > NOW()"
    );
    $stmt->execute([$hash]);
    $row = $stmt->fetch();
    if (!$row || !$row['active']) return null;
    $db->prepare("UPDATE refresh_tokens SET revoked=1 WHERE id=?")->execute([$row['id']]);
    return $row;
}

function currentUserOrNull(): ?array {
    $auth = $_SERVER['HTTP_AUTHORIZATION']
         ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
         ?? '';
    $token = null;
    if (preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) $token = $m[1];
    if (!$token && !empty($_GET['token'])) $token = $_GET['token'];
    if (!$token) return null;
    $payload = jwtDecode($token);
    if (!$payload) return null;
    try {
        $stmt = getDB()->prepare('SELECT id,name,email,role,active FROM users WHERE id=? AND active=1');
        $stmt->execute([$payload['sub']]);
        return $stmt->fetch() ?: null;
    } catch (Throwable) {
        return null;
    }
}

function requireAuth(): array {
    $user = currentUserOrNull();
    if (!$user) {
        http_response_code(401);
        die(json_encode(['error' => 'Não autenticado.', 'code' => 'AUTH_REQUIRED']));
    }
    return $user;
}

function requireRole(array $roles, array $user): void {
    if (!in_array($user['role'], $roles, true)) {
        http_response_code(403);
        die(json_encode(['error' => 'Acesso negado para seu perfil.', 'code' => 'FORBIDDEN']));
    }
}

// Validação de CPF (algoritmo oficial)
function validCPF(string $cpf): bool {
    $cpf = preg_replace('/\D/', '', $cpf);
    if (strlen($cpf) !== 11 || preg_match('/^(\d)\1{10}$/', $cpf)) return false;
    for ($t = 9; $t < 11; $t++) {
        $sum = 0;
        for ($i = 0; $i < $t; $i++) $sum += (int)$cpf[$i] * (($t + 1) - $i);
        $d = (($sum * 10) % 11) % 10;
        if ((int)$cpf[$t] !== $d) return false;
    }
    return true;
}

// Validação de CNPJ (algoritmo oficial)
function validCNPJ(string $cnpj): bool {
    $cnpj = preg_replace('/\D/', '', $cnpj);
    if (strlen($cnpj) !== 14 || preg_match('/^(\d)\1{13}$/', $cnpj)) return false;
    $weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    $weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    $sum = 0;
    for ($i = 0; $i < 12; $i++) $sum += (int)$cnpj[$i] * $weights1[$i];
    $d1 = $sum % 11 < 2 ? 0 : 11 - ($sum % 11);
    if ((int)$cnpj[12] !== $d1) return false;
    $sum = 0;
    for ($i = 0; $i < 13; $i++) $sum += (int)$cnpj[$i] * $weights2[$i];
    $d2 = $sum % 11 < 2 ? 0 : 11 - ($sum % 11);
    return (int)$cnpj[13] === $d2;
}

function auditLog(?int $userId, string $action, ?string $entityType = null, ?int $entityId = null, ?array $payload = null): void {
    try {
        getDB()->prepare("INSERT INTO audit_logs (user_id,action,entity_type,entity_id,payload,ip_address,user_agent) VALUES (?,?,?,?,?,?,?)")
            ->execute([
                $userId, $action, $entityType, $entityId,
                $payload ? json_encode($payload, JSON_UNESCAPED_UNICODE) : null,
                $_SERVER['REMOTE_ADDR'] ?? null,
                substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
            ]);
    } catch (Throwable) { /* nunca quebra a request */ }
}
