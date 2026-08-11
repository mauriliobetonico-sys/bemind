<?php
use App\Core\Money;
use App\Core\View;
/** @var array $user
 *  @var array $kpis
 *  @var float $approved
 *  @var float $ticket
 *  @var array $performance
 *  @var array $activity
 *  @var int   $year
 */
$name = explode(' ', (string)$user['name'])[0] ?? 'Maurílio';
$title = 'Início';
?>
<h2 class="greeting">
  Olá, <?= View::e($name) ?> 👋
  <span class="sub">Vamos criar uma proposta que impressione seu próximo cliente.</span>
</h2>

<div class="cta-coral">
  <div class="kicker">Menos de 1 minuto</div>
  <h3>Proposta Express</h3>
  <div class="row">
    <a class="btn" style="background:#fff;color:var(--ink)" href="/proposals/express">Criar agora</a>
    <a class="btn" style="background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.35)" href="/proposals/new">Completa</a>
  </div>
</div>

<div class="kpi-grid">
  <?php foreach ($kpis as $k): ?>
    <div class="kpi">
      <div class="n tabular" style="color: <?= View::e($k['color']) ?>"><?= (int)$k['value'] ?></div>
      <span class="l"><?= View::e($k['label']) ?></span>
    </div>
  <?php endforeach; ?>
</div>

<div class="ink-card">
  <span class="label">Valor aprovado em <?= (int)$year ?></span>
  <div class="value tabular"><?= Money::br($approved) ?></div>
  <div style="margin-top:8px;font:600 12.5px/1 var(--font-mnr);color:var(--coral)">
    <?= (int)$kpis[3]['value'] ?> propostas aprovadas · ticket médio <?= Money::br($ticket) ?>
  </div>
</div>

<div class="card">
  <div class="card-title">Desempenho das propostas</div>
  <div class="bars">
    <?php foreach ($performance as $p): ?>
      <div class="bar">
        <div class="lbl"><?= View::e($p['label']) ?></div>
        <div class="track"><div class="fill" style="width: <?= (int)$p['pct'] ?>%"></div></div>
        <div class="num tabular"><?= (int)$p['value'] ?></div>
      </div>
    <?php endforeach; ?>
  </div>
</div>

<div class="card">
  <div class="card-title">Atividade recente <a class="link" href="/notifications" style="margin-left:auto;font-weight:700">Ver tudo</a></div>
  <?php if (!$activity): ?>
    <p class="muted">Nenhuma atividade ainda.</p>
  <?php endif; ?>
  <div class="activity">
    <?php $dotColors = ['created'=>'#6B7078','sent'=>'#2A5DB0','viewed'=>'#A15C00','accepted'=>'#1E7A45','declined'=>'#B23A2E','change_requested'=>'#6B3FA0','renewed'=>'#1E7A45']; ?>
    <?php foreach ($activity as $a): $c = $dotColors[$a['action']] ?? '#6B7078'; ?>
      <div class="row">
        <div class="dot" style="background: <?= $c ?>"></div>
        <div class="txt"><?= View::e(ucfirst($a['action'])) ?> · <span class="mono"><?= View::e($a['number'] ?: '') ?></span></div>
        <div class="when tabular"><?= View::e(date('d/m H:i', strtotime($a['created_at']))) ?></div>
      </div>
    <?php endforeach; ?>
  </div>
</div>
