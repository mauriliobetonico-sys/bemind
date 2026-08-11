<?php
use App\Core\View;
$title = 'Mais';
$items = [
  ['/briefings',     'Briefings',        'Antes da proposta'],
  ['/services',      'Serviços',         'Biblioteca com preços padrão'],
  ['/cloud',         'Be Mind Cloud',    'Planos de hospedagem'],
  ['/templates',     'Modelos de proposta','Salvar e reutilizar'],
  ['/reports',       'Relatórios',       'Taxa de aprovação, ticket'],
  ['/notifications', 'Notificações',     'Aceites e visualizações'],
  ['/users',         'Equipe',           'Usuários e papéis'],
  ['/settings',      'Configurações',    'Empresa, PIX, preferências'],
  ['/export/proposals.csv','Exportar CSV','Propostas do mês'],
];
?>
<div class="card">
  <?php foreach ($items as [$url,$t,$sub]): ?>
    <a class="list-item" href="<?= $url ?>" style="text-decoration:none;color:inherit">
      <div class="grow">
        <div style="font:700 14px/1.2 var(--font-jkt)"><?= View::e($t) ?></div>
        <div class="small muted"><?= View::e($sub) ?></div>
      </div>
      <svg width="8" height="14" viewBox="0 0 8 14"><path d="M1 1L7 7L1 13" stroke="#C7C3BC" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>
    </a>
  <?php endforeach; ?>
</div>

<form method="post" action="/logout" style="margin-top:16px">
  <?= App\Core\Csrf::field() ?>
  <button class="btn btn-secondary btn-block" type="submit">Sair</button>
</form>
