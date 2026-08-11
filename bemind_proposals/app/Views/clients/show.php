<?php
use App\Core\Money;
use App\Core\View;
/** @var array $c @var array $stats @var array $proposals */
?>
<div class="card">
  <div class="row" style="align-items:flex-start">
    <?php $name = $c['company_name']; $size='lg'; include __DIR__ . '/../partials/avatar.php'; ?>
    <div class="grow">
      <div style="font:800 20px/1.15 var(--font-jkt);letter-spacing:-.025em"><?= View::e($c['company_name']) ?></div>
      <div class="small muted mono"><?= View::e($c['doc'] ?: '—') ?></div>
    </div>
    <a class="link" href="/clients/<?= (int)$c['id'] ?>/edit">EDITAR</a>
  </div>
  <div class="divider"></div>
  <div class="stack">
    <div class="row"><span class="label" style="width:130px">Responsável</span><span class="grow"><?= View::e($c['contact_name'] ?: '—') ?></span></div>
    <div class="row"><span class="label" style="width:130px">E-mail</span><span class="grow"><?= View::e($c['email'] ?: '—') ?></span></div>
    <div class="row"><span class="label" style="width:130px">WhatsApp</span><span class="grow"><?= View::e($c['whatsapp'] ?: '—') ?></span></div>
    <div class="row"><span class="label" style="width:130px">Cidade</span><span class="grow"><?= View::e(trim(($c['city'] ?? '') . ' ' . ($c['state'] ? '/'.$c['state'] : ''))) ?: '—' ?></span></div>
    <div class="row"><span class="label" style="width:130px">Cliente desde</span><span class="grow"><?= View::e(date('d/m/Y', strtotime($c['created_at']))) ?></span></div>
  </div>
</div>

<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
  <div class="kpi"><div class="n tabular"><?= (int)$stats['total'] ?></div><span class="l">Propostas</span></div>
  <div class="kpi"><div class="n tabular" style="color:#1E7A45"><?= (int)$stats['approved'] ?></div><span class="l">Aprovadas</span></div>
  <div class="kpi"><div class="n tabular" style="color:#B23A2E"><?= (int)$stats['declined'] ?></div><span class="l">Recusadas</span></div>
</div>

<div class="ink-card">
  <span class="label">Total contratado</span>
  <div class="value coral tabular"><?= Money::br((float)$stats['contracted']) ?></div>
</div>

<div class="card">
  <div class="card-title">Propostas</div>
  <?php if (!$proposals): ?><p class="muted">Nenhuma proposta ainda.</p><?php endif; ?>
  <?php foreach ($proposals as $p): $total = (float)$p['total_once'] + (float)$p['total_monthly']*12; ?>
    <a class="list-item" href="/proposals/<?= (int)$p['id'] ?>" style="text-decoration:none;color:inherit">
      <div class="grow">
        <div style="font:700 13.5px/1.25 var(--font-jkt)"><?= View::e($p['title']) ?></div>
        <div class="small muted mono"><?= View::e($p['number']) ?></div>
      </div>
      <span class="badge <?= View::e($p['status']) ?>"><?= View::e($p['status']) ?></span>
      <div class="tabular" style="font:800 14px/1 var(--font-jkt);color:var(--coral-text);margin-left:8px"><?= Money::br($total) ?></div>
    </a>
  <?php endforeach; ?>
</div>

<a class="btn btn-primary btn-block mt-4" href="/proposals/express?client_id=<?= (int)$c['id'] ?>">Nova proposta para este cliente</a>
