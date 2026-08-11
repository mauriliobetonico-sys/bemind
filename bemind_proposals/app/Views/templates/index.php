<?php
use App\Core\View;
/** @var array $items */
$title = 'Modelos de proposta';
$backUrl = '/more';
?>
<p class="help" style="margin-bottom:12px">Salve propostas frequentes como modelo e reutilize em segundos.</p>

<div class="stack lg">
  <?php if (!$items): ?><div class="card muted center">Nenhum modelo ainda. Abra uma proposta e use "Salvar como modelo".</div><?php endif; ?>
  <?php foreach ($items as $t): $payload = json_decode($t['payload'], true) ?: []; ?>
    <div class="card">
      <div class="row">
        <div class="grow">
          <div style="font:800 15px/1.2 var(--font-jkt)"><?= View::e($t['name']) ?></div>
          <div class="small muted"><?= count($payload['items'] ?? []) ?> itens · criado <?= date('d/m/Y', strtotime($t['created_at'])) ?></div>
        </div>
      </div>
      <div class="row mt-4">
        <a class="btn btn-primary" href="/templates/<?= (int)$t['id'] ?>/new-proposal">Usar em nova proposta</a>
        <span class="spacer"></span>
        <form method="post" action="/templates/<?= (int)$t['id'] ?>/delete" onsubmit="return confirm('Excluir este modelo?')">
          <?= App\Core\Csrf::field() ?>
          <button class="link" type="submit" style="background:none;border:0;cursor:pointer">EXCLUIR</button>
        </form>
      </div>
    </div>
  <?php endforeach; ?>
</div>
