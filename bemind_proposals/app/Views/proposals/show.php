<?php
use App\Core\Csrf;
use App\Core\Money;
use App\Core\View;
/** @var array $p @var array $items @var array $views @var ?array $acceptance
 *  @var array $schedule @var string $link @var string $wa */
$title   = $p['number'];
$backUrl = '/proposals';
$mon     = (float)$p['total_monthly'];
$once    = (float)$p['total_once'];
$viewsN  = (int)$p['views_count'];
?>
<div class="ink-card">
  <div class="row">
    <span class="badge <?= View::e($p['status']) ?>" style="background:rgba(255,255,255,.12);color:#fff"><?= View::e($p['status']) ?></span>
    <span class="mono small" style="margin-left:8px;color:rgba(255,255,255,.6)"><?= View::e($p['number']) ?></span>
  </div>
  <div style="margin-top:10px;font:800 20px/1.2 var(--font-jkt);letter-spacing:-.025em"><?= View::e($p['client_name']) ?></div>
  <div class="small" style="color:rgba(255,255,255,.7);margin-top:4px"><?= View::e($p['project'] ?: $p['title']) ?></div>
  <div class="divider" style="background:rgba(255,255,255,.14);margin:14px 0"></div>
  <div class="label">Investimento mensal</div>
  <div class="value coral tabular" style="font-size:24px;line-height:1;margin-top:6px"><?= Money::br($mon) ?></div>
  <?php if ($once > 0): ?>
    <div class="small" style="margin-top:6px;color:rgba(255,255,255,.7)">Investimento único <span class="tabular"><?= Money::br($once) ?></span></div>
  <?php endif; ?>
</div>

<?php if ($p['first_viewed_at']): ?>
  <div class="alert warn" style="margin-top:12px">
    Cliente visualizou sua proposta <?= $viewsN === 1 ? 'uma vez' : $viewsN . ' vezes' ?> · última <?= date('d/m/Y H:i', strtotime($p['last_viewed_at'])) ?>.
  </div>
<?php endif; ?>

<div class="card">
  <div class="card-title">Rastreamento</div>
  <div class="timeline">
    <div class="ev on"><div class="t">Criada</div><div class="s tabular"><?= date('d/m/Y H:i', strtotime($p['created_at'])) ?></div></div>
    <div class="ev <?= $p['sent_at'] ? 'on' : '' ?>"><div class="t">Enviada</div><div class="s tabular"><?= $p['sent_at'] ? date('d/m/Y H:i', strtotime($p['sent_at'])) : 'aguardando envio' ?></div></div>
    <div class="ev <?= $p['first_viewed_at'] ? 'on' : '' ?>"><div class="t">Primeira visualização</div><div class="s tabular"><?= $p['first_viewed_at'] ? date('d/m/Y H:i', strtotime($p['first_viewed_at'])) : '—' ?></div></div>
    <div class="ev <?= $p['last_viewed_at'] ? 'on' : '' ?>"><div class="t">Última visualização</div><div class="s tabular"><?= $p['last_viewed_at'] ? date('d/m/Y H:i', strtotime($p['last_viewed_at'])) : '—' ?></div></div>
    <div class="ev <?= $acceptance ? 'on' : '' ?>"><div class="t"><?= $acceptance ? 'Aceite registrado' : 'Aguardando aceite' ?></div>
      <div class="s tabular"><?= $acceptance ? date('d/m/Y H:i', strtotime($acceptance['accepted_at'])) . ' · ' . View::e($acceptance['name']) : '—' ?></div>
    </div>
  </div>
  <div class="row mt-4">
    <div class="grow"><span class="label">Visualizações</span><div class="tabular" style="font:800 18px/1 var(--font-jkt)"><?= $viewsN ?></div></div>
    <div class="grow"><span class="label">Último device</span><div class="mono small"><?= View::e($views[0]['device'] ?? '—') ?></div></div>
  </div>
</div>

<!-- Escopo (itens) -->
<div class="card">
  <div class="card-title">Escopo · <?= count($items) ?> itens</div>
  <?php if (!$items): ?><p class="muted">Nenhum item.</p><?php endif; ?>
  <?php foreach ($items as $it): $line = (float)$it['unit_price'] * max(1,(int)$it['quantity']); ?>
    <div class="list-item">
      <div class="grow">
        <div style="font:700 13.5px/1.25 var(--font-jkt)"><?= View::e($it['name']) ?></div>
        <div class="small muted"><?= View::e($it['recurrence']) ?> · qtd <?= (int)$it['quantity'] ?></div>
      </div>
      <div class="tabular" style="font:800 14.5px/1 var(--font-jkt);color:var(--coral-text)"><?= Money::br($line) ?></div>
    </div>
  <?php endforeach; ?>
</div>

<!-- Ações -->
<div class="actions" style="grid-template-columns:1fr 1fr">
  <a href="https://wa.me/<?= View::e(preg_replace('/\D+/','', $p['client_whatsapp'] ?? '')) ?>?text=<?= rawurlencode($wa) ?>" target="_blank">WhatsApp<span class="sub">Enviar link com mensagem</span></a>

  <form method="post" action="/proposals/<?= (int)$p['id'] ?>/send"><?= Csrf::field() ?>
    <input type="hidden" name="channel" value="email">
    <button type="submit" style="width:100%;text-align:left">E-mail<span class="sub">Enviar para o cliente</span></button>
  </form>

  <a href="/proposals/<?= (int)$p['id'] ?>/pdf" target="_blank">PDF<span class="sub">Baixar / imprimir</span></a>
  <button type="button" data-copy="<?= View::e($link) ?>">Copiar link<span class="sub"><?= View::e($link) ?></span></button>

  <form method="post" action="/proposals/<?= (int)$p['id'] ?>/duplicate"><?= Csrf::field() ?>
    <button type="submit" style="width:100%;text-align:left">Duplicar<span class="sub">Novo número, mesmo escopo</span></button>
  </form>

  <form method="post" action="/proposals/<?= (int)$p['id'] ?>/archive"><?= Csrf::field() ?>
    <button type="submit" style="width:100%;text-align:left">Arquivar<span class="sub">Some da lista principal</span></button>
  </form>
</div>

<div class="row mt-6" style="justify-content:center">
  <a class="link" href="/proposals/<?= (int)$p['id'] ?>/wizard?step=1">Editar escopo</a>
</div>
