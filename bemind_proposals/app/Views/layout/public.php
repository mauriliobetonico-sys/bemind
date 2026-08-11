<?php
/** @var string $content @var array $settings */
use App\Core\View;
$title = $title ?? 'Proposta comercial · Be Mind Marketing';
$printMode = $printMode ?? false;
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title><?= View::e($title) ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/app.css">
<?php if ($printMode): ?>
<style>@page { size: A4; margin: 12mm; } .cta-fixed { display: none !important; }</style>
<?php endif; ?>
</head>
<body class="pub">
<?= $content ?>
<script src="/assets/js/app.js" defer></script>
</body>
</html>
