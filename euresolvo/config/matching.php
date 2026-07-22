<?php
// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — Algoritmo de Match (empresa ↔ instalador)
// Score ponderado; pesos ajustáveis via .env sem tocar o código.
// ══════════════════════════════════════════════════════════════════════════

function matchWeights(): array {
    return [
        'distance'    => (float)(getenv('W_DISTANCE')    ?: 30),
        'specialty'   => (float)(getenv('W_SPECIALTY')   ?: 20),
        'rating'      => (float)(getenv('W_RATING')      ?: 15),
        'acceptance'  => (float)(getenv('W_ACCEPTANCE')  ?: 10),
        'cancel_rate' => (float)(getenv('W_CANCEL_RATE') ?: 10),
        'level'       => (float)(getenv('W_LEVEL')       ?: 10),
        'requirements' => (float)(getenv('W_REQUIREMENTS') ?: 5),
    ];
}

function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float {
    $r = 6371.0;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat/2)**2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng/2)**2;
    return $r * 2 * atan2(sqrt($a), sqrt(1 - $a));
}

function levelToNumber(string $lvl): int {
    return match($lvl) { 'bronze'=>1, 'prata'=>2, 'ouro'=>3, 'diamante'=>4, default=>1 };
}

/**
 * Busca instaladores candidatos para uma OS e retorna ranking com score.
 * @return array<int, array{installer_id:int,score:float,breakdown:array,distance_km:float}>
 */
function scoreInstallersFor(array $order, int $limit = 20): array {
    $db = getDB();
    $radius = (int)($order['search_radius_km'] ?? DEFAULT_SEARCH_RADIUS_KM);
    $lat = (float)$order['lat'];
    $lng = (float)$order['lng'];

    // Filtro geoespacial grosseiro por bounding box + refinamento em PHP
    $degLat = $radius / 111.0;
    $degLng = $radius / (111.0 * max(cos(deg2rad($lat)), 0.001));
    $minLat = $lat - $degLat; $maxLat = $lat + $degLat;
    $minLng = $lng - $degLng; $maxLng = $lng + $degLng;

    $stmt = $db->prepare(
        "SELECT i.*, u.name AS user_name
         FROM installers i
         JOIN users u ON u.id = i.user_id
         WHERE i.status='aprovado'
           AND i.available=1
           AND u.active=1
           AND i.base_lat BETWEEN ? AND ?
           AND i.base_lng BETWEEN ? AND ?"
    );
    $stmt->execute([$minLat, $maxLat, $minLng, $maxLng]);
    $candidates = $stmt->fetchAll();

    $reqStmt = $db->prepare("SELECT requirement FROM order_requirements WHERE order_id=?");
    $reqStmt->execute([$order['id']]);
    $reqs = array_column($reqStmt->fetchAll(), 'requirement');

    $weights = matchWeights();
    $ranked = [];

    foreach ($candidates as $c) {
        $dist = haversineKm($lat, $lng, (float)$c['base_lat'], (float)$c['base_lng']);
        if ($dist > (int)$c['service_radius_km']) continue; // fora da área de cobertura do instalador

        $breakdown = [];

        // Distância (mais perto = maior)
        $breakdown['distance']   = max(0.0, 1 - $dist / max(1, $radius)) * $weights['distance'];

        // Especialidade
        $specs = json_decode($c['specialties'] ?? '[]', true) ?: [];
        $breakdown['specialty']  = in_array($order['category'], $specs, true) ? $weights['specialty'] : 0;

        // Nota
        $rating = (float)$c['rating_avg'];
        $breakdown['rating']     = ($rating / 5.0) * $weights['rating'];

        // Taxa de aceitação (0-100)
        $breakdown['acceptance'] = ((float)$c['acceptance_rate'] / 100.0) * $weights['acceptance'];

        // Cancelamentos (menos = melhor)
        $total = max(1, (int)$c['completed_count'] + (int)$c['cancelled_count']);
        $cancelRate = (int)$c['cancelled_count'] / $total;
        $breakdown['cancel_rate'] = (1 - $cancelRate) * $weights['cancel_rate'];

        // Nível
        $breakdown['level']      = (levelToNumber($c['level']) / 4.0) * $weights['level'];

        // Ferramentas/certificações exigidas presentes
        $tools = json_decode($c['tools'] ?? '[]', true) ?: [];
        $missing = array_diff($reqs, $tools);
        $breakdown['requirements'] = (count($reqs) === 0 ? 1 : max(0.0, 1 - count($missing) / count($reqs))) * $weights['requirements'];

        $score = array_sum($breakdown);
        // Boost para online (+5)
        if ((int)$c['online'] === 1) $score += 5;

        $ranked[] = [
            'installer_id' => (int)$c['id'],
            'user_id'      => (int)$c['user_id'],
            'name'         => $c['user_name'],
            'level'        => $c['level'],
            'rating'       => $rating,
            'distance_km'  => round($dist, 2),
            'score'        => round($score, 3),
            'breakdown'    => array_map(fn($v) => round($v, 3), $breakdown),
        ];
    }

    usort($ranked, fn($a, $b) => $b['score'] <=> $a['score']);
    return array_slice($ranked, 0, $limit);
}

/** Emite ofertas (registros em `offers`) para os top-N candidatos. */
function sendOffers(int $orderId, array $candidates, int $topN = 5): int {
    if (empty($candidates)) return 0;
    $db = getDB();
    $expires = date('Y-m-d H:i:s', time() + OFFER_TTL_SECONDS);
    $ins = $db->prepare(
        "INSERT INTO offers (order_id,installer_id,score,score_breakdown,status,expires_at) VALUES (?,?,?,?,'pending',?)"
    );
    $count = 0;
    foreach (array_slice($candidates, 0, $topN) as $c) {
        try {
            $ins->execute([$orderId, $c['installer_id'], $c['score'], json_encode($c['breakdown']), $expires]);
            $count++;
        } catch (Throwable) { /* dedup por unique */ }
    }
    return $count;
}
