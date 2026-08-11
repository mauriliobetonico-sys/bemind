<?php
use App\Core\Csrf;
use App\Core\Money;
use App\Core\View;
/** @var array $br @var array $questions @var array $answers @var array $suggested
 *  @var string $link @var string $wa */
$title = $br['number'];
$backUrl = '/briefings';

$sections = ['empresa'=>'Empresa','publico'=>'Público','objetivos'=>'Objetivos','projeto'=>'Projeto'];
$bySection = ['empresa'=>[],'publico'=>[],'objetivos'=>[],'projeto'=>[]];
foreach ($questions as $q) $bySection[$q['section']][] = $q;

$sugTotal = 0.0;
foreach ($suggested as $s) $sugTotal += (float)$s['default_price'];
?>
<div class="ink-card">
  <div class="row">
    <span class="badge <?= View::e($br['status']) ?>" style="background:rgba(255,255,255,.12);color:#fff"><?= View::e($br['status']) ?></span>
    <span class="mono small" style="margin-left:8px;color:rgba(255,255,255,.6)"><?= View::e($br['number']) ?></span>
  </div>
  <div style="margin-top:8px;font:800 20px/1.2 var(--font-jkt)"><?= View::e($br['client_name'] ?: $br['contact_name'] ?: 'Cliente') ?></div>
  <?php if ($br['answered_at']): ?>
    <div class="small" style="color:rgba(255,255,255,.7);margin-top:4px">
      Respondido em <?= date('d/m/Y H:i', strtotime($br['answered_at'])) ?>
    </div>
  <?php endif; ?>
  <div class="divider" style="background:rgba(255,255,255,.14);margin:14px 0"></div>
  <div class="row">
    <div class="grow"><span class="label">Respostas</span><div class="tabular" style="font:800 18px/1 var(--font-jkt)"><?= (int)$br['answers_count'] ?>/<?= (int)$br['total_questions'] ?></div></div>
    <?php if (!empty($answers[11])): ?>
      <div class="grow"><span class="label">Verba</span><div class="tabular" style="font:800 15px/1 var(--font-jkt);color:var(--coral);white-space:nowrap"><?= View::e($answers[11]) ?></div></div>
    <?php endif; ?>
  </div>
</div>

<?php foreach ($sections as $key => $label): ?>
  <div class="card">
    <div class="card-kicker"><?= View::e(mb_strtoupper($label)) ?></div>
    <?php foreach ($bySection[$key] as $q):
      $v = $answers[(int)$q['id']] ?? null;
      if (is_string($v) && str_starts_with($v, '[')) $v = implode(', ', json_decode($v, true) ?: []);
    ?>
      <div style="padding:8px 0;border-top:1px solid var(--line-soft)">
        <div class="small muted" style="color:var(--gray-300);font:600 12px/1.2 var(--font-mnr)"><?= View::e($q['label']) ?></div>
        <div style="font:600 13.5px/1.4 var(--font-mnr);color:var(--ink);margin-top:4px"><?= View::e($v ?: '—') ?></div>
      </div>
    <?php endforeach; ?>
  </div>
<?php endforeach; ?>

<?php if ($suggested): ?>
  <div class="card" style="border-color:var(--coral)">
    <div class="card-kicker">Sugerido pelo briefing</div>
    <?php foreach ($suggested as $s): ?>
      <div class="list-item">
        <div class="grow"><div style="font:700 13.5px/1.25 var(--font-jkt)"><?= View::e($s['name']) ?></div>
          <div class="small muted"><?= View::e($s['recurrence']) ?></div></div>
        <div class="tabular" style="font:800 14px/1 var(--font-jkt);color:var(--coral-text)"><?= Money::br((float)$s['default_price']) ?></div>
      </div>
    <?php endforeach; ?>
    <div class="divider"></div>
    <div class="row"><span class="grow">Total sugerido</span><span class="tabular" style="font-weight:800"><?= Money::br($sugTotal) ?></span></div>
    <form method="post" action="/briefings/<?= (int)$br['id'] ?>/to-proposal" class="mt-4">
      <?= Csrf::field() ?>
      <button class="btn btn-primary btn-block" type="submit">Gerar proposta a partir do briefing</button>
    </form>
  </div>
<?php endif; ?>

<div class="actions">
  <a href="https://wa.me/?text=<?= rawurlencode($wa) ?>" target="_blank">WhatsApp<span class="sub">Enviar link ao cliente</span></a>
  <button type="button" data-copy="<?= View::e($link) ?>">Copiar link<span class="sub"><?= View::e($link) ?></span></button>
  <a href="/briefings/<?= (int)$br['id'] ?>#complemento">Pedir complemento<span class="sub">Nova rodada</span></a>
  <a href="/briefings">Arquivar<span class="sub">(sem ação)</span></a>
</div>
