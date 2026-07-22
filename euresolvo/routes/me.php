<?php
// /api/v1/me — dados do usuário logado + perfil (empresa/instalador) + KPIs
$user = requireAuth();
$db = getDB();

$out = ['user' => $user];

if ($user['role'] === 'empresa') {
    $stmt = $db->prepare('SELECT * FROM companies WHERE user_id=?');
    $stmt->execute([$user['id']]);
    $out['company'] = $stmt->fetch() ?: null;

    $bs = $db->prepare('SELECT * FROM company_branches WHERE company_id=?');
    $bs->execute([$out['company']['id'] ?? 0]);
    $out['branches'] = $bs->fetchAll();

    $kpi = $db->prepare(
        "SELECT
            SUM(status IN ('published','matched','accepted','en_route','checked_in','in_progress')) AS active,
            SUM(status IN ('completed','paid_out') AND MONTH(completed_at)=MONTH(CURRENT_DATE()) AND YEAR(completed_at)=YEAR(CURRENT_DATE())) AS done_month,
            SUM(offered_value) AS spent_all_time,
            SUM(CASE WHEN MONTH(created_at)=MONTH(CURRENT_DATE()) AND YEAR(created_at)=YEAR(CURRENT_DATE()) THEN offered_value ELSE 0 END) AS spent_month,
            COUNT(DISTINCT installer_id) AS partners
         FROM service_orders WHERE company_id=?"
    );
    $kpi->execute([$out['company']['id'] ?? 0]);
    $out['kpi'] = $kpi->fetch() ?: [];
}
elseif ($user['role'] === 'instalador') {
    $stmt = $db->prepare('SELECT * FROM installers WHERE user_id=?');
    $stmt->execute([$user['id']]);
    $out['installer'] = $stmt->fetch() ?: null;
    $out['wallet'] = walletBalance($user['id']);
}
elseif ($user['role'] === 'admin') {
    $out['wallet'] = walletBalance($user['id']);
}

json_out($out);
