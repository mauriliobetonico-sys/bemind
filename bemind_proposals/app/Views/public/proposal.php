<?php
use App\Core\Csrf;
use App\Core\Money;
use App\Core\View;
/** @var array $prop @var array $items @var array $schedule @var array $settings
 *  @var bool $expired @var ?array $acceptance @var bool $previewMode @var bool $printMode */
$title    = $prop['title'] . ' · ' . ($settings['name'] ?? 'Be Mind');
$logo     = $settings['logo_path'] ?? null;
$prepared = $prop['contact_name'] ?? $prop['client_name'];
$mon      = (float)$prop['total_monthly'];
$once     = (float)$prop['total_once'];
$discPct  = (float)$prop['discount_percent'];

$deliverGroups = [];
$monItems = [];
$onceItems = [];
foreach ($items as $it) {
    if ($it['recurrence'] === 'mensal') $monItems[] = $it;
    else                                 $onceItems[] = $it;
}
?>
<article>
  <!-- Capa -->
  <header class="hero">
    <?php if ($logo): ?>
      <div class="logo-card"><img src="<?= View::e($logo) ?>" alt=""></div>
    <?php else: ?>
      <div class="logo-card"><span style="font:800 18px/1 var(--font-jkt);color:var(--ink)">BE MIND</span></div>
    <?php endif; ?>
    <div class="kicker">Proposta comercial</div>
    <h1><?= View::e($prop['project'] ?: $prop['title']) ?></h1>
    <div class="prepared">Preparada para <strong><?= View::e($prop['client_name']) ?></strong></div>
    <div class="meta">
      <div class="m"><div class="k">Nº</div><div class="v mono"><?= View::e($prop['number']) ?></div></div>
      <div class="m"><div class="k">Data</div><div class="v"><?= View::e(date('d/m/Y', strtotime($prop['issue_date']))) ?></div></div>
      <div class="m"><div class="k">Válida até</div><div class="v"><?= View::e($prop['valid_until'] ? date('d/m/Y', strtotime($prop['valid_until'])) : '—') ?></div></div>
    </div>
  </header>

  <?php if ($expired): ?>
    <section><div class="alert warn">Esta proposta expirou. Fale conosco para atualizar a validade.</div></section>
  <?php endif; ?>

  <?php if ($acceptance): ?>
    <section><div class="alert ok">Aceite registrado em <?= date('d/m/Y H:i', strtotime($acceptance['accepted_at'])) ?> por <strong><?= View::e($acceptance['name']) ?></strong>.</div></section>
  <?php endif; ?>

  <!-- Abertura -->
  <section>
    <div class="kicker">Olá, <?= View::e(mb_strtoupper($prepared)) ?></div>
    <p><?= nl2br(View::e($prop['summary'] ?: 'Preparamos esta proposta com atenção ao que conversamos. Cada item foi pensado para gerar resultado real para o seu negócio.')) ?></p>
  </section>

  <!-- Escopo -->
  <section>
    <div class="kicker">Escopo</div>
    <h2>O que está incluso</h2>
    <?php foreach ($items as $it): $line = (float)$it['unit_price'] * max(1,(int)$it['quantity']); ?>
      <div class="scope-item">
        <div class="head">
          <div class="name"><?= View::e($it['name']) ?></div>
          <div class="val tabular"><?= Money::br($line) ?><?php if ($it['recurrence'] === 'mensal'): ?><span class="small muted" style="color:var(--gray-400)">/mês</span><?php endif; ?></div>
        </div>
        <?php if (!empty($it['description'])): ?><p><?= View::e($it['description']) ?></p><?php endif; ?>
        <?php
          $del = $it['deliverables'] ?? null;
          if (is_string($del)) $del = json_decode($del, true) ?: [];
          if (is_array($del) && count($del)):
        ?>
          <ul>
            <?php foreach ($del as $d): ?><li><?= View::e($d) ?></li><?php endforeach; ?>
          </ul>
        <?php endif; ?>
      </div>
    <?php endforeach; ?>
    <?php if (!$items): ?><p class="muted">Sem itens no escopo.</p><?php endif; ?>
  </section>

  <!-- Investimento -->
  <section>
    <div class="kicker">Investimento</div>
    <h2>Valor mensal e único</h2>
    <div class="inv-card">
      <div class="k">Investimento mensal</div>
      <div class="v tabular"><?= Money::br($mon) ?></div>
      <?php if ($discPct > 0): ?>
        <div class="line"><span>Subtotal</span><span class="tabular"><?= Money::br($mon + (float)$prop['subtotal_monthly'] - $mon) ?></span></div>
        <div class="line"><span>Desconto <?= number_format($discPct, 0, ',', '.') ?>%</span><span class="tabular" style="color:#E85C51">- <?= Money::br((float)$prop['discount_value']) ?></span></div>
      <?php endif; ?>
      <div class="line"><span>Anual</span><span class="tabular"><?= Money::br($mon * 12) ?></span></div>
      <div class="line"><span>Investimento único</span><span class="tabular"><?= Money::br($once) ?></span></div>
    </div>
  </section>

  <!-- Cronograma -->
  <?php if ($schedule): ?>
    <section>
      <div class="kicker">Cronograma</div>
      <h2>Como vamos entregar</h2>
      <div class="steps">
        <?php foreach ($schedule as $i => $ph): ?>
          <div class="step"><div class="n"><?= $i+1 ?></div>
            <div><div style="font:800 15px/1.2 var(--font-jkt)"><?= View::e($ph['phase']) ?></div>
                 <div class="small muted"><?= View::e($ph['period']) ?></div></div>
          </div>
        <?php endforeach; ?>
      </div>
    </section>
  <?php endif; ?>

  <!-- Condições -->
  <section>
    <div class="kicker">Condições comerciais</div>
    <h2>Pagamento e validade</h2>
    <div class="stack">
      <div class="row"><span class="label" style="width:130px">Pagamento</span><span class="grow"><?= View::e($prop['payment_terms'] ?: '50% no início + 50% na entrega') ?></span></div>
      <div class="row"><span class="label" style="width:130px">Validade</span><span class="grow"><?= $prop['valid_until'] ? date('d/m/Y', strtotime($prop['valid_until'])) : '—' ?></span></div>
      <?php if (!empty($settings['show_pix_in_proposals']) && !empty($settings['pix_key'])): ?>
        <div class="row"><span class="label" style="width:130px">PIX</span>
          <span class="grow"><?= View::e($settings['pix_key']) ?> <span class="muted small">(<?= View::e($settings['pix_key_type']) ?>)</span></span></div>
      <?php endif; ?>
      <?php if (!empty($prop['terms_text'])): ?>
        <div class="divider"></div>
        <div><?= $prop['terms_text'] /* já sanitizado */ ?></div>
      <?php endif; ?>
    </div>
  </section>

  <!-- Fechamento -->
  <section>
    <div class="kicker">Fechamento</div>
    <h2>Vamos começar este projeto?</h2>
    <div class="row" style="flex-direction:column;gap:8px">
      <button class="btn btn-secondary btn-block" type="button" data-open-sheet="sheet-change">Solicitar alteração</button>
      <button class="btn btn-secondary btn-block" type="button" data-open-sheet="sheet-decline">Recusar proposta</button>
    </div>
  </section>

  <?php if (!$acceptance && !$expired && !$previewMode): ?>
    <div class="cta-fixed">
      <button class="btn btn-primary" style="box-shadow: var(--shadow-accept)" data-open-sheet="sheet-accept">ACEITAR PROPOSTA</button>
    </div>
  <?php endif; ?>
</article>

<!-- Folha de aceite -->
<div id="backdrop-sheet-accept" class="sheet-backdrop hidden" data-close-sheet="sheet-accept"></div>
<div id="sheet-accept" class="sheet hidden">
  <div class="handle"></div>
  <h3>Você está de acordo com esta proposta?</h3>
  <p class="small muted"><?= View::e($prop['number']) ?> · <?= Money::br(($prop['total_monthly']*12) + $prop['total_once']) ?></p>
  <form method="post" action="/p/<?= View::e($prop['public_token']) ?>/accept" class="stack mt-4">
    <?= Csrf::field() ?>
    <input class="input" name="name"  placeholder="Nome completo" required>
    <input class="input" name="email" placeholder="E-mail" type="email" required>
    <input class="input" name="doc"   placeholder="CPF ou CNPJ" required>
    <label style="display:flex;gap:8px;align-items:flex-start">
      <input type="checkbox" id="accept-terms" name="terms" value="1">
      <span class="small">Li e concordo com os termos desta proposta.</span>
    </label>
    <button class="btn btn-primary btn-block" id="accept-btn" type="submit" disabled>ACEITAR PROPOSTA</button>
    <button class="btn btn-secondary btn-block" type="button" data-close-sheet="sheet-accept">Cancelar</button>
  </form>
</div>

<!-- Solicitar alteração -->
<div id="backdrop-sheet-change" class="sheet-backdrop hidden" data-close-sheet="sheet-change"></div>
<div id="sheet-change" class="sheet hidden">
  <div class="handle"></div>
  <h3>Solicitar alteração</h3>
  <form method="post" action="/p/<?= View::e($prop['public_token']) ?>/request-change" class="stack mt-4">
    <?= Csrf::field() ?>
    <input class="input" name="name"  placeholder="Seu nome" required>
    <input class="input" name="email" placeholder="E-mail" type="email">
    <textarea class="textarea" name="message" placeholder="O que precisa ajustar?" required></textarea>
    <button class="btn btn-primary btn-block" type="submit">Enviar pedido</button>
    <button class="btn btn-secondary btn-block" type="button" data-close-sheet="sheet-change">Cancelar</button>
  </form>
</div>

<!-- Recusar -->
<div id="backdrop-sheet-decline" class="sheet-backdrop hidden" data-close-sheet="sheet-decline"></div>
<div id="sheet-decline" class="sheet hidden">
  <div class="handle"></div>
  <h3>Recusar proposta</h3>
  <form method="post" action="/p/<?= View::e($prop['public_token']) ?>/decline" class="stack mt-4">
    <?= Csrf::field() ?>
    <input class="input" name="name"  placeholder="Seu nome" required>
    <input class="input" name="email" placeholder="E-mail" type="email">
    <textarea class="textarea" name="message" placeholder="Motivo (opcional)"></textarea>
    <button class="btn btn-secondary btn-block" type="submit">Confirmar recusa</button>
    <button class="btn btn-primary btn-block" type="button" data-close-sheet="sheet-decline">Voltar</button>
  </form>
</div>
