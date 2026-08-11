<?php
use App\Core\Csrf;
use App\Core\Money;
use App\Core\View;
/** @var array $plan */
?>
<form method="post" action="/cloud/<?= (int)$plan['id'] ?>" class="card">
  <?= Csrf::field() ?>
  <div class="card-title">Editar plano <?= View::e($plan['name']) ?></div>
  <div class="stack">
    <div><label class="label">Nome</label><input class="input" name="name" required value="<?= View::e($plan['name']) ?>"></div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Mensal</label><input class="input" name="monthly_price" data-money data-default="<?= (float)$plan['monthly_price'] ?>"></div>
      <div class="grow"><label class="label">Anual</label><input class="input" name="annual_price" data-money data-default="<?= (float)$plan['annual_price'] ?>"></div>
      <div class="grow"><label class="label">Piso mínimo</label><input class="input" name="min_price" data-money data-default="<?= (float)$plan['min_price'] ?>"></div>
    </div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Disco</label><input class="input" name="disk" value="<?= View::e($plan['disk'] ?? '') ?>"></div>
      <div class="grow"><label class="label">Tráfego</label><input class="input" name="traffic" value="<?= View::e($plan['traffic'] ?? '') ?>"></div>
    </div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Sites</label><input class="input" name="sites" value="<?= View::e($plan['sites'] ?? '') ?>"></div>
      <div class="grow"><label class="label">Caixas de e-mail</label><input class="input" name="mailboxes" value="<?= View::e($plan['mailboxes'] ?? '') ?>"></div>
      <div class="grow"><label class="label">Bancos</label><input class="input" name="databases" value="<?= View::e($plan['databases'] ?? '') ?>"></div>
    </div>
    <div class="row gap-2">
      <div class="grow"><label class="label">SSL</label><input class="input" name="ssl" value="<?= View::e($plan['ssl'] ?? '') ?>"></div>
      <div class="grow"><label class="label">Backup</label><input class="input" name="backup" value="<?= View::e($plan['backup'] ?? '') ?>"></div>
      <div class="grow"><label class="label">Suporte</label><input class="input" name="support" value="<?= View::e($plan['support'] ?? '') ?>"></div>
    </div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Migração</label><input class="input" name="migration" value="<?= View::e($plan['migration'] ?? '') ?>"></div>
    </div>
    <div><label class="label">Notas</label><textarea class="textarea" name="notes"><?= View::e($plan['notes'] ?? '') ?></textarea></div>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" value="1" <?= $plan['active'] ? 'checked' : '' ?>><span class="small">Ativo</span></label>
  </div>
  <button class="btn btn-primary btn-block mt-4" type="submit">Salvar</button>
</form>
