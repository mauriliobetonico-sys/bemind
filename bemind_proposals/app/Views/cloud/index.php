<?php
use App\Core\Money;
use App\Core\View;
/** @var array $plans */
?>
<div class="ink-card" style="padding:24px">
  <span class="kicker" style="color:var(--coral);font:800 12px/1 var(--font-mnr);letter-spacing:.22em;text-transform:uppercase">Be Mind Cloud</span>
  <h3 style="font:800 22px/1.15 var(--font-jkt);margin:8px 0 6px">Infra brasileira, backup diário e suporte humano.</h3>
  <div class="small" style="color:rgba(255,255,255,.7)">A partir de <strong>R$ 150,00/mês</strong>.</div>
</div>

<div class="alert coral mt-4"><strong>R$ 150,00</strong> é o piso configurado. Você pode alterar qualquer valor manualmente na proposta.</div>

<div class="stack mt-4">
  <?php foreach ($plans as $p): $highlight = ($p['name'] === 'Básico'); ?>
    <div class="card" style="<?= $highlight ? 'border-color:var(--coral)' : '' ?>">
      <div class="row" style="align-items:baseline">
        <div class="grow" style="font:800 18px/1 var(--font-jkt)"><?= View::e($p['name']) ?></div>
        <div class="tabular" style="font:800 24px/1 var(--font-jkt);color:var(--coral-text)"><?= Money::br((float)$p['monthly_price']) ?><span class="small muted">/mês</span></div>
      </div>
      <div class="chip-row" style="margin-top:10px">
        <?php foreach (array_filter([
            $p['disk'] ?? null, $p['traffic'] ?? null, $p['sites'] ?? null,
            $p['mailboxes'] ?? null, $p['databases'] ?? null, $p['ssl'] ?? null,
            $p['backup'] ?? null, $p['support'] ?? null,
        ]) as $spec): ?>
          <span class="chip"><?= View::e($spec) ?></span>
        <?php endforeach; ?>
      </div>
      <div class="row mt-2">
        <span class="small muted">Anual: <?= Money::br((float)$p['annual_price']) ?></span>
        <span class="spacer"></span>
        <a class="link" href="/cloud/<?= (int)$p['id'] ?>/edit">EDITAR PLANO</a>
      </div>
    </div>
  <?php endforeach; ?>
</div>
