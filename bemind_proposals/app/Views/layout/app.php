<?php
/** @var string $content
 *  @var array  $user
 */
use App\Core\View;
$path = $_SERVER['REQUEST_URI'] ?? '/';
$is = fn(string $p) => str_starts_with($path, $p);
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>BE MIND PROPOSALS</title>
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/app.css">
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <span class="topbar__logo" aria-hidden="true"></span>
    <div class="topbar__title">BE MIND PROPOSALS</div>
    <button class="topbar__bell" aria-label="Notificações"><span class="dot"></span></button>
  </header>

  <main class="main">
    <?= $content ?>
  </main>

  <nav class="tabbar" aria-label="Principal">
    <a href="/dashboard" class="<?= $is('/dashboard') ? 'active' : '' ?>"><span class="icon"></span>Início</a>
    <a href="/proposals" class="<?= $is('/proposals') ? 'active' : '' ?>"><span class="icon"></span>Propostas</a>
    <a href="/clients"   class="<?= $is('/clients')   ? 'active' : '' ?>"><span class="icon"></span>Clientes</a>
    <a href="/more"      class="<?= $is('/more')      ? 'active' : '' ?>"><span class="icon"></span>Mais</a>
  </nav>
</div>
</body>
</html>
