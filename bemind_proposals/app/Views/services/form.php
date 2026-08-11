<?php
use App\Core\Csrf;
use App\Core\View;
/** @var array $s @var array $categories */
$isEdit = !empty($s['id']);
$action = $isEdit ? '/services/' . (int)$s['id'] : '/services';
$del    = $s['deliverables'] ?? null;
if (is_string($del)) $del = json_decode($del, true) ?: [];
$delText = is_array($del) ? implode("\n", $del) : '';
?>
<form method="post" action="<?= $action ?>" class="card">
  <?= Csrf::field() ?>
  <div class="card-title"><?= $isEdit ? 'Editar serviço' : 'Novo serviço' ?></div>
  <div class="stack">
    <div><label class="label">Nome</label>
      <input class="input" name="name" required value="<?= View::e($s['name'] ?? '') ?>"></div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Categoria</label>
        <select class="select" name="category_id" required>
          <?php foreach ($categories as $c): ?>
            <option value="<?= (int)$c['id'] ?>" <?= (isset($s['category_id']) && (int)$s['category_id'] === (int)$c['id']) ? 'selected' : '' ?>><?= View::e($c['name']) ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <div><label class="label">Ordem</label><input class="input" name="sort_order" type="number" value="<?= (int)($s['sort_order'] ?? 0) ?>"></div>
    </div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Preço padrão</label>
        <input class="input" name="default_price" data-money data-default="<?= (float)($s['default_price'] ?? 0) ?>"></div>
      <div><label class="label">Unidade</label>
        <select class="select" name="unit">
          <?php foreach (['projeto','hora','mes','ano','unidade','pacote'] as $u): ?>
            <option value="<?= $u ?>" <?= (($s['unit'] ?? '') === $u) ? 'selected' : '' ?>><?= $u ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <div><label class="label">Recorrência</label>
        <select class="select" name="recurrence">
          <?php foreach (['unico','mensal','anual'] as $r): ?>
            <option value="<?= $r ?>" <?= (($s['recurrence'] ?? 'unico') === $r) ? 'selected' : '' ?>><?= $r ?></option>
          <?php endforeach; ?>
        </select>
      </div>
    </div>
    <div><label class="label">Descrição curta</label>
      <input class="input" name="short_description" value="<?= View::e($s['short_description'] ?? '') ?>"></div>
    <div><label class="label">Descrição completa</label>
      <textarea class="textarea" name="full_description"><?= View::e($s['full_description'] ?? '') ?></textarea></div>
    <div><label class="label">Entregáveis (um por linha)</label>
      <textarea class="textarea" name="deliverables"><?= View::e($delText) ?></textarea></div>
    <div><label class="label">Prazo</label>
      <input class="input" name="lead_time" value="<?= View::e($s['lead_time'] ?? '') ?>"></div>
    <label style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" name="active" value="1" <?= !isset($s['active']) || $s['active'] ? 'checked' : '' ?>>
      <span class="small">Ativo na biblioteca</span>
    </label>
  </div>
  <button class="btn btn-primary btn-block mt-4" type="submit"><?= $isEdit ? 'Salvar' : 'Cadastrar' ?></button>
</form>
