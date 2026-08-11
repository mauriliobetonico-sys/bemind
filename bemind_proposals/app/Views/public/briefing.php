<?php
use App\Core\Csrf;
use App\Core\View;
/** @var array $br @var array $questions @var array $answers @var int $step @var array $settings */
$title = 'Briefing · Be Mind Marketing';
$logo  = $settings['logo_path'] ?? null;

$sections = [0=>'empresa',1=>'publico',2=>'objetivos',3=>'projeto'];
$labels   = [0=>'Empresa',1=>'Público',2=>'Objetivos',3=>'Projeto'];
$section  = $sections[$step] ?? 'empresa';
$stepQs   = array_values(array_filter($questions, fn($q)=>$q['section']===$section));
?>
<header class="hero">
  <?php if ($logo): ?><div class="logo-card"><img src="<?= View::e($logo) ?>" alt=""></div><?php endif; ?>
  <div class="kicker">Briefing</div>
  <h1>Conte sobre o seu projeto</h1>
  <p class="prepared">12 perguntas, cerca de 5 minutos. Suas respostas montam a proposta — nada aqui é definitivo.</p>
</header>

<section>
  <div class="stepper">
    <?php for ($i=0; $i<4; $i++): ?><div class="rail <?= $i <= $step ? 'on' : '' ?>"></div><?php endfor; ?>
  </div>
  <div class="stepper-labels">
    <?php foreach ($labels as $i => $l): ?><span class="<?= $i <= $step ? 'on' : '' ?>"><?= View::e($l) ?></span><?php endforeach; ?>
  </div>

  <form method="post" action="/b/<?= View::e($br['public_token']) ?>/<?= $step >= 3 ? 'submit' : 'save' ?>" class="stack lg mt-4"
        data-autosave-url="/b/<?= View::e($br['public_token']) ?>/save">
    <?= Csrf::field() ?>
    <input type="hidden" name="step" value="<?= $step ?>">

    <?php foreach ($stepQs as $q):
      $val = $answers[(int)$q['id']] ?? '';
      $opts = $q['options'] ? (json_decode($q['options'], true) ?: []) : [];
    ?>
      <div class="card">
        <div class="card-title"><?= View::e($q['label']) ?></div>
        <?php if ($q['hint']): ?><p class="help"><?= View::e($q['hint']) ?></p><?php endif; ?>

        <?php if ($q['type'] === 'text'): ?>
          <input class="input" name="a[<?= (int)$q['id'] ?>]" value="<?= View::e($val) ?>">
        <?php elseif ($q['type'] === 'textarea'): ?>
          <textarea class="textarea" name="a[<?= (int)$q['id'] ?>]"><?= View::e($val) ?></textarea>
        <?php elseif ($q['type'] === 'single'): ?>
          <div class="chip-row">
            <?php foreach ($opts as $o): ?>
              <label class="chip chip-lg <?= $val === $o ? 'active' : '' ?>">
                <input type="radio" name="a[<?= (int)$q['id'] ?>]" value="<?= View::e($o) ?>" <?= $val === $o ? 'checked' : '' ?> style="display:none"
                       onchange="this.parentNode.parentNode.querySelectorAll('label').forEach(l=>l.classList.remove('active'));this.parentNode.classList.add('active')">
                <?= View::e($o) ?>
              </label>
            <?php endforeach; ?>
          </div>
        <?php elseif ($q['type'] === 'multi'):
          $arr = is_string($val) && str_starts_with($val, '[') ? (json_decode($val, true) ?: []) : ($val ? [$val] : []);
        ?>
          <div class="chip-row">
            <?php foreach ($opts as $o): ?>
              <label class="chip chip-lg <?= in_array($o, $arr, true) ? 'active' : '' ?>">
                <input type="checkbox" name="a[<?= (int)$q['id'] ?>][]" value="<?= View::e($o) ?>" <?= in_array($o, $arr, true) ? 'checked' : '' ?> style="display:none"
                       onchange="this.parentNode.classList.toggle('active', this.checked)">
                <?= View::e($o) ?>
              </label>
            <?php endforeach; ?>
          </div>
        <?php endif; ?>
      </div>
    <?php endforeach; ?>

    <div class="row" style="justify-content:space-between">
      <?php if ($step > 0): ?>
        <a class="link" href="/b/<?= View::e($br['public_token']) ?>?step=<?= $step-1 ?>">← Voltar</a>
      <?php else: ?><span></span><?php endif; ?>
      <div class="row" style="gap:10px">
        <span class="small muted" id="autosave-status">Salvo agora</span>
        <?php if ($step < 3): ?>
          <a class="btn btn-secondary" href="/b/<?= View::e($br['public_token']) ?>?step=<?= $step+1 ?>">Continuar</a>
        <?php else: ?>
          <button class="btn btn-primary" type="submit">Enviar briefing</button>
        <?php endif; ?>
      </div>
    </div>
    <p class="small muted center" style="margin-top:4px">Passo <?= $step+1 ?> de 4 · respostas salvas automaticamente</p>
  </form>
</section>
