<?php
use App\Core\Money;
use App\Core\View;
/** @var array $categories @var array $services @var ?int $currentCat */
?>
<div class="alert coral" style="margin-bottom:12px">Preços padrão puxados para cada proposta e editáveis a qualquer momento.</div>

<div class="chip-row scroll" style="margin-bottom:12px">
  <a class="chip <?= $currentCat === null ? 'active' : '' ?>" href="/services">Todas</a>
  <?php foreach ($categories as $cat): ?>
    <a class="chip <?= ($currentCat === (int)$cat['id']) ? 'active' : '' ?>" href="/services?cat=<?= (int)$cat['id'] ?>"><?= View::e(mb_strtoupper($cat['name'])) ?></a>
  <?php endforeach; ?>
</div>

<div class="card">
  <div class="card-title">Biblioteca de serviços</div>
  <?php foreach ($services as $s): ?>
    <div class="list-item">
      <div class="grow">
        <div style="font:700 14px/1.25 var(--font-jkt)"><?= View::e($s['name']) ?></div>
        <div class="small muted"><?= View::e($s['recurrence']) ?> · <?= View::e($s['category_name']) ?><?= $s['active'] ? '' : ' · inativo' ?></div>
      </div>
      <div class="tabular" style="font:800 14px/1 var(--font-jkt);color:var(--coral-text)"><?= Money::br((float)$s['default_price']) ?></div>
      <a class="link" style="margin-left:8px" href="/services/<?= (int)$s['id'] ?>/edit">EDITAR</a>
    </div>
  <?php endforeach; ?>
</div>

<a class="btn btn-primary btn-block mt-4" href="/services/new">＋ Novo serviço na biblioteca</a>
