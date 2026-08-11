<?php
/** @var string $content
 *  @var array  $user
 */
use App\Core\Csrf;
use App\Core\View;
use App\Models\CompanySettings;
use App\Models\Notification;

$path = $_SERVER['REQUEST_URI'] ?? '/';
$is  = fn(string $p) => (bool)preg_match('#^' . preg_quote($p) . '(/|$|\?)#', $path);
// mapeamento tab bar
$activeRoot = '/dashboard';
foreach ([
    '/dashboard' => '/dashboard',
    '/proposals' => '/proposals', '/proposal' => '/proposals',
    '/clients'   => '/clients',   '/client'   => '/clients',
    '/more'      => '/more', '/services'=>'/more', '/cloud'=>'/more',
    '/reports'   => '/more', '/settings'=>'/more', '/notifications'=>'/more',
    '/briefings' => '/more',
] as $prefix => $root) {
    if (str_starts_with($path, $prefix)) { $activeRoot = $root; break; }
}
$settings = CompanySettings::get();
$unread   = isset($user['id']) ? Notification::unreadCount((int)$user['id']) : 0;
$title    = $title ?? 'BE MIND PROPOSALS';
$backUrl  = $backUrl ?? null;
$dark     = !empty($settings['dark_mode']) ? 'dark' : 'light';
?>
<!doctype html>
<html lang="pt-BR" data-theme="<?= $dark ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="csrf-token" content="<?= View::e(Csrf::token()) ?>">
<title><?= View::e($title) ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/app.css">
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <?php if ($backUrl): ?>
      <a class="topbar__back" href="<?= View::e($backUrl) ?>" aria-label="Voltar">
        <svg width="9" height="16" viewBox="0 0 9 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1L1 8L8 15" stroke="#2B2E35" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </a>
    <?php else: ?>
      <a class="topbar__logo" href="/dashboard" aria-label="Início">
        <?php if (!empty($settings['logo_path'])): ?>
          <img src="<?= View::e($settings['logo_path']) ?>" alt="" style="max-height:24px;max-width:24px;">
        <?php else: ?>
          <span style="width:14px;height:14px;background:var(--coral);border-radius:4px"></span>
        <?php endif; ?>
      </a>
    <?php endif; ?>
    <div class="topbar__title"><?= View::e($title) ?></div>
    <a class="topbar__bell" href="/notifications" aria-label="Notificações">
      <?php if ($unread > 0): ?><span class="dot"></span><?php endif; ?>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 12h11l-1.2-1.5V7a4.3 4.3 0 0 0-3.5-4.2V2a.8.8 0 1 0-1.6 0v.8A4.3 4.3 0 0 0 3.7 7v3.5L2.5 12Zm4.3 1.5a1.2 1.2 0 0 0 2.4 0" stroke="#2B2E35" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </a>
  </header>

  <main class="main">
    <?= $content ?>
  </main>

  <nav class="tabbar" aria-label="Principal">
    <a href="/dashboard" class="<?= $activeRoot === '/dashboard' ? 'active' : '' ?>"><span class="icon"></span>Início</a>
    <a href="/proposals" class="<?= $activeRoot === '/proposals' ? 'active' : '' ?>"><span class="icon"></span>Propostas</a>
    <a href="/clients"   class="<?= $activeRoot === '/clients'   ? 'active' : '' ?>"><span class="icon"></span>Clientes</a>
    <a href="/more"      class="<?= $activeRoot === '/more'      ? 'active' : '' ?>"><span class="icon"></span>Mais</a>
  </nav>
</div>
<script src="/assets/js/app.js" defer></script>
</body>
</html>
