<?php
use App\Core\View;
/** @var array $users */
$title = 'Equipe';
$backUrl = '/settings';
?>
<div class="card">
  <div class="card-title">Usuários <span class="muted" style="margin-left:auto;font-weight:500"><?= count($users) ?></span></div>
  <?php foreach ($users as $u): ?>
    <a class="list-item" href="/users/<?= (int)$u['id'] ?>/edit" style="text-decoration:none;color:inherit">
      <?php $name = $u['name']; include __DIR__ . '/../partials/avatar.php'; ?>
      <div class="grow">
        <div style="font:700 14px/1.2 var(--font-jkt)"><?= View::e($u['name']) ?></div>
        <div class="small muted"><?= View::e($u['email']) ?><?= $u['last_login_at'] ? ' · último acesso ' . date('d/m H:i', strtotime($u['last_login_at'])) : '' ?></div>
      </div>
      <span class="badge <?= $u['role']==='admin' ? 'aprovada' : ($u['active'] ? 'enviada' : 'expirada') ?>">
        <?= View::e($u['role']) ?><?= $u['active'] ? '' : ' · inativo' ?>
      </span>
    </a>
  <?php endforeach; ?>
</div>

<a class="btn btn-primary btn-block mt-4" href="/users/new">＋ Convidar usuário</a>
