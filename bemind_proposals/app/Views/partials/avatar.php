<?php
/** @var string $name @var string $size */
use App\Core\View;
$size = $size ?? '';
$palette = ['#FB6D62','#2A5DB0','#1E7A45','#A15C00','#6B3FA0','#3C4149'];
$initials = '';
foreach (preg_split('/\s+/', trim($name)) as $part) {
    if ($part === '') continue;
    $initials .= mb_strtoupper(mb_substr($part, 0, 1));
    if (mb_strlen($initials) >= 2) break;
}
$color = $palette[crc32($name) % count($palette)];
?>
<span class="avatar<?= $size ? ' avatar-' . View::e($size) : '' ?>" style="background:<?= $color ?>"><?= View::e($initials ?: '?') ?></span>
