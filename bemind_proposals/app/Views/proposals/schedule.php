<?php
use App\Core\Csrf;
use App\Core\View;
/** @var array $p @var array $phases */
$title   = 'Cronograma';
$backUrl = '/proposals/' . (int)$p['id'];
$suggest = [
    ['Descoberta', 'Semana 1'],
    ['Estratégia e planejamento', 'Semana 2'],
    ['Produção', 'Semanas 3–5'],
    ['Entrega e ajustes', 'Semana 6'],
];
$rows = $phases ?: $suggest;
if (!is_array($rows[0] ?? null)) $rows = $suggest;
if (!$phases) { $rows = $suggest; }
$normalized = [];
foreach ($rows as $r) {
    if (isset($r['phase'])) $normalized[] = ['phase'=>$r['phase'],'period'=>$r['period'] ?? ''];
    else $normalized[] = ['phase'=>$r[0] ?? '','period'=>$r[1] ?? ''];
}
?>
<form method="post" action="/proposals/<?= (int)$p['id'] ?>/schedule" class="stack lg">
  <?= Csrf::field() ?>
  <div class="card">
    <div class="card-title">Cronograma da proposta <?= View::e($p['number']) ?></div>
    <p class="help">Uma fase por linha. Deixe em branco para remover.</p>
    <div id="phases" class="stack mt-4">
      <?php foreach ($normalized as $i => $r): ?>
        <div class="row gap-2 phase-row">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--coral-wash);color:var(--coral-text);
                      font:800 12px/32px var(--font-jkt);text-align:center"><?= $i+1 ?></div>
          <input class="input grow" name="phase[]"  placeholder="Fase" value="<?= View::e($r['phase']) ?>">
          <input class="input" style="width:140px" name="period[]" placeholder="Período" value="<?= View::e($r['period']) ?>">
          <button type="button" class="btn btn-secondary" style="width:40px;padding:0"
                  onclick="this.closest('.phase-row').remove()">×</button>
        </div>
      <?php endforeach; ?>
    </div>
    <button type="button" class="btn btn-ghost btn-block mt-4" onclick="addPhase()">＋ Nova fase</button>
  </div>
  <button class="btn btn-primary btn-block" type="submit">Salvar cronograma</button>
</form>

<script>
  function addPhase() {
    const row = document.createElement('div');
    row.className = 'row gap-2 phase-row';
    row.innerHTML =
      '<div style="width:32px;height:32px;border-radius:50%;background:var(--coral-wash);color:var(--coral-text);font:800 12px/32px var(--font-jkt);text-align:center">+</div>'
      + '<input class="input grow" name="phase[]" placeholder="Fase">'
      + '<input class="input" style="width:140px" name="period[]" placeholder="Período">'
      + '<button type="button" class="btn btn-secondary" style="width:40px;padding:0" onclick="this.closest(\'.phase-row\').remove()">×</button>';
    document.getElementById('phases').appendChild(row);
  }
</script>
