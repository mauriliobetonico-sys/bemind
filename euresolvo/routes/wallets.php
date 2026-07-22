<?php
// /api/v1/wallets — saldo, extrato e saque via PIX
$user = requireAuth();
$db = getDB();

// GET /wallets/me
if ($method === 'GET' && $id === 'me') {
    json_out(walletBalance($user['id']));
}

// GET /wallets/me/statement — extrato
if ($method === 'GET' && $id === 'me' && $sub === 'statement') {
    $wid = ensureWallet($user['id']);
    $q = $db->prepare('SELECT id,entry_type,amount_cents,balance_after,description,reference,order_id,created_at FROM ledger_entries WHERE wallet_id=? ORDER BY id DESC LIMIT 200');
    $q->execute([$wid]);
    json_out($q->fetchAll());
}

// POST /wallets/me/payout — instalador solicita saque PIX
if ($method === 'POST' && $id === 'me' && $sub === 'payout') {
    requireRole(['instalador'], $user);
    $amount = (float) inp('amount', 0);
    if ($amount <= 0) bad('Valor inválido.');
    $amountCents = (int) round($amount * 100);

    $iStmt = $db->prepare('SELECT * FROM installers WHERE user_id=?');
    $iStmt->execute([$user['id']]);
    $installer = $iStmt->fetch();
    if (!$installer) bad('Instalador não encontrado.', 404);
    if ($installer['status'] !== 'aprovado') bad('Instalador ainda não aprovado.', 403);
    if (empty($installer['pix_key'])) bad('Cadastre uma chave PIX antes de sacar.');

    $bal = walletBalance($user['id']);
    if ($amountCents > $bal['balance_cents']) bad('Saldo insuficiente.', 422);

    $wid = $bal['wallet_id'];
    $db->beginTransaction();
    try {
        // Debita já; se falhar no PSP, registra failed e devolve via adjustment
        ledgerAppend($wid, 'payout', $amountCents, null, 'Saque PIX solicitado', 'payout-req');
        $db->prepare("INSERT INTO payouts (installer_id,wallet_id,amount_cents,method,pix_key,status,provider) VALUES (?,?,?,?,?,?,?)")
           ->execute([$installer['id'], $wid, $amountCents, 'pix', $installer['pix_key'], 'pending', 'mercadopago']);
        $payoutId = (int)$db->lastInsertId();
        $db->commit();
    } catch (Throwable $e) { $db->rollBack(); throw $e; }

    // Envia ao PSP (async-ish; em produção enfileirar)
    try {
        $res = mpPayoutPix((array)$installer, $amountCents);
        $db->prepare("UPDATE payouts SET status='processing', provider_ref=?, sent_at=NOW() WHERE id=?")
           ->execute([(string)($res['id'] ?? ''), $payoutId]);
    } catch (Throwable $e) {
        // Falhou — devolve saldo e marca como failed
        ledgerAppend($wid, 'adjustment', $amountCents, null, 'Reversão de saque (falha)', 'payout-fail');
        $db->prepare("UPDATE payouts SET status='failed', error_message=? WHERE id=?")
           ->execute([$e->getMessage(), $payoutId]);
        bad('Falha no PSP: ' . $e->getMessage(), 502, 'PSP_ERROR');
    }
    auditLog($user['id'], 'wallet.payout', 'payout', $payoutId, ['amount_cents' => $amountCents]);
    json_out(['ok' => true, 'payout_id' => $payoutId]);
}

// GET /wallets/user/:id  (admin)
if ($method === 'GET' && $id === 'user' && ctype_digit((string)$sub)) {
    requireRole(['admin','operador'], $user);
    json_out(walletBalance((int)$sub));
}

bad('Rota não encontrada.', 404);
