<?php
use App\Core\View;
/** @var array $prop @var string $name @var string $email @var string $doc @var string $ip @var array $settings */
$title = 'Proposta aprovada · Be Mind Marketing';
$logo  = $settings['logo_path'] ?? null;
?>
<header class="hero" style="text-align:center">
  <?php if ($logo): ?><div class="logo-card"><img src="<?= View::e($logo) ?>" alt=""></div><?php endif; ?>
  <div style="width:78px;height:78px;border-radius:50%;background:#E7F6EC;color:#1E7A45;
              display:inline-flex;align-items:center;justify-content:center;
              font:800 36px/1 var(--font-jkt);margin:14px 0 10px">✓</div>
  <h1>Proposta aprovada</h1>
  <div class="prepared">Obrigado! Vamos começar imediatamente.</div>
</header>

<section>
  <div class="card">
    <div class="card-kicker">Registro do aceite</div>
    <div class="stack">
      <div class="row"><span class="label" style="width:130px">Proposta</span><span class="mono grow"><?= View::e($prop['number']) ?></span></div>
      <div class="row"><span class="label" style="width:130px">Nome</span><span class="grow"><?= View::e($name) ?></span></div>
      <div class="row"><span class="label" style="width:130px">E-mail</span><span class="grow"><?= View::e($email) ?></span></div>
      <div class="row"><span class="label" style="width:130px">CPF/CNPJ</span><span class="mono grow"><?= View::e($doc) ?></span></div>
      <div class="row"><span class="label" style="width:130px">Data/hora</span><span class="tabular grow"><?= date('d/m/Y H:i') ?></span></div>
      <div class="row"><span class="label" style="width:130px">IP</span><span class="mono grow"><?= View::e($ip) ?></span></div>
    </div>
  </div>
</section>
