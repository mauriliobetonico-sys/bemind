<?php
use App\Core\Csrf;
use App\Core\Money;
use App\Core\View;
/** @var ?array $proposal @var array $items @var array $clients @var array $services
 *  @var array $categories @var int $step */
$title    = 'Nova proposta';
$backUrl  = $step > 0 && $proposal ? '/proposals/' . (int)$proposal['id'] . '/wizard?step=' . ($step-1) : '/proposals';
$labels   = ['Cliente','Escopo','Investimento','Condições'];
$pid      = $proposal['id'] ?? '';
$totalMon = $proposal ? (float)$proposal['total_monthly'] : 0.0;
$totalOnce= $proposal ? (float)$proposal['total_once']    : 0.0;
$discPct  = $proposal ? (float)$proposal['discount_percent'] : 0.0;
?>
<div class="stepper">
  <?php for ($i=0; $i<4; $i++): ?><div class="rail <?= $i <= $step ? 'on' : '' ?>"></div><?php endfor; ?>
</div>
<div class="stepper-labels">
  <?php foreach ($labels as $i => $l): ?><span class="<?= $i <= $step ? 'on' : '' ?>"><?= View::e($l) ?></span><?php endforeach; ?>
</div>

<form method="post" action="/proposals/wizard" class="stack lg" data-autosave-url="/api/proposals/<?= (int)$pid ?>/autosave" style="margin-top:14px">
  <?= Csrf::field() ?>
  <input type="hidden" name="step" value="<?= $step ?>">
  <input type="hidden" name="proposal_id" value="<?= (int)$pid ?>">

  <?php if ($step === 0): /* CLIENTE */ ?>
    <div class="card">
      <div class="card-title">Cliente</div>
      <input type="hidden" name="client_id" id="input-client" value="<?= (int)($proposal['client_id'] ?? 0) ?>">
      <input class="input" type="search" placeholder="Buscar cliente…" oninput="filterClients(this.value)">
      <div class="stack mt-4" id="client-list">
        <?php foreach ($clients as $c): $selected = ($proposal && (int)$proposal['client_id'] === (int)$c['id']); ?>
          <div class="list-item client-row" data-name="<?= View::e(mb_strtolower($c['company_name'])) ?>" style="cursor:pointer"
               onclick="pickClient(this, <?= (int)$c['id'] ?>)">
            <?php $name = $c['company_name']; include __DIR__ . '/../partials/avatar.php'; ?>
            <div class="grow">
              <div style="font:700 14px/1.25 var(--font-jkt)"><?= View::e($c['company_name']) ?></div>
              <div class="small muted"><?= View::e($c['segment'] ?: '—') ?></div>
            </div>
            <span class="check" style="color:var(--coral);font-weight:800;display:<?= $selected ? 'inline' : 'none' ?>">✓</span>
          </div>
        <?php endforeach; ?>
      </div>
      <a class="btn btn-ghost btn-block mt-4" href="/clients/new">＋ Cadastrar novo cliente</a>
    </div>
    <div><label class="label">Nome do projeto</label>
      <input class="input" name="project" value="<?= View::e($proposal['project'] ?? '') ?>"></div>
  <?php endif; ?>

  <?php if ($step === 1): /* ESCOPO */ ?>
    <div class="chip-row scroll">
      <?php foreach ($categories as $c): ?>
        <span class="chip chip-lg" data-chip-group="cat" data-chip-value="<?= (int)$c['id'] ?>"><?= View::e(mb_strtoupper($c['name'])) ?></span>
      <?php endforeach; ?>
    </div>
    <input type="hidden" id="input-cat">

    <div class="card">
      <div class="card-title">Serviços da categoria</div>
      <div id="svc-list">
        <?php foreach ($services as $s): ?>
          <div class="list-item svc-row" data-cat="<?= (int)$s['category_id'] ?>">
            <div class="grow">
              <div style="font:700 13.5px/1.25 var(--font-jkt)"><?= View::e($s['name']) ?></div>
              <div class="small muted"><?= View::e($s['recurrence']) ?> · <?= View::e($s['category_name']) ?></div>
            </div>
            <div class="tabular" style="font:800 13.5px/1 var(--font-jkt);color:var(--coral-text);margin-right:8px"><?= Money::br((float)$s['default_price']) ?></div>
            <?php if ($pid): ?>
              <button type="button" class="btn btn-secondary" style="width:44px;padding:0"
                      onclick="addItem(<?= (int)$pid ?>, <?= (int)$s['id'] ?>)">+</button>
            <?php else: ?>
              <span class="small muted">salve o cliente 1º</span>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Escopo da proposta · <?= count($items) ?> itens</div>
      <?php if (!$items): ?><p class="muted">Adicione serviços da lista acima.</p><?php endif; ?>
      <?php foreach ($items as $it): $line=(float)$it['unit_price']*max(1,(int)$it['quantity']); ?>
        <div class="list-item" data-item="<?= (int)$it['id'] ?>">
          <div class="grow">
            <div style="font:700 13.5px/1.25 var(--font-jkt)"><?= View::e($it['name']) ?></div>
            <div class="small muted"><?= View::e($it['recurrence']) ?></div>
          </div>
          <div class="row" style="gap:4px">
            <button type="button" class="btn btn-secondary" style="width:32px;height:32px;padding:0" onclick="itemQty(<?= (int)$pid ?>,<?= (int)$it['id'] ?>,-1)">−</button>
            <span class="tabular" style="min-width:24px;text-align:center"><?= (int)$it['quantity'] ?></span>
            <button type="button" class="btn btn-secondary" style="width:32px;height:32px;padding:0" onclick="itemQty(<?= (int)$pid ?>,<?= (int)$it['id'] ?>,+1)">+</button>
          </div>
          <div class="tabular" style="font:800 14px/1 var(--font-jkt);color:var(--coral-text);margin-left:8px;min-width:90px;text-align:right"><?= Money::br($line) ?></div>
          <button type="button" class="link" style="margin-left:6px" onclick="removeItem(<?= (int)$pid ?>,<?= (int)$it['id'] ?>)">REMOVER</button>
        </div>
      <?php endforeach; ?>
      <div class="divider"></div>
      <div class="row"><span class="grow muted">Mensal recorrente</span><span class="tabular"><?= Money::br($totalMon) ?></span></div>
      <div class="row"><span class="grow muted">Investimento único</span><span class="tabular"><?= Money::br($totalOnce) ?></span></div>
    </div>
  <?php endif; ?>

  <?php if ($step === 2): /* INVESTIMENTO */ ?>
    <div class="card">
      <div class="card-title">Desconto geral</div>
      <input type="hidden" name="discount_percent" id="input-disc" value="<?= (float)$discPct ?>">
      <div class="chip-row">
        <?php foreach ([0,5,10,15] as $d): ?>
          <span class="chip chip-lg <?= (int)$discPct === $d ? 'active' : '' ?>" data-chip-group="disc" data-chip-value="<?= $d ?>">
            <?= $d === 0 ? 'Sem desconto' : $d . '%' ?>
          </span>
        <?php endforeach; ?>
      </div>
      <div class="stack mt-4">
        <div class="row"><span class="grow">Mensal</span><span class="tabular"><?= Money::br($totalMon) ?></span></div>
        <div class="row"><span class="grow">Único</span><span class="tabular"><?= Money::br($totalOnce) ?></span></div>
        <div class="row"><span class="grow" style="color:#B23A2E">Desconto</span><span class="tabular" style="color:#B23A2E">- <?= Money::br((float)($proposal['discount_value'] ?? 0)) ?></span></div>
        <div class="row"><span class="grow" style="font-weight:700">Total do 1º mês</span><span class="tabular" style="font-weight:700"><?= Money::br($totalMon + $totalOnce) ?></span></div>
      </div>
    </div>
    <div class="ink-card">
      <span class="label">Investimento mensal</span>
      <div class="value coral tabular"><?= Money::br($totalMon) ?></div>
      <div class="small" style="margin-top:6px;color:rgba(255,255,255,.7)">Anual <?= Money::br($totalMon*12) ?> · único <?= Money::br($totalOnce) ?></div>
    </div>
  <?php endif; ?>

  <?php if ($step === 3): /* CONDIÇÕES */ ?>
    <div class="card">
      <div class="card-title">Forma de pagamento</div>
      <input type="hidden" name="payment_terms" id="input-pay" value="<?= View::e($proposal['payment_terms'] ?? '50/50') ?>">
      <div class="chip-row">
        <?php foreach (['À vista','50/50','30/30/40','12x sem juros'] as $pay): ?>
          <span class="chip chip-lg <?= (($proposal['payment_terms'] ?? '50/50') === $pay) ? 'active' : '' ?>"
                data-chip-group="pay" data-chip-value="<?= View::e($pay) ?>"><?= View::e($pay) ?></span>
        <?php endforeach; ?>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Validade</div>
      <input type="hidden" name="validity_days" id="input-val" value="15">
      <div class="chip-row">
        <?php foreach ([7,15,30,60] as $v): ?>
          <span class="chip chip-lg <?= $v===15?'active':'' ?>" data-chip-group="val" data-chip-value="<?= $v ?>"><?= $v ?> dias</span>
        <?php endforeach; ?>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Observações</div>
      <div class="chip-row" style="gap:4px;margin-bottom:8px">
        <span class="chip small">B</span><span class="chip small">I</span><span class="chip small">Lista</span><span class="chip small">Link</span>
      </div>
      <textarea class="textarea" name="terms_text" placeholder="Notas, escopo excluído, condições especiais…"><?= View::e($proposal['terms_text'] ?? '') ?></textarea>
    </div>
  <?php endif; ?>

  <div class="row" style="justify-content:space-between;margin-top:4px">
    <?php if ($step > 0): ?>
      <a class="link" href="/proposals/<?= (int)$pid ?>/wizard?step=<?= $step-1 ?>">← Voltar</a>
    <?php else: ?><span></span><?php endif; ?>
    <button class="btn btn-primary" type="submit">
      <?= $step < 3 ? 'Continuar' : 'Revisar e gerar proposta' ?>
    </button>
  </div>
  <p class="center small muted" id="autosave-status">Salvo agora</p>
</form>

<script>
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
  function pickClient(row, id) {
    document.getElementById('input-client').value = id;
    document.querySelectorAll('#client-list .check').forEach(x => x.style.display = 'none');
    row.querySelector('.check').style.display = 'inline';
  }
  function filterClients(q) {
    q = q.toLowerCase();
    document.querySelectorAll('#client-list .client-row').forEach(el => {
      el.style.display = el.dataset.name.includes(q) ? '' : 'none';
    });
  }
  // filtro categoria → mostra apenas serviços da categoria
  document.querySelectorAll('[data-chip-group="cat"]').forEach(el => el.addEventListener('click', () => {
    const cat = el.dataset.chipValue;
    document.querySelectorAll('#svc-list .svc-row').forEach(r => {
      r.style.display = (r.dataset.cat === cat) ? '' : 'none';
    });
  }));
  async function addItem(pid, svcId) {
    if (!pid) return alert('Selecione o cliente e clique em Continuar antes de adicionar itens.');
    const fd = new FormData(); fd.append('service_id', svcId); fd.append('_csrf', csrf());
    const r = await fetch('/api/proposals/'+pid+'/items', {method:'POST', body: fd});
    if (r.ok) location.reload();
  }
  async function itemQty(pid, itemId, delta) {
    const cur = parseInt(event.target.parentNode.querySelector('span').textContent, 10) || 1;
    const q = Math.max(1, cur + delta);
    const fd = new FormData(); fd.append('quantity', q); fd.append('_csrf', csrf());
    const r = await fetch('/api/proposals/'+pid+'/items/'+itemId, {method:'POST', body: fd});
    if (r.ok) location.reload();
  }
  async function removeItem(pid, itemId) {
    if (!confirm('Remover este item?')) return;
    const r = await fetch('/api/proposals/'+pid+'/items/'+itemId, {method:'DELETE', headers:{'X-CSRF-Token': csrf()}});
    if (r.ok) location.reload();
  }
</script>
