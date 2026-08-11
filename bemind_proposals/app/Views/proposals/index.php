<?php
use App\Core\Money;
use App\Core\View;
/** @var array $items @var string $status @var string $q */
$statuses = ['todas'=>'Todas','rascunho'=>'Rascunho','enviada'=>'Enviada','visualizada'=>'Visualizada','aprovada'=>'Aprovada','recusada'=>'Recusada'];
$currentFilter = $status ?: 'todas';
?>
<form method="get" action="/proposals" class="row" style="margin-bottom:10px">
  <input class="input" name="q" placeholder="Buscar por número, cliente ou título…" value="<?= View::e($q) ?>">
  <input type="hidden" name="status" value="<?= View::e($currentFilter) ?>">
  <button class="btn btn-secondary" type="submit">Buscar</button>
</form>

<div class="filterbar" data-filter-group="propostas">
  <?php foreach ($statuses as $key=>$label): ?>
    <span class="chip <?= $currentFilter === $key ? 'active' : '' ?>" data-filter-list="<?= $key ?>" data-filter-group="propostas"><?= View::e($label) ?></span>
  <?php endforeach; ?>
</div>

<div id="list-propostas" class="stack lg">
  <?php if (!$items): ?><div class="card muted center">Nenhuma proposta ainda.</div><?php endif; ?>
  <?php foreach ($items as $p):
      $viewed = $p['views_count'] > 0;
      $viewedLabel = $viewed ? ('Vista ' . (int)$p['views_count'] . 'x') : 'Sem visualização';
      $total = (float)$p['total_once'] + (float)$p['total_monthly'] * 12;
  ?>
    <a href="/proposals/<?= (int)$p['id'] ?>" class="card list-item" data-status="<?= View::e($p['status']) ?>" style="text-decoration:none;color:inherit;flex-direction:column;align-items:stretch">
      <div class="row" style="align-items:baseline">
        <div class="mono small muted"><?= View::e($p['number']) ?></div>
        <span class="spacer"></span>
        <span class="badge <?= View::e($p['status']) ?>"><?= View::e($p['status']) ?></span>
      </div>
      <div style="font:800 15px/1.25 var(--font-jkt);margin-top:6px"><?= View::e($p['client_name']) ?></div>
      <div class="small muted" style="margin-top:2px"><?= View::e($p['project'] ?: $p['title']) ?></div>
      <div class="row" style="align-items:baseline;margin-top:10px">
        <div class="small muted"><?= View::e($viewedLabel) ?></div>
        <span class="spacer"></span>
        <div class="tabular" style="font:800 17px/1 var(--font-jkt);color:var(--coral-text)"><?= Money::br($total) ?></div>
      </div>
    </a>
  <?php endforeach; ?>
</div>

<div class="row" style="justify-content:center;margin-top:14px">
  <a class="btn btn-primary" href="/proposals/express">＋ Express</a>
  <a class="btn btn-secondary" href="/proposals/new">Completa</a>
</div>
