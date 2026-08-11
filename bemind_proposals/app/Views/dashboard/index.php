<?php
use App\Core\Csrf;
use App\Core\Money;
use App\Core\View;
/** @var array $user
 *  @var array $kpis
 *  @var float $approved
 *  @var float $ticket
 */
$name = explode(' ', (string)$user['name'])[0] ?? 'Maurílio';
?>
<h2 class="greeting">
  Olá, <?= View::e($name) ?> 👋
  <span class="sub">Vamos criar uma proposta que impressione seu próximo cliente.</span>
</h2>

<div class="cta-coral">
  <div class="kicker">Menos de 1 minuto</div>
  <h3>Proposta Express</h3>
  <div style="display:flex;gap:10px">
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
  <span class="label">Valor aprovado em <?= date('Y') ?></span>
  <div class="value tabular"><?= Money::br($approved) ?></div>
  <div style="margin-top:8px;font:600 12.5px/1 var(--font-mnr);color:var(--coral)">
    0 propostas aprovadas · ticket médio <?= Money::br($ticket) ?>
  </div>
</div>

<form method="post" action="/logout" style="margin-top:22px">
  <?= Csrf::field() ?>
  <button class="btn btn-secondary" type="submit" style="width:100%">Sair</button>
</form>
