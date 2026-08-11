<?php
use App\Core\Csrf;
use App\Core\View;
/** @var array $u */
$isEdit = !empty($u['id']);
$action = $isEdit ? '/users/' . (int)$u['id'] : '/users';
$title  = $isEdit ? 'Editar usuário' : 'Novo usuário';
$backUrl = '/users';
?>
<form method="post" action="<?= $action ?>" class="card">
  <?= Csrf::field() ?>
  <div class="card-title"><?= $title ?></div>
  <div class="stack">
    <div><label class="label">Nome</label><input class="input" name="name" required value="<?= View::e($u['name'] ?? '') ?>"></div>
    <div><label class="label">E-mail</label><input class="input" name="email" type="email" required value="<?= View::e($u['email'] ?? '') ?>"></div>
    <div><label class="label">Papel</label>
      <select class="select" name="role">
        <?php foreach (['admin'=>'Administrador','comercial'=>'Comercial','editor'=>'Editor','viewer'=>'Leitura'] as $k=>$l): ?>
          <option value="<?= $k ?>" <?= (($u['role'] ?? 'comercial') === $k) ? 'selected' : '' ?>><?= View::e($l) ?></option>
        <?php endforeach; ?>
      </select>
    </div>
    <div><label class="label"><?= $isEdit ? 'Nova senha (opcional, ≥ 8)' : 'Senha (≥ 8 caracteres)' ?></label>
      <input class="input" name="password" type="password" <?= $isEdit ? '' : 'required minlength="8"' ?>>
    </div>
    <?php if ($isEdit): ?>
      <label style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" name="active" value="1" <?= !empty($u['active']) ? 'checked' : '' ?>>
        <span class="small">Usuário ativo</span>
      </label>
    <?php endif; ?>
  </div>
  <button class="btn btn-primary btn-block mt-4" type="submit"><?= $isEdit ? 'Salvar' : 'Convidar' ?></button>
</form>
