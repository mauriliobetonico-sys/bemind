<?php
use App\Core\View;
/** @var array $items @var string $status */
$statuses = ['todos'=>'Todos','aguardando'=>'Aguardando','respondido'=>'Respondido','rascunho'=>'Rascunho'];
$cur = $status ?: 'todos';
$title = 'Briefings';
?>
<div class="cta-coral">
  <div class="kicker">Antes da proposta</div>
  <h3>Enviar briefing</h3>
  <p style="font:500 13px/1.5 var(--font-mnr);color:rgba(255,255,255,.9);margin-bottom:12px">Descubra o que o cliente precisa em 12 perguntas rápidas.</p>
  <a class="btn" style="background:#fff;color:var(--ink)" href="/briefings/new">Novo briefing</a>
</div>

<div class="filterbar mt-4">
  <?php foreach ($statuses as $key=>$label): ?>
    <a class="chip <?= $cur === $key ? 'active' : '' ?>" href="/briefings?status=<?= $key ?>"><?= View::e($label) ?></a>
  <?php endforeach; ?>
</div>

<div class="stack lg">
  <?php if (!$items): ?><div class="card muted center">Nenhum briefing.</div><?php endif; ?>
  <?php foreach ($items as $b): $pct = (int)round(($b['answers_count'] / max(1,$b['total_questions'])) * 100); ?>
    <a class="card" href="/briefings/<?= (int)$b['id'] ?>" style="text-decoration:none;color:inherit">
      <div class="row"><span class="mono small muted"><?= View::e($b['number']) ?></span>
        <span class="spacer"></span>
        <span class="badge <?= View::e($b['status']) ?>"><?= View::e($b['status']) ?></span>
      </div>
      <div style="font:800 15px/1.25 var(--font-jkt);margin-top:6px"><?= View::e($b['client_name'] ?: $b['contact_name'] ?: 'Sem cliente') ?></div>
      <div class="small muted" style="margin-top:2px"><?= View::e($b['kind'] ?: '—') ?> · <?= date('d/m/Y', strtotime($b['created_at'])) ?></div>
      <div class="row mt-2">
        <div class="track" style="height:6px;width:64px;background:var(--line-soft);border-radius:999px;overflow:hidden">
          <div style="height:6px;width:<?= $pct ?>%;background:var(--coral);border-radius:999px"></div>
        </div>
        <span class="small muted tabular"><?= (int)$b['answers_count'] ?>/<?= (int)$b['total_questions'] ?></span>
      </div>
    </a>
  <?php endforeach; ?>
</div>
