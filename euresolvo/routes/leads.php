<?php
// /api/v1/leads — captura pública do site institucional + listagem admin
$db = getDB();

if ($method === 'POST' && !$id) {
    // Público — rate limit por IP
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    checkRateLimit("lead:$ip", 5, 300); // 5 leads a cada 5 min

    $kind = strtolower((string) inp('kind', ''));
    if (!in_array($kind, ['empresa','instalador'], true)) bad('kind inválido (empresa|instalador).');
    $name  = trim((string) inp('name', ''));
    $email = strtolower(trim((string) inp('email', '')));
    $phone = preg_replace('/\D/', '', (string) inp('phone', ''));
    if (strlen($name) < 3) bad('Informe seu nome.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) bad('E-mail inválido.');
    if (strlen($phone) < 10) bad('Telefone inválido.');

    $doc = preg_replace('/\D/', '', (string) inp('document', ''));
    if ($kind === 'empresa' && $doc && !validCNPJ($doc)) bad('CNPJ inválido.');
    if ($kind === 'instalador' && $doc && !validCPF($doc)) bad('CPF inválido.');

    $db->prepare("INSERT INTO leads (kind,name,email,phone,document,company_name,city,state,message,source,ip,user_agent)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
       ->execute([
        $kind, $name, $email, $phone, $doc,
        (string) inp('company_name', ''),
        (string) inp('city', ''),
        strtoupper((string) inp('state', '')),
        (string) inp('message', ''),
        (string) inp('source', 'site'),
        $ip,
        substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
    ]);
    $leadId = (int)$db->lastInsertId();
    n8nTrigger('lead-captured', ['id' => $leadId, 'kind' => $kind, 'name' => $name, 'email' => $email, 'phone' => $phone]);
    json_out(['ok' => true, 'id' => $leadId], 201);
}

// Admin
if ($method === 'GET' && !$id) {
    $user = requireAuth();
    requireRole(['admin','operador'], $user);
    $q = $db->query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 500');
    json_out($q->fetchAll());
}

if ($method === 'POST' && ctype_digit((string)$id) && $sub === 'status') {
    $user = requireAuth();
    requireRole(['admin','operador'], $user);
    $status = (string) inp('status', 'contatado');
    $db->prepare('UPDATE leads SET status=? WHERE id=?')->execute([$status, (int)$id]);
    json_out(['ok' => true]);
}

bad('Rota não encontrada.', 404);
