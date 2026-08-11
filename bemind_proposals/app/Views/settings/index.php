<?php
use App\Core\Csrf;
use App\Core\View;
/** @var array $s @var array $users */
$title = 'Configurações';
$backUrl = '/more';
?>
<form method="post" action="/settings" enctype="multipart/form-data" class="stack lg">
  <?= Csrf::field() ?>

  <div class="card">
    <div class="card-title">Empresa</div>
    <div class="row" style="align-items:center">
      <div style="width:48px;height:48px;border-radius:14px;background:#fff;border:1px solid var(--line-strong);display:flex;align-items:center;justify-content:center;overflow:hidden">
        <?php if (!empty($s['logo_path'])): ?><img src="<?= View::e($s['logo_path']) ?>" alt="" style="max-height:32px;max-width:32px"><?php else: ?>—<?php endif; ?>
      </div>
      <div class="grow"><label class="label">Novo logo</label>
        <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml"></div>
    </div>
    <div class="stack mt-4">
      <div><label class="label">Nome</label><input class="input" name="name" value="<?= View::e($s['name'] ?? '') ?>"></div>
      <div class="row gap-2">
        <div class="grow"><label class="label">CNPJ</label><input class="input" name="doc" value="<?= View::e($s['doc'] ?? '') ?>"></div>
        <div class="grow"><label class="label">WhatsApp</label><input class="input" name="whatsapp" value="<?= View::e($s['whatsapp'] ?? '') ?>"></div>
      </div>
      <div class="row gap-2">
        <div class="grow"><label class="label">E-mail</label><input class="input" name="email" type="email" value="<?= View::e($s['email'] ?? '') ?>"></div>
        <div class="grow"><label class="label">Site</label><input class="input" name="site" value="<?= View::e($s['site'] ?? '') ?>"></div>
      </div>
      <div><label class="label">Endereço</label><input class="input" name="address" value="<?= View::e($s['address'] ?? '') ?>"></div>
      <div class="row gap-2">
        <div class="grow"><label class="label">Prefixo das propostas</label><input class="input" name="proposal_prefix" value="<?= View::e($s['proposal_prefix'] ?? 'BEMIND-') ?>"></div>
        <div><label class="label">Validade padrão (dias)</label><input class="input" name="default_validity_days" type="number" min="1" value="<?= (int)($s['default_validity_days'] ?? 15) ?>"></div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">PIX</div>
    <div class="stack">
      <div class="row gap-2">
        <div><label class="label">Tipo</label>
          <select class="select" name="pix_key_type">
            <option value="">—</option>
            <?php foreach (['cpf','cnpj','email','celular','aleatoria'] as $t): ?>
              <option value="<?= $t ?>" <?= (($s['pix_key_type'] ?? '') === $t) ? 'selected' : '' ?>><?= $t ?></option>
            <?php endforeach; ?>
          </select>
        </div>
        <div class="grow"><label class="label">Chave</label><input class="input" name="pix_key" value="<?= View::e($s['pix_key'] ?? '') ?>"></div>
      </div>
      <div class="row gap-2">
        <div class="grow"><label class="label">Favorecido</label><input class="input" name="pix_holder" value="<?= View::e($s['pix_holder'] ?? '') ?>"></div>
        <div class="grow"><label class="label">Banco</label><input class="input" name="pix_bank" value="<?= View::e($s['pix_bank'] ?? '') ?>"></div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Preferências</div>
    <label style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line-soft)">
      <span>Mostrar PIX nas propostas</span>
      <input type="checkbox" name="show_pix_in_proposals" value="1" <?= !empty($s['show_pix_in_proposals']) ? 'checked' : '' ?>>
    </label>
    <label style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line-soft)">
      <span>Salvamento automático</span>
      <input type="checkbox" name="auto_save_enabled" value="1" <?= !empty($s['auto_save_enabled']) ? 'checked' : '' ?>>
    </label>
    <label style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
      <span>Modo escuro</span>
      <input type="checkbox" name="dark_mode" value="1" <?= !empty($s['dark_mode']) ? 'checked' : '' ?>>
    </label>
  </div>

  <div class="card">
    <div class="card-title">Equipe</div>
    <?php foreach ($users as $u): ?>
      <div class="list-item">
        <?php $name = $u['name']; include __DIR__ . '/../partials/avatar.php'; ?>
        <div class="grow">
          <div style="font:700 13.5px/1.2 var(--font-jkt)"><?= View::e($u['name']) ?></div>
          <div class="small muted"><?= View::e($u['email']) ?></div>
        </div>
        <span class="badge <?= $u['role']==='admin'?'aprovada':'enviada' ?>"><?= View::e($u['role']) ?></span>
      </div>
    <?php endforeach; ?>
  </div>

  <button class="btn btn-primary btn-block" type="submit">Salvar configurações</button>
</form>
