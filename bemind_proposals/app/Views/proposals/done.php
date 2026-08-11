<?php
use App\Core\View;
/** @var array $p @var string $link @var string $wa */
$title = 'Proposta gerada';
?>
<div class="center" style="padding:20px 0">
  <div style="width:70px;height:70px;border-radius:50%;background:#E7F6EC;color:#1E7A45;
              display:inline-flex;align-items:center;justify-content:center;font:800 32px/1 var(--font-jkt)">✓</div>
  <h2 style="font:800 22px/1.15 var(--font-jkt);margin:14px 0 4px">Proposta gerada</h2>
  <div class="small muted mono"><?= View::e($p['number']) ?> · <?= View::e($p['client_name']) ?></div>
</div>

<div class="card">
  <div class="card-kicker">Link seguro do cliente</div>
  <div class="mono small" style="word-break:break-all;background:var(--bg-input);border:1px solid var(--line-strong);border-radius:12px;padding:12px"><?= View::e($link) ?></div>
</div>

<div class="actions" style="grid-template-columns:1fr 1fr;margin-top:14px">
  <a class="" href="https://wa.me/<?= View::e(preg_replace('/\D+/','',$p['client_whatsapp'] ?? '')) ?>?text=<?= rawurlencode($wa) ?>" target="_blank">
    WhatsApp<span class="sub">Enviar mensagem pronta</span>
  </a>
  <a href="mailto:<?= View::e($p['client_email'] ?? '') ?>?subject=<?= rawurlencode('Sua proposta ' . $p['number']) ?>&body=<?= rawurlencode($wa) ?>">
    E-mail<span class="sub">Enviar por e-mail</span>
  </a>
  <a href="/proposals/<?= (int)$p['id'] ?>/pdf" target="_blank">
    PDF<span class="sub">Baixar / imprimir</span>
  </a>
  <button type="button" data-copy="<?= View::e($link) ?>">
    Copiar link<span class="sub">Coloca na área de transferência</span>
  </button>
</div>

<div class="row mt-6" style="justify-content:center">
  <a class="link" href="/dashboard">← Voltar ao dashboard</a>
</div>
