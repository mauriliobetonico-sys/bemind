<?php
use App\Core\Csrf;
use App\Core\View;
/** @var array $clients */
$title = 'Novo briefing';
?>
<form method="post" action="/briefings" class="card">
  <?= Csrf::field() ?>
  <div class="card-title">Novo briefing</div>
  <div class="stack">
    <div><label class="label">Cliente (se já existe)</label>
      <select class="select" name="client_id">
        <option value="">—</option>
        <?php foreach ($clients as $c): ?><option value="<?= (int)$c['id'] ?>"><?= View::e($c['company_name']) ?></option><?php endforeach; ?>
      </select>
    </div>
    <div><label class="label">Nome do contato (se novo)</label>
      <input class="input" name="contact_name"></div>
    <div><label class="label">E-mail do contato</label>
      <input class="input" name="contact_email" type="email"></div>
    <div><label class="label">Tipo</label>
      <input class="input" name="kind" placeholder="Ex.: Redes sociais, Site, Branding…"></div>
  </div>
  <button class="btn btn-primary btn-block mt-4" type="submit">Gerar link do briefing</button>
</form>
