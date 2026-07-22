<?php
// /api/v1/admin — KPIs, financeiro, tickets, disputas, comissões, usuários
$user = requireAuth();
requireRole(['admin', 'operador'], $user);
$db = getDB();

// GET /admin/dashboard
if ($method === 'GET' && $id === 'dashboard') {
    $kpi = $db->query("
        SELECT
          (SELECT COALESCE(SUM(offered_value),0) FROM service_orders WHERE MONTH(created_at)=MONTH(CURRENT_DATE()) AND YEAR(created_at)=YEAR(CURRENT_DATE())) AS revenue_month,
          (SELECT COALESCE(SUM(commission_value),0) FROM service_orders WHERE status='paid_out' AND MONTH(completed_at)=MONTH(CURRENT_DATE()) AND YEAR(completed_at)=YEAR(CURRENT_DATE())) AS commission_month,
          (SELECT COUNT(*) FROM service_orders WHERE status IN ('published','matched','accepted','en_route','checked_in','in_progress')) AS active_orders,
          (SELECT COUNT(*) FROM service_orders WHERE MONTH(created_at)=MONTH(CURRENT_DATE()) AND YEAR(created_at)=YEAR(CURRENT_DATE())) AS orders_month,
          (SELECT COUNT(*) FROM companies WHERE status='ativa') AS companies_active,
          (SELECT COUNT(*) FROM installers WHERE status='aprovado') AS installers_active,
          (SELECT COUNT(*) FROM installers WHERE online=1 AND last_ping_at > (NOW() - INTERVAL 5 MINUTE)) AS installers_online,
          (SELECT COUNT(*) FROM support_tickets WHERE status IN ('aberto','em_atendimento')) AS open_tickets
    ")->fetch();
    $kpi['profit_month'] = (float)$kpi['commission_month'];
    json_out($kpi);
}

// GET /admin/financials
if ($method === 'GET' && $id === 'financials') {
    $summary = $db->query("
        SELECT
          (SELECT COALESCE(SUM(balance_cents),0)/100.0 FROM wallets w JOIN users u ON u.id=w.user_id WHERE u.role='instalador') AS installer_balances,
          (SELECT COALESCE(SUM(held_cents),0)/100.0 FROM wallets w JOIN users u ON u.id=w.user_id WHERE u.role='admin') AS escrow_held,
          (SELECT COALESCE(SUM(commission_value),0) FROM service_orders WHERE status='paid_out') AS commission_total,
          (SELECT COALESCE(SUM(gross_cents),0)/100.0 FROM payment_transactions WHERE status='captured' AND method='pix') /
            NULLIF((SELECT COALESCE(SUM(gross_cents),0)/100.0 FROM payment_transactions WHERE status='captured'), 0) AS pix_share
    ")->fetch();

    $payouts = $db->query("
        SELECT p.*, u.name AS installer_name FROM payouts p
        JOIN installers i ON i.id=p.installer_id
        JOIN users u ON u.id=i.user_id
        ORDER BY p.requested_at DESC LIMIT 100
    ")->fetchAll();

    json_out(['summary' => $summary, 'payouts' => $payouts]);
}

// GET /admin/commission-rules  |  POST (cria)  |  DELETE /:id
if ($id === 'commission-rules') {
    if ($method === 'GET') {
        json_out($db->query('SELECT * FROM commission_rules ORDER BY priority DESC, id')->fetchAll());
    }
    if ($method === 'POST') {
        $db->prepare('INSERT INTO commission_rules (category,level,pct,active,priority) VALUES (?,?,?,?,?)')
           ->execute([inp('category'), inp('level'), (float)inp('pct', DEFAULT_COMMISSION_PCT), (int)!!inp('active', 1), (int)inp('priority', 0)]);
        json_out(['ok' => true, 'id' => (int)$db->lastInsertId()], 201);
    }
    if ($method === 'DELETE' && $sub) {
        $db->prepare('DELETE FROM commission_rules WHERE id=?')->execute([(int)$sub]);
        json_out(['ok' => true]);
    }
}

// GET /admin/tickets  |  POST /:id/assign
if ($id === 'tickets') {
    if ($method === 'GET') {
        json_out($db->query('SELECT t.*, u.name AS user_name FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id ORDER BY FIELD(t.priority,"critica","alta","media","baixa"), t.created_at DESC LIMIT 100')->fetchAll());
    }
    if ($method === 'POST' && ctype_digit((string)$sub)) {
        $db->prepare('UPDATE support_tickets SET status=?, assigned_to=? WHERE id=?')
           ->execute([inp('status', 'em_atendimento'), $user['id'], (int)$sub]);
        json_out(['ok' => true]);
    }
}

// GET /admin/disputes  |  POST /:id/resolve
if ($id === 'disputes') {
    if ($method === 'GET') {
        json_out($db->query('SELECT d.*, o.os_number FROM disputes d JOIN service_orders o ON o.id=d.order_id ORDER BY d.created_at DESC LIMIT 100')->fetchAll());
    }
    if ($method === 'POST' && ctype_digit((string)$sub)) {
        $db->prepare("UPDATE disputes SET status='resolvida', resolution=?, resolved_by=?, resolved_at=NOW() WHERE id=?")
           ->execute([inp('resolution', ''), $user['id'], (int)$sub]);
        json_out(['ok' => true]);
    }
}

// GET /admin/users
if ($method === 'GET' && $id === 'users') {
    $q = $db->query('SELECT id,name,email,role,active,created_at,last_login FROM users ORDER BY created_at DESC LIMIT 500');
    json_out($q->fetchAll());
}

// GET /admin/audit
if ($method === 'GET' && $id === 'audit') {
    $q = $db->query('SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200');
    json_out($q->fetchAll());
}

// GET /admin/heatmap — pontos de OS ativas (para painel Brasil)
if ($method === 'GET' && $id === 'heatmap') {
    $q = $db->query("SELECT lat,lng,address_city,address_state,status FROM service_orders WHERE status IN ('published','matched','accepted','en_route','checked_in','in_progress') AND lat IS NOT NULL");
    json_out($q->fetchAll());
}

bad('Rota não encontrada.', 404);
