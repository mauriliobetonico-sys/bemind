<?php
use App\Core\Money;
use App\Core\View;
/** @var int $year @var array $k @var int $approvalRate @var float $ticket @var array $top */
$title = 'Relatórios';
$maxRev = max(1, max(array_map(fn($t)=>(float)$t['revenue'], $top ?: [['revenue'=>1]])));
?>
<div class="card">
  <div class="card-kicker">Taxa de aprovação · <?= $year ?></div>
  <div class="tabular" style="font:800 40px/1 var(--font-jkt);letter-spacing:-.03em"><?= $approvalRate ?>%</div>
  <div class="small" style="color:#1E7A45;margin-top:6px">Base: propostas enviadas no ano</div>
  <div class="track mt-4" style="height:9px;background:var(--line-soft);border-radius:999px"><div style="height:9px;width:<?= $approvalRate ?>%;background:var(--coral);border-radius:999px"></div></div>
</div>

<div class="kpi-grid">
  <div class="kpi"><span class="l">Valor enviado</span><div class="n tabular"><?= Money::br((float)$k['value_sent']) ?></div></div>
  <div class="kpi"><span class="l">Valor aprovado</span><div class="n tabular" style="color:#1E7A45"><?= Money::br((float)$k['value_approved']) ?></div></div>
  <div class="kpi"><span class="l">Valor perdido</span><div class="n tabular" style="color:#B23A2E"><?= Money::br((float)$k['value_lost']) ?></div></div>
  <div class="kpi"><span class="l">Ticket médio</span><div class="n tabular"><?= Money::br($ticket) ?></div></div>
</div>

<div class="card">
  <div class="card-title">Serviços mais vendidos</div>
  <?php if (!$top): ?><p class="muted">Sem dados ainda.</p><?php endif; ?>
  <div class="bars">
    <?php foreach ($top as $t): $pct = (int)round(((float)$t['revenue']/$maxRev)*100); ?>
      <div class="bar">
        <div class="lbl"><?= View::e($t['name']) ?></div>
        <div class="track" style="background:#2B2E35"><div class="fill" style="background:#FB6D62;width:<?= $pct ?>%"></div></div>
        <div class="num tabular"><?= (int)$t['cnt'] ?></div>
      </div>
    <?php endforeach; ?>
  </div>
</div>
