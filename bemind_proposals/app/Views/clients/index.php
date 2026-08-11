<?php
use App\Core\Money;
use App\Core\View;
/** @var array $clients @var string $q */
?>
<form method="get" action="/clients" class="row" style="margin-bottom:12px">
  <input class="input" name="q" placeholder="Buscar cliente…" value="<?= View::e($q) ?>">
  <button class="btn btn-secondary" type="submit">Buscar</button>
</form>

<div class="card">
  <div class="card-title">Clientes <span class="muted" style="margin-left:auto;font-weight:500"><?= count($clients) ?></span></div>
  <?php if (!$clients): ?>
    <p class="muted">Nenhum cliente ainda.</p>
  <?php endif; ?>
  <?php foreach ($clients as $c): ?>
    <a class="list-item" href="/clients/<?= (int)$c['id'] ?>" style="text-decoration:none;color:inherit">
      <?php $name = $c['company_name']; include __DIR__ . '/../partials/avatar.php'; ?>
      <div class="grow">
        <div style="font:800 15px/1.2 var(--font-jkt)"><?= View::e($c['company_name']) ?></div>
        <div class="small muted"><?= View::e($c['segment'] ?: '—') ?> · <?= (int)$c['proposals_count'] ?> propostas</div>
      </div>
      <div class="tabular" style="font:800 15px/1 var(--font-jkt);color:var(--coral-text)"><?= Money::br((float)$c['total_contracted']) ?></div>
    </a>
  <?php endforeach; ?>
</div>

<a class="btn btn-primary btn-block mt-4" href="/clients/new">＋ Novo cliente</a>
