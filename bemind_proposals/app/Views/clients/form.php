<?php
use App\Core\Csrf;
use App\Core\View;
/** @var array $c */
$isEdit = !empty($c['id']);
$action = $isEdit ? '/clients/' . (int)$c['id'] : '/clients';
?>
<form method="post" action="<?= $action ?>" class="card">
  <?= Csrf::field() ?>
  <div class="card-title"><?= $isEdit ? 'Editar cliente' : 'Novo cliente' ?></div>
  <div class="stack">
    <div><label class="label">Razão social</label>
      <input class="input" name="company_name" required value="<?= View::e($c['company_name'] ?? '') ?>"></div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Nome fantasia</label>
        <input class="input" name="trade_name" value="<?= View::e($c['trade_name'] ?? '') ?>"></div>
      <div class="grow"><label class="label">CNPJ/CPF</label>
        <input class="input" name="doc" value="<?= View::e($c['doc'] ?? '') ?>"></div>
    </div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Responsável</label>
        <input class="input" name="contact_name" value="<?= View::e($c['contact_name'] ?? '') ?>"></div>
      <div class="grow"><label class="label">E-mail</label>
        <input class="input" name="email" type="email" value="<?= View::e($c['email'] ?? '') ?>"></div>
    </div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Telefone</label>
        <input class="input" name="phone" value="<?= View::e($c['phone'] ?? '') ?>"></div>
      <div class="grow"><label class="label">WhatsApp</label>
        <input class="input" name="whatsapp" value="<?= View::e($c['whatsapp'] ?? '') ?>"></div>
    </div>
    <div class="row gap-2">
      <div class="grow"><label class="label">Cidade</label>
        <input class="input" name="city" value="<?= View::e($c['city'] ?? '') ?>"></div>
      <div><label class="label">UF</label>
        <input class="input" name="state" maxlength="2" style="width:70px" value="<?= View::e($c['state'] ?? '') ?>"></div>
    </div>
    <div><label class="label">Segmento</label>
      <input class="input" name="segment" value="<?= View::e($c['segment'] ?? '') ?>"></div>
    <div><label class="label">Observações</label>
      <textarea class="textarea" name="notes"><?= View::e($c['notes'] ?? '') ?></textarea></div>
  </div>
  <button class="btn btn-primary btn-block mt-4" type="submit"><?= $isEdit ? 'Salvar alterações' : 'Cadastrar cliente' ?></button>
</form>
