<?php
// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — Ledger financeiro (append-only), carteira, comissão, escrow
// Regra: saldo é sempre derivado do ledger. Nunca alterar saldo diretamente.
// ══════════════════════════════════════════════════════════════════════════

function ensureWallet(int $userId): int {
    $db = getDB();
    $stmt = $db->prepare("SELECT id FROM wallets WHERE user_id=?");
    $stmt->execute([$userId]);
    $id = $stmt->fetchColumn();
    if ($id) return (int)$id;
    $db->prepare("INSERT INTO wallets (user_id,balance_cents,held_cents) VALUES (?,0,0)")
       ->execute([$userId]);
    return (int)$db->lastInsertId();
}

/**
 * Grava lançamento imutável e atualiza cache de saldo/hold no wallets.
 * Sempre dentro de transação para evitar race condition.
 */
function ledgerAppend(int $walletId, string $entryType, int $amountCents, ?int $orderId = null, string $description = '', string $reference = ''): int {
    $db = getDB();
    $db->beginTransaction();
    try {
        $lock = $db->prepare("SELECT balance_cents, held_cents FROM wallets WHERE id=? FOR UPDATE");
        $lock->execute([$walletId]);
        $w = $lock->fetch();
        if (!$w) throw new RuntimeException("Carteira $walletId não encontrada.");

        $balance = (int)$w['balance_cents'];
        $held    = (int)$w['held_cents'];

        switch ($entryType) {
            case 'credit':
            case 'release':
            case 'refund':
                $balance += $amountCents;
                if ($entryType === 'release') $held -= $amountCents;
                break;
            case 'debit':
            case 'payout':
            case 'commission':
                $balance -= $amountCents;
                break;
            case 'hold':
                $balance -= $amountCents;
                $held    += $amountCents;
                break;
            case 'adjustment':
                $balance += $amountCents;
                break;
            default:
                throw new RuntimeException("entry_type inválido: $entryType");
        }
        if ($balance < 0) throw new RuntimeException('Saldo insuficiente.');
        if ($held < 0)    $held = 0;

        $ins = $db->prepare(
            "INSERT INTO ledger_entries (wallet_id,order_id,entry_type,amount_cents,balance_after,held_after,description,reference)
             VALUES (?,?,?,?,?,?,?,?)"
        );
        $ins->execute([$walletId, $orderId, $entryType, $amountCents, $balance, $held, $description, $reference]);
        $lid = (int)$db->lastInsertId();

        $db->prepare("UPDATE wallets SET balance_cents=?, held_cents=? WHERE id=?")
           ->execute([$balance, $held, $walletId]);

        $db->commit();
        return $lid;
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

/** Retorna comissão aplicada (percentual) para categoria/nível. */
function resolveCommissionPct(?string $category, ?string $level): float {
    $db = getDB();
    $stmt = $db->prepare(
        "SELECT pct FROM commission_rules
         WHERE active=1
           AND (category = ? OR category IS NULL)
           AND (level    = ? OR level    IS NULL)
         ORDER BY (category IS NOT NULL) DESC, (level IS NOT NULL) DESC, priority DESC
         LIMIT 1"
    );
    $stmt->execute([$category, $level]);
    $pct = $stmt->fetchColumn();
    return $pct !== false ? (float)$pct : (float)DEFAULT_COMMISSION_PCT;
}

/**
 * Fluxo de escrow:
 *   1. fundOrder  — empresa deposita, valor vai para "hold" na wallet da plataforma.
 *   2. releaseToInstaller — ao concluir, retira comissão e credita o líquido ao instalador.
 *   3. refundOrder — reverte (parcial ou total).
 */

function platformWalletId(): int {
    $db = getDB();
    $adminId = $db->query("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1")->fetchColumn();
    if (!$adminId) throw new RuntimeException('Nenhum admin encontrado para representar a plataforma.');
    return ensureWallet((int)$adminId);
}

function fundOrder(int $orderId, int $amountCents, int $payerUserId, string $reference = ''): void {
    $platformWid = platformWalletId();
    ledgerAppend($platformWid, 'credit', $amountCents, $orderId, "Aporte OS #$orderId (empresa $payerUserId)", $reference);
    ledgerAppend($platformWid, 'hold',   $amountCents, $orderId, "Retenção escrow OS #$orderId", $reference);
}

function releaseToInstaller(int $orderId): array {
    $db = getDB();
    $stmt = $db->prepare(
        "SELECT o.*, i.user_id AS installer_user_id, i.level
         FROM service_orders o
         LEFT JOIN installers i ON i.id = o.installer_id
         WHERE o.id=?"
    );
    $stmt->execute([$orderId]);
    $order = $stmt->fetch();
    if (!$order)                        throw new RuntimeException('OS não encontrada.');
    if (!$order['installer_user_id'])   throw new RuntimeException('OS sem instalador vinculado.');

    $gross      = (int)round(((float)$order['offered_value']) * 100);
    $pct        = resolveCommissionPct($order['category'], $order['level']);
    $commission = (int)round($gross * $pct / 100);
    $net        = $gross - $commission;

    $platformWid  = platformWalletId();
    $installerWid = ensureWallet((int)$order['installer_user_id']);

    ledgerAppend($platformWid,  'release',    $gross,      $orderId, "Liberação escrow OS #$orderId");
    ledgerAppend($platformWid,  'commission', $commission, $orderId, "Comissão OS #$orderId ({$pct}%)");
    ledgerAppend($platformWid,  'debit',      $net,        $orderId, "Transferência líquida OS #$orderId");
    ledgerAppend($installerWid, 'credit',     $net,        $orderId, "Crédito líquido OS #$orderId");

    getDB()->prepare("UPDATE service_orders SET commission_pct=?, commission_value=?, net_to_installer=?, status='paid_out' WHERE id=?")
       ->execute([$pct, $commission / 100, $net / 100, $orderId]);

    return ['gross' => $gross, 'commission' => $commission, 'net' => $net, 'pct' => $pct];
}

function refundOrder(int $orderId, int $refundCents, string $reason = ''): void {
    $platformWid = platformWalletId();
    $db = getDB();
    $stmt = $db->prepare("SELECT company_id, offered_value FROM service_orders WHERE id=?");
    $stmt->execute([$orderId]);
    $o = $stmt->fetch();
    if (!$o) throw new RuntimeException('OS não encontrada.');

    ledgerAppend($platformWid, 'release', $refundCents, $orderId, "Reembolso OS #$orderId — $reason");
    ledgerAppend($platformWid, 'refund',  $refundCents, $orderId, "Refund saída OS #$orderId — $reason");
    // A restituição efetiva ao meio de pagamento original é executada pelo PSP (webhook confirma).
}

function walletBalance(int $userId): array {
    $wid = ensureWallet($userId);
    $stmt = getDB()->prepare("SELECT balance_cents, held_cents FROM wallets WHERE id=?");
    $stmt->execute([$wid]);
    $row = $stmt->fetch() ?: ['balance_cents' => 0, 'held_cents' => 0];
    return [
        'wallet_id'      => $wid,
        'balance_cents'  => (int)$row['balance_cents'],
        'held_cents'     => (int)$row['held_cents'],
        'balance'        => (int)$row['balance_cents'] / 100,
        'held'           => (int)$row['held_cents'] / 100,
    ];
}
