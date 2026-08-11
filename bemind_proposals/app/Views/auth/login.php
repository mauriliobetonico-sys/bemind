<?php
use App\Core\Csrf;
use App\Core\View;
/** @var ?string $error */
?>
<div class="auth-card">
  <h1>Entrar</h1>
  <p class="sub">Acesso ao painel BE MIND PROPOSALS.</p>

  <?php if (!empty($error)): ?>
    <div class="auth-error"><?= View::e($error) ?></div>
  <?php endif; ?>

  <form method="post" action="/login" autocomplete="on" novalidate>
    <?= Csrf::field() ?>
    <div class="row">
      <label class="label" for="email">E-mail</label>
      <input class="input" id="email" name="email" type="email" required autocomplete="username" autofocus>
    </div>
    <div class="row">
      <label class="label" for="password">Senha</label>
      <input class="input" id="password" name="password" type="password" required autocomplete="current-password">
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:6px" type="submit">Entrar</button>
  </form>
</div>
