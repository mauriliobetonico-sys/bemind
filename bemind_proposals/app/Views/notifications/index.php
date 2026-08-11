<?php
use App\Core\Csrf;
use App\Core\View;
/** @var array $items */
$title = 'Notificações';
$backUrl = '/dashboard';
$typeColor = [
    'visualizacao'=>['#FFF3E0','#A15C00'],
    'aprovacao'   =>['#E7F6EC','#1E7A45'],
    'recusa'      =>['#FDEAE8','#B23A2E'],
    'alteracao'   =>['#F3EAFD','#6B3FA0'],
    'envio'       =>['#EFEDE9','#6B7078'],
    'expiracao'   =>['#F1F1F1','#8A8A8A'],
    'info'        =>['#E8F0FE','#2A5DB0'],
];
?>
<?php if (!$items): ?><div class="card muted center">Sem notificações.</div><?php endif; ?>
<div class="stack lg">
<?php foreach ($items as $n):
  [$bg,$fg] = $typeColor[$n['type']] ?? ['#EFEDE9','#6B7078'];
?>
  <div class="card" style="background:<?= $bg ?>;border-color:transparent">
    <div class="row" style="align-items:flex-start">
      <div style="width:34px;height:34px;background:#fff;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;color:<?= $fg ?>;font:800 14px/1 var(--font-jkt)">
        <?= mb_strtoupper(mb_substr($n['type'],0,1)) ?>
      </div>
      <div class="grow">
        <div style="font:800 13.5px/1.25 var(--font-jkt);color:<?= $fg ?>"><?= View::e($n['title']) ?></div>
        <div class="small" style="color:var(--ink-600);margin-top:2px"><?= View::e($n['body'] ?? '') ?></div>
      </div>
      <div class="small muted tabular" style="white-space:nowrap"><?= View::e(date('d/m H:i', strtotime($n['created_at']))) ?></div>
    </div>
    <?php if (!$n['read_at']): ?>
      <form method="post" action="/notifications/<?= (int)$n['id'] ?>/read" style="margin-top:8px">
        <?= Csrf::field() ?>
        <button class="link" type="submit">Marcar como lida</button>
      </form>
    <?php endif; ?>
  </div>
<?php endforeach; ?>
</div>
