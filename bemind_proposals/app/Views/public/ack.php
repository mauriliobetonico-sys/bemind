<?php
use App\Core\View;
/** @var string $title @var string $message */
?>
<header class="hero" style="text-align:center">
  <h1><?= View::e($title) ?></h1>
  <p class="prepared"><?= View::e($message) ?></p>
</header>
