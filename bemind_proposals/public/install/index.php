<?php
declare(strict_types=1);

/**
 * BE MIND PROPOSALS — instalador web (wizard).
 * APAGAR /public/install após concluir.
 */

define('BMP_ROOT', dirname(__DIR__, 2));
require BMP_ROOT . '/app/Core/Autoloader.php';
\App\Core\Autoloader::register();

use App\Core\Csrf;
use App\Core\Env;

session_name('BMPINSTALL');
session_start();

$lockFile = BMP_ROOT . '/storage/installed.lock';
$envFile  = BMP_ROOT . '/.env';

$step = (int)($_GET['step'] ?? 1);
$err  = null;

if (is_file($lockFile) && empty($_GET['force'])) {
    render_locked();
    exit;
}

// ------------------- Ações POST ---------------------
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Csrf::check((string)($_POST['_csrf'] ?? ''))) {
        $err = 'Sessão expirada. Recarregue a página.';
    } else {
        try {
            switch ($step) {
                case 2: handle_database(); redirect_to(3); break;
                case 3: handle_admin();    redirect_to(4); break;
                case 4: handle_company();  redirect_to(5); break;
                case 5: handle_finalize(); redirect_to(6); break;
            }
        } catch (\Throwable $e) {
            $err = $e->getMessage();
        }
    }
}

render_layout(function () use ($step, $err) {
    switch ($step) {
        case 1: view_requirements();      break;
        case 2: view_database($err);      break;
        case 3: view_admin($err);         break;
        case 4: view_company($err);       break;
        case 5: view_review($err);        break;
        case 6: view_done();              break;
        default: view_requirements();
    }
});

// =====================================================================
// Handlers
// =====================================================================

function handle_database(): void
{
    $host = trim($_POST['db_host'] ?? 'localhost');
    $port = trim($_POST['db_port'] ?? '3306');
    $name = trim($_POST['db_name'] ?? '');
    $user = trim($_POST['db_user'] ?? '');
    $pass = (string)($_POST['db_pass'] ?? '');
    $url  = rtrim(trim($_POST['app_url'] ?? ''), '/');
    $tz   = trim($_POST['app_tz'] ?? 'America/Sao_Paulo');
    $mail_from = trim($_POST['mail_from'] ?? '');
    $wa   = preg_replace('/\D+/', '', $_POST['company_whatsapp'] ?? '') ?? '';

    if ($name === '' || $user === '' || $url === '') {
        throw new RuntimeException('Preencha URL, banco e usuário.');
    }

    // Tenta conectar (autocria o database se não existir).
    try {
        $pdo = new PDO("mysql:host={$host};port={$port};charset=utf8mb4", $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
    } catch (PDOException $e) {
        throw new RuntimeException('Falha ao conectar no MySQL: ' . $e->getMessage());
    }
    $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo->exec("USE `{$name}`");

    // Executa schema + seeds.
    run_sql_file($pdo, BMP_ROOT . '/database/schema.sql');
    run_sql_file($pdo, BMP_ROOT . '/database/seeds.sql');

    // Grava .env.
    $appKey = bin2hex(random_bytes(32));
    $env = <<<EOT
APP_ENV=production
APP_URL={$url}
APP_KEY={$appKey}
APP_TIMEZONE={$tz}

DATABASE_HOST={$host}
DATABASE_PORT={$port}
DATABASE_NAME={$name}
DATABASE_USER={$user}
DATABASE_PASSWORD={$pass}

MAIL_HOST=
MAIL_PORT=587
MAIL_USER=
MAIL_PASSWORD=
MAIL_ENCRYPTION=tls
MAIL_FROM={$mail_from}
MAIL_FROM_NAME="Be Mind Marketing"

COMPANY_WHATSAPP={$wa}

SESSION_LIFETIME=120
SESSION_SECURE=true
EOT;
    if (@file_put_contents(BMP_ROOT . '/.env', $env) === false) {
        throw new RuntimeException('Não foi possível gravar o arquivo .env. Ajuste permissões.');
    }
    $_SESSION['install'] = array_merge($_SESSION['install'] ?? [], ['db_ok' => true]);
}

function handle_admin(): void
{
    $name  = trim($_POST['admin_name']  ?? '');
    $email = strtolower(trim($_POST['admin_email'] ?? ''));
    $pass  = (string)($_POST['admin_pass'] ?? '');

    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($pass) < 8) {
        throw new RuntimeException('Nome, e-mail válido e senha (≥ 8 caracteres) são obrigatórios.');
    }
    ensure_env_loaded();
    $pdo = \App\Core\Db::conn();
    $hash = password_hash($pass, PASSWORD_DEFAULT);
    $st = $pdo->prepare('INSERT INTO users (name,email,password_hash,role,active) VALUES (:n,:e,:h,"admin",1)
                         ON DUPLICATE KEY UPDATE name=VALUES(name), password_hash=VALUES(password_hash), role="admin", active=1');
    $st->execute([':n' => $name, ':e' => $email, ':h' => $hash]);
    $_SESSION['install']['admin_ok'] = true;
}

function handle_company(): void
{
    $data = [
        'name'                  => trim($_POST['company_name'] ?? 'Be Mind Marketing'),
        'doc'                   => trim($_POST['company_doc']  ?? ''),
        'whatsapp'              => preg_replace('/\D+/', '', $_POST['company_whatsapp'] ?? ''),
        'email'                 => trim($_POST['company_email'] ?? ''),
        'proposal_prefix'       => trim($_POST['proposal_prefix'] ?? 'BEMIND-'),
        'pix_key_type'          => $_POST['pix_key_type'] ?? null,
        'pix_key'               => trim($_POST['pix_key']    ?? ''),
        'pix_holder'            => trim($_POST['pix_holder'] ?? ''),
        'pix_bank'              => trim($_POST['pix_bank']   ?? ''),
    ];
    if ($data['name'] === '') throw new RuntimeException('Informe o nome da empresa.');

    ensure_env_loaded();
    $pdo = \App\Core\Db::conn();

    // Upload do logo (opcional)
    $logoPath = null;
    if (!empty($_FILES['logo']['tmp_name']) && is_uploaded_file($_FILES['logo']['tmp_name'])) {
        $mime = mime_content_type($_FILES['logo']['tmp_name']) ?: '';
        if (!in_array($mime, ['image/png','image/jpeg','image/webp','image/svg+xml'], true)) {
            throw new RuntimeException('Logo deve ser PNG, JPG, WEBP ou SVG.');
        }
        $ext = match ($mime) {
            'image/png'  => 'png',
            'image/jpeg' => 'jpg',
            'image/webp' => 'webp',
            'image/svg+xml' => 'svg',
        };
        $filename = 'logo-' . bin2hex(random_bytes(4)) . '.' . $ext;
        $target = BMP_ROOT . '/public/uploads/' . $filename;
        if (!@move_uploaded_file($_FILES['logo']['tmp_name'], $target)) {
            throw new RuntimeException('Não foi possível gravar o logo em /public/uploads.');
        }
        $logoPath = '/uploads/' . $filename;
    }

    $sql = 'UPDATE company_settings
              SET name = :name, doc = :doc, whatsapp = :whatsapp, email = :email,
                  proposal_prefix = :prefix, pix_key = :pk, pix_key_type = :pt,
                  pix_holder = :ph, pix_bank = :pb'
         . ($logoPath ? ', logo_path = :logo' : '') .
          ' WHERE id = 1';
    $params = [
        ':name' => $data['name'], ':doc' => $data['doc'] ?: null,
        ':whatsapp' => $data['whatsapp'] ?: null, ':email' => $data['email'] ?: null,
        ':prefix' => $data['proposal_prefix'] ?: 'BEMIND-',
        ':pk' => $data['pix_key'] ?: null, ':pt' => $data['pix_key_type'] ?: null,
        ':ph' => $data['pix_holder'] ?: null, ':pb' => $data['pix_bank'] ?: null,
    ];
    if ($logoPath) $params[':logo'] = $logoPath;
    $pdo->prepare($sql)->execute($params);

    $_SESSION['install']['company_ok'] = true;
}

function handle_finalize(): void
{
    $storage = BMP_ROOT . '/storage';
    if (!is_dir($storage) && !@mkdir($storage, 0775, true)) {
        throw new RuntimeException('Crie a pasta /storage com permissão de escrita.');
    }
    if (@file_put_contents($storage . '/installed.lock', date('c') . "\n") === false) {
        throw new RuntimeException('Não foi possível gravar storage/installed.lock.');
    }
}

// =====================================================================
// Helpers
// =====================================================================

function run_sql_file(PDO $pdo, string $path): void
{
    if (!is_file($path)) throw new RuntimeException("Arquivo SQL não encontrado: {$path}");
    $sql = file_get_contents($path) ?: '';
    // remove linhas de comentário isoladas
    $sql = preg_replace('/^\s*--.*$/m', '', $sql) ?? $sql;
    // executa em bloco (respeita ; dentro de definições)
    $pdo->exec($sql);
}

function ensure_env_loaded(): void
{
    Env::load(BMP_ROOT . '/.env');
}

function redirect_to(int $step): void
{
    header('Location: /install/?step=' . $step);
    exit;
}

// =====================================================================
// Views
// =====================================================================

function render_locked(): void
{
    render_layout(function () { ?>
        <h1>Instalador bloqueado</h1>
        <p>O sistema já foi instalado (<code>storage/installed.lock</code> presente).</p>
        <p>Por segurança, <strong>apague a pasta <code>/public/install</code></strong> antes de expor o site.</p>
        <p><a class="btn btn-secondary" href="/">Voltar ao site</a></p>
    <?php });
}

function render_layout(callable $body): void
{ ?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Instalação · BE MIND PROPOSALS</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=Manrope:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/app.css">
<style>
  body { background: #EFEDE9; }
  .wrap { max-width: 640px; margin: 32px auto; padding: 24px; }
  .card h1 { font: 800 22px/1.15 "Plus Jakarta Sans"; letter-spacing:-.025em; margin-bottom: 8px; }
  .card p  { color: var(--ink-600); font: 500 13.5px/1.5 "Manrope"; margin: 8px 0; }
  .stepper { display:flex; gap:6px; margin-bottom:16px }
  .stepper span { flex:1; height:4px; border-radius:2px; background: var(--line-strong); }
  .stepper span.on { background: var(--coral); }
  .row { margin-bottom: 12px; }
  .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap: 12px; }
  .err { background:#FDEAE8;color:#B23A2E;border:1px solid #F6CAC4;padding:10px 12px;border-radius:12px;margin-bottom:12px;font:600 12.5px/1.4 "Manrope"; }
  code { background: var(--line-soft); padding:2px 6px; border-radius:6px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="stepper">
      <?php $s = (int)($_GET['step'] ?? 1); for ($i=1;$i<=6;$i++): ?>
        <span class="<?= $i <= $s ? 'on' : '' ?>"></span>
      <?php endfor; ?>
    </div>
    <?php $body(); ?>
  </div>
</div>
</body>
</html>
<?php }

function e(mixed $v): string { return htmlspecialchars((string)$v, ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'); }

function view_requirements(): void
{
    $checks = [
        ['PHP ≥ 8.1',                  version_compare(PHP_VERSION, '8.1', '>=')],
        ['extensão pdo_mysql',         extension_loaded('pdo_mysql')],
        ['extensão mbstring',          extension_loaded('mbstring')],
        ['extensão gd',                extension_loaded('gd')],
        ['extensão openssl',           extension_loaded('openssl')],
        ['gravar em /storage',         is_dir_writable(BMP_ROOT . '/storage')],
        ['gravar em /public/uploads',  is_dir_writable(BMP_ROOT . '/public/uploads')],
        ['gravar .env no raiz',        is_writable(BMP_ROOT)],
    ];
    $ok = !in_array(false, array_column($checks, 1), true);
    ?>
    <h1>1 · Requisitos</h1>
    <p>Confirme que o servidor atende o mínimo. Você pode ajustar permissões e recarregar.</p>
    <ul style="margin:16px 0;padding-left:18px">
        <?php foreach ($checks as [$label, $pass]): ?>
            <li style="color: <?= $pass ? '#1E7A45' : '#B23A2E' ?>; margin: 6px 0">
                <?= $pass ? '✓' : '✗' ?> <?= e($label) ?>
            </li>
        <?php endforeach; ?>
    </ul>
    <div style="display:flex;justify-content:flex-end;gap:8px">
        <?php if ($ok): ?>
            <a class="btn btn-primary" href="/install/?step=2">Continuar</a>
        <?php else: ?>
            <a class="btn btn-secondary" href="/install/?step=1">Verificar novamente</a>
        <?php endif; ?>
    </div>
    <?php
}

function is_dir_writable(string $dir): bool
{
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return is_dir($dir) && is_writable($dir);
}

function view_database(?string $err): void { ?>
    <h1>2 · Banco de dados</h1>
    <p>Informe o MySQL onde o sistema vai rodar. O instalador cria o database, aplica <code>schema.sql</code> e <code>seeds.sql</code>.</p>
    <?php if ($err): ?><div class="err"><?= e($err) ?></div><?php endif; ?>
    <form method="post" action="/install/?step=2" enctype="application/x-www-form-urlencoded">
        <?= Csrf::field() ?>
        <div class="row"><label class="label">URL do site</label>
            <input class="input" name="app_url" placeholder="https://propostas.bemindmarketing.com.br" required></div>
        <div class="grid-2">
            <div class="row"><label class="label">Fuso</label>
                <input class="input" name="app_tz" value="America/Sao_Paulo"></div>
            <div class="row"><label class="label">E-mail remetente</label>
                <input class="input" name="mail_from" type="email" placeholder="contato@bemindmarketing.com.br"></div>
        </div>
        <div class="grid-2">
            <div class="row"><label class="label">Host MySQL</label>
                <input class="input" name="db_host" value="localhost" required></div>
            <div class="row"><label class="label">Porta</label>
                <input class="input" name="db_port" value="3306"></div>
        </div>
        <div class="row"><label class="label">Nome do banco</label>
            <input class="input" name="db_name" required></div>
        <div class="grid-2">
            <div class="row"><label class="label">Usuário</label>
                <input class="input" name="db_user" required></div>
            <div class="row"><label class="label">Senha</label>
                <input class="input" name="db_pass" type="password"></div>
        </div>
        <div class="row"><label class="label">WhatsApp (apenas dígitos)</label>
            <input class="input" name="company_whatsapp" placeholder="5566996001122"></div>
        <button class="btn btn-primary" type="submit" style="width:100%">Testar, gravar .env e criar schema</button>
    </form>
<?php }

function view_admin(?string $err): void { ?>
    <h1>3 · Administrador</h1>
    <p>Crie o primeiro usuário — será o dono da conta.</p>
    <?php if ($err): ?><div class="err"><?= e($err) ?></div><?php endif; ?>
    <form method="post" action="/install/?step=3">
        <?= Csrf::field() ?>
        <div class="row"><label class="label">Nome</label>
            <input class="input" name="admin_name" required></div>
        <div class="row"><label class="label">E-mail</label>
            <input class="input" name="admin_email" type="email" required></div>
        <div class="row"><label class="label">Senha (≥ 8 caracteres)</label>
            <input class="input" name="admin_pass" type="password" minlength="8" required></div>
        <button class="btn btn-primary" type="submit" style="width:100%">Continuar</button>
    </form>
<?php }

function view_company(?string $err): void { ?>
    <h1>4 · Empresa</h1>
    <p>Dados que aparecem no cabeçalho das propostas e no PDF.</p>
    <?php if ($err): ?><div class="err"><?= e($err) ?></div><?php endif; ?>
    <form method="post" action="/install/?step=4" enctype="multipart/form-data">
        <?= Csrf::field() ?>
        <div class="row"><label class="label">Razão social</label>
            <input class="input" name="company_name" value="Be Mind Marketing" required></div>
        <div class="grid-2">
            <div class="row"><label class="label">CNPJ</label>
                <input class="input" name="company_doc" placeholder="00.000.000/0000-00"></div>
            <div class="row"><label class="label">WhatsApp</label>
                <input class="input" name="company_whatsapp" placeholder="55DDDNÚMERO"></div>
        </div>
        <div class="row"><label class="label">E-mail comercial</label>
            <input class="input" name="company_email" type="email"></div>
        <div class="row"><label class="label">Prefixo das propostas</label>
            <input class="input" name="proposal_prefix" value="BEMIND-"></div>

        <div style="margin:14px 0;padding:12px;border:1px dashed var(--line-strong);border-radius:14px">
            <strong style="font:700 12px/1 Manrope;letter-spacing:.14em;color:var(--gray-500);text-transform:uppercase">PIX</strong>
            <div class="grid-2" style="margin-top:8px">
                <div class="row"><label class="label">Tipo de chave</label>
                    <select class="input" name="pix_key_type">
                        <option value="">—</option>
                        <option value="cnpj">CNPJ</option>
                        <option value="cpf">CPF</option>
                        <option value="email">E-mail</option>
                        <option value="celular">Celular</option>
                        <option value="aleatoria">Aleatória</option>
                    </select>
                </div>
                <div class="row"><label class="label">Chave</label>
                    <input class="input" name="pix_key"></div>
            </div>
            <div class="grid-2">
                <div class="row"><label class="label">Favorecido</label>
                    <input class="input" name="pix_holder"></div>
                <div class="row"><label class="label">Banco</label>
                    <input class="input" name="pix_bank"></div>
            </div>
        </div>

        <div class="row"><label class="label">Logo (PNG/JPG/WEBP/SVG)</label>
            <input class="input" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></div>

        <button class="btn btn-primary" type="submit" style="width:100%">Continuar</button>
    </form>
<?php }

function view_review(?string $err): void { ?>
    <h1>5 · Confirmação</h1>
    <p>Tudo pronto. Vamos gravar <code>storage/installed.lock</code> — a partir daí, o instalador fica bloqueado.</p>
    <?php if ($err): ?><div class="err"><?= e($err) ?></div><?php endif; ?>
    <form method="post" action="/install/?step=5">
        <?= Csrf::field() ?>
        <button class="btn btn-primary" type="submit" style="width:100%">Finalizar instalação</button>
    </form>
<?php }

function view_done(): void { ?>
    <h1>6 · Instalação concluída ✓</h1>
    <p>Aplicativo pronto para uso.</p>
    <p style="color:#B23A2E"><strong>Importante:</strong> apague a pasta <code>/public/install</code> por FTP antes de expor o site.</p>
    <p><a class="btn btn-primary" href="/login" style="width:100%">Ir para o login</a></p>
<?php }
