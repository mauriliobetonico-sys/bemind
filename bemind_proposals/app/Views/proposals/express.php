<?php
use App\Core\Csrf;
use App\Core\Money;
use App\Core\View;
/** @var array $clients @var array $services @var array $categories @var ?int $selectedClient */
$title = 'Proposta Express';
?>
<form method="post" action="/proposals/express" class="stack lg">
  <?= Csrf::field() ?>

  <!-- 1 · CLIENTE -->
  <div class="card">
    <div class="card-kicker">1 · CLIENTE</div>
    <input type="hidden" name="client_id" id="input-client">
    <div class="chip-row scroll">
      <?php foreach ($clients as $c): ?>
        <span class="chip chip-lg" data-chip-group="client" data-chip-value="<?= (int)$c['id'] ?>"
              <?= ($selectedClient && (int)$selectedClient === (int)$c['id']) ? 'style="border-color:var(--coral);background:var(--coral-wash);color:var(--coral-text)"' : '' ?>>
          <?= View::e($c['company_name']) ?>
        </span>
      <?php endforeach; ?>
    </div>
    <p class="help">Comece a digitar para localizar. Se não achar, <a href="/clients/new" class="link">cadastre agora</a>.</p>
  </div>

  <!-- 2 · SERVIÇO -->
  <div class="card">
    <div class="card-kicker">2 · SERVIÇO</div>
    <input type="hidden" name="service_id" id="input-service">
    <div class="chip-row scroll">
      <?php foreach ($services as $s): ?>
        <span class="chip chip-lg" data-chip-group="service" data-chip-value="<?= (int)$s['id'] ?>" data-price="<?= (float)$s['default_price'] ?>">
          <?= View::e($s['name']) ?>
        </span>
      <?php endforeach; ?>
    </div>
    <p class="help">Descrição, entregáveis e prazo são preenchidos automaticamente pela biblioteca; tudo editável antes de enviar.</p>
  </div>

  <!-- 3 · VALOR -->
  <div class="card">
    <div class="card-kicker">3 · VALOR</div>
    <div class="row" data-counter data-step="50" data-min="50" data-target="input-valor" style="justify-content:space-between">
      <button type="button" class="btn btn-secondary" data-op="minus" style="width:56px;padding:0">−</button>
      <div class="counter-value tabular" style="font:800 26px/1 var(--font-jkt);letter-spacing:-.03em"></div>
      <button type="button" class="btn btn-secondary" data-op="plus"  style="width:56px;padding:0">+</button>
    </div>
    <input type="hidden" name="valor" id="input-valor" value="500">
    <div class="chip-row mt-2">
      <?php foreach ([500,800,1200,1900] as $preset): ?>
        <span class="chip" onclick="document.getElementById('input-valor').value=<?= $preset ?>;this.closest('.card').querySelector('.counter-value').textContent='R$ '+new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2}).format(<?= $preset ?>)">
          <?= Money::br($preset) ?>
        </span>
      <?php endforeach; ?>
    </div>
  </div>

  <!-- 4 · VALIDADE E CONDIÇÕES -->
  <div class="card">
    <div class="card-kicker">4 · VALIDADE E CONDIÇÕES</div>
    <input type="hidden" name="validity" id="input-validity" value="15">
    <div class="chip-row">
      <?php foreach ([7,15,30] as $v): ?>
        <span class="chip chip-lg <?= $v===15?'active':'' ?>" data-chip-group="validity" data-chip-value="<?= $v ?>"><?= $v ?> dias</span>
      <?php endforeach; ?>
      <span class="chip chip-lg" data-chip-group="validity" data-chip-value="60">Custom</span>
    </div>
    <input type="hidden" name="condition" id="input-condition" value="50/50">
    <div class="chip-row mt-4">
      <?php foreach (['À vista','50/50','12x sem juros'] as $cond): ?>
        <span class="chip <?= $cond==='50/50'?'active':'' ?>" data-chip-group="condition" data-chip-value="<?= View::e($cond) ?>"><?= View::e($cond) ?></span>
      <?php endforeach; ?>
    </div>
  </div>

  <div class="ink-card">
    <div class="row"><span class="label">Resumo</span><span class="spacer"></span><span class="mono small" style="color:rgba(255,255,255,.5)">Nº será gerado</span></div>
    <p style="font:700 14px/1.4 var(--font-mnr);margin-top:8px">Cliente e serviço acima · Valor</p>
    <div class="value coral tabular" id="preview-total">R$ 500,00</div>
  </div>

  <button class="btn btn-primary btn-block" type="submit">GERAR PROPOSTA</button>
  <p class="center small muted" id="autosave-status">Pronto para gerar</p>
</form>

<script>
  document.querySelectorAll('[data-chip-group="service"]').forEach(el => {
    el.addEventListener('click', () => {
      const p = parseFloat(el.dataset.price || '0');
      if (p > 0) {
        document.getElementById('input-valor').value = p;
        document.querySelector('[data-counter] .counter-value').textContent =
          'R$ ' + new Intl.NumberFormat('pt-BR', {minimumFractionDigits:2}).format(p);
        document.getElementById('preview-total').textContent =
          'R$ ' + new Intl.NumberFormat('pt-BR', {minimumFractionDigits:2}).format(p);
      }
    });
  });
  document.getElementById('input-valor').addEventListener('change', e => {
    document.getElementById('preview-total').textContent =
      'R$ ' + new Intl.NumberFormat('pt-BR', {minimumFractionDigits:2}).format(parseFloat(e.target.value||0));
  });
</script>
