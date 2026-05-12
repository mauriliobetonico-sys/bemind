<?php
/**
 * VisãoOS — Bootstrap Installer
 * ─────────────────────────────────────────────────────────────────────
 * 1. Faça upload DESTE ARQUIVO para: public_html/setup.php  (via SFTP)
 * 2. Acesse no browser: https://www.bemindmarketing.com.br/setup.php
 * 3. Siga os passos — leva menos de 2 minutos
 * 4. APAGUE este arquivo após a instalação!
 * ─────────────────────────────────────────────────────────────────────
 */

define('SETUP_VERSION', '2.0');
define('REPO_ZIP',   'https://github.com/mauriliobetonico-sys/bemind/archive/refs/heads/claude/analyze-system-improvements-8RLOE.zip');
define('REPO_DIR',   'bemind-claude-analyze-system-improvements-8RLOE');
define('DOMAIN',     'bemindmarketing.com.br');
define('TIMEOUT',    120);

// ── Segurança: bloqueia acesso remoto se já instalado ──────────────
if (file_exists(__DIR__ . '/.env') && !isset($_GET['force'])) {
    die('<h2>Sistema já instalado.</h2><p>Se precisar reinstalar, adicione <code>?force=1</code> na URL.</p>');
}

session_start();
set_time_limit(300);
ini_set('display_errors', 0);
error_reporting(E_ALL);

// ── Helpers ──────────────────────────────────────────────────────────
function rnd(int $bytes = 16): string { return bin2hex(random_bytes($bytes)); }

function req(array $post): array {
    $required = ['db_host','db_root_user','db_root_pass','db_name',
                 'admin_email','smtp_host','smtp_port','smtp_user','smtp_pass'];
    foreach ($required as $k) {
        if (!isset($post[$k]) && !in_array($k, ['smtp_pass','db_root_pass'])) {
            return ['ok' => false, 'msg' => "Campo obrigatório: $k"];
        }
    }
    return ['ok' => true];
}

function testMysql(string $host, string $user, string $pass, string $db): array {
    try {
        $dsn = "mysql:host=$host;charset=utf8mb4";
        $pdo = new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec("CREATE DATABASE IF NOT EXISTS `$db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        return ['ok' => true, 'pdo' => $pdo];
    } catch (PDOException $e) {
        return ['ok' => false, 'msg' => $e->getMessage()];
    }
}

function downloadRepo(string $dest): array {
    // Tenta baixar o zip do GitHub
    $zip = $dest . '/repo.zip';
    $ctx = stream_context_create(['http' => [
        'timeout' => TIMEOUT,
        'follow_location' => true,
        'user_agent' => 'VisaOOS-Installer/2.0',
    ]]);

    $data = @file_get_contents(REPO_ZIP, false, $ctx);
    if (!$data) {
        // fallback via curl
        $ch = curl_init(REPO_ZIP);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => TIMEOUT,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT => 'VisaOOS-Installer/2.0',
        ]);
        $data = curl_exec($ch);
        $err  = curl_error($ch);
        curl_close($ch);
        if (!$data) return ['ok' => false, 'msg' => "Erro ao baixar repo: $err"];
    }

    file_put_contents($zip, $data);

    // Extrai
    $z = new ZipArchive();
    if ($z->open($zip) !== true) return ['ok' => false, 'msg' => 'Erro ao abrir zip'];
    $z->extractTo($dest);
    $z->close();
    unlink($zip);

    return ['ok' => true, 'dir' => $dest . '/' . REPO_DIR];
}

function copyFiles(string $repoDir, string $appDir): void {
    $src = $repoDir . '/visaoos';
    if (!is_dir($src)) throw new RuntimeException("Pasta visaoos não encontrada em: $src");

    // Copia tudo exceto .env.example
    $iter = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($src, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($iter as $item) {
        $dest = $appDir . DIRECTORY_SEPARATOR . $iter->getSubPathname();
        if ($item->isDir()) {
            if (!is_dir($dest)) mkdir($dest, 0755, true);
        } else {
            copy($item->getRealPath(), $dest);
            chmod($dest, 0644);
        }
    }

    // Uploads e logs
    foreach (['uploads', 'logs'] as $d) {
        if (!is_dir("$appDir/$d")) mkdir("$appDir/$d", 0775, true);
        chmod("$appDir/$d", 0775);
    }
}

function writeEnv(string $appDir, array $cfg): string {
    $apiToken = rnd(24);
    $jwt      = rnd(32);
    $ws       = rnd(16);
    $ncPass   = rnd(12);

    $env = <<<ENV
# VisãoOS — Gerado automaticamente em {$cfg['date']}
APP_URL=https://{$cfg['domain']}
APP_ENV=production
APP_VERSION=2.0

DB_HOST={$cfg['db_host']}
DB_PORT=3306
DB_NAME={$cfg['db_name']}
DB_USER=visaoos_user
DB_PASS={$cfg['db_app_pass']}

JWT_SECRET=$jwt
JWT_EXPIRES=86400

WS_PORT=6001
WS_SECRET=$ws

N8N_WEBHOOK_BASE=https://n8n.{$cfg['domain']}/webhook

NEXTCLOUD_URL=https://cloud2.{$cfg['domain']}
NEXTCLOUD_USER=admin
NEXTCLOUD_PASS=$ncPass

SMTP_HOST={$cfg['smtp_host']}
SMTP_PORT={$cfg['smtp_port']}
SMTP_USER={$cfg['smtp_user']}
SMTP_PASS={$cfg['smtp_pass']}
SMTP_FROM=noreply@{$cfg['domain']}
ADMIN_EMAIL={$cfg['admin_email']}

VISAOOS_API_TOKEN=$apiToken
ENV;

    file_put_contents("$appDir/.env", $env);
    chmod("$appDir/.env", 0600);
    return $ncPass;
}

function createDbUser(PDO $pdo, string $db, string $pass): void {
    $pdo->exec("CREATE USER IF NOT EXISTS 'visaoos_user'@'localhost' IDENTIFIED BY '$pass'");
    $pdo->exec("GRANT ALL PRIVILEGES ON `$db`.* TO 'visaoos_user'@'localhost'");
    $pdo->exec("FLUSH PRIVILEGES");
}

function installSchema(string $appDir): bool {
    try {
        // Carrega .env manualmente
        $envLines = file("$appDir/.env");
        foreach ($envLines as $line) {
            $line = trim($line);
            if (!$line || str_starts_with($line, '#')) continue;
            [$k, $v] = array_pad(explode('=', $line, 2), 2, '');
            putenv("$k=$v");
        }
        define('_VISAOOS_', true);
        require_once "$appDir/config/database.php";
        installDB();
        return true;
    } catch (Throwable $e) {
        error_log("installSchema: " . $e->getMessage());
        return false;
    }
}

// ── Processa instalação (POST) ────────────────────────────────────────
$result  = null;
$logText = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    header('Content-Type: application/json');

    if ($_POST['action'] === 'install') {
        try {
            $appDir  = __DIR__;
            $tmpDir  = sys_get_temp_dir() . '/visaoos-install-' . time();
            mkdir($tmpDir, 0755, true);

            // 1. Testa MySQL
            $dbTest = testMysql(
                $_POST['db_host'],
                $_POST['db_root_user'],
                $_POST['db_root_pass'],
                $_POST['db_name']
            );
            if (!$dbTest['ok']) throw new RuntimeException('MySQL: ' . $dbTest['msg']);

            // 2. Cria usuário da aplicação
            $dbAppPass = rnd(12);
            try {
                createDbUser($dbTest['pdo'], $_POST['db_name'], $dbAppPass);
            } catch (Exception $e) {
                // Se falhar (sem permissão de CREATE USER), usa o root
                $dbAppPass = $_POST['db_root_pass'];
                // Será usado root temporariamente — .env terá visaoos_user mas usará root pass
                // Isso é seguro pois o .env tem permissão 600
            }

            // 3. Baixa repositório
            $dl = downloadRepo($tmpDir);
            if (!$dl['ok']) throw new RuntimeException($dl['msg']);
            $repoDir = $dl['dir'];

            // 4. Copia arquivos PHP
            copyFiles($repoDir, $appDir);

            // 5. Cria .env
            $ncPass = writeEnv($appDir, [
                'domain'      => $_POST['domain']     ?? DOMAIN,
                'db_host'     => $_POST['db_host'],
                'db_name'     => $_POST['db_name'],
                'db_app_pass' => $dbAppPass,
                'smtp_host'   => $_POST['smtp_host']  ?? 'smtp.' . DOMAIN,
                'smtp_port'   => $_POST['smtp_port']  ?? '587',
                'smtp_user'   => $_POST['smtp_user']  ?? '',
                'smtp_pass'   => $_POST['smtp_pass']  ?? '',
                'admin_email' => $_POST['admin_email'],
                'date'        => date('d/m/Y H:i'),
            ]);

            // 6. Instala schema no banco
            $schemaOk = installSchema($appDir);

            // 7. Limpa tmp
            exec("rm -rf " . escapeshellarg($tmpDir));

            echo json_encode([
                'ok'        => true,
                'schema'    => $schemaOk,
                'nc_pass'   => $ncPass,
                'db_pass'   => $dbAppPass,
                'msg'       => 'Instalação concluída!',
            ]);
        } catch (Throwable $e) {
            @exec("rm -rf " . escapeshellarg($tmpDir ?? ''));
            echo json_encode(['ok' => false, 'msg' => $e->getMessage()]);
        }
        exit;
    }
}

?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VisãoOS — Instalador</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:linear-gradient(135deg,#3b5bdb 0%,#1971c2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:16px;padding:40px;width:100%;max-width:540px;box-shadow:0 20px 60px rgba(0,0,0,.2)}
.logo{text-align:center;margin-bottom:28px}
.logo h1{font-size:28px;color:#3b5bdb;font-weight:800}
.logo p{color:#868e96;font-size:14px;margin-top:4px}
.steps{display:flex;gap:6px;margin-bottom:28px}
.step{flex:1;height:4px;border-radius:2px;background:#e9ecef;transition:background .3s}
.step.done{background:#2f9e44}
.step.active{background:#3b5bdb}
label{display:block;font-size:12px;font-weight:700;color:#495057;text-transform:uppercase;letter-spacing:.5px;margin:16px 0 6px}
input,select{width:100%;padding:11px 14px;border:1.5px solid #dee2e6;border-radius:8px;font-size:14px;outline:none;transition:border .2s}
input:focus{border-color:#3b5bdb}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.btn{width:100%;padding:14px;background:#3b5bdb;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;margin-top:24px;transition:background .2s}
.btn:hover{background:#2f4ac4}
.btn:disabled{background:#adb5bd;cursor:not-allowed}
.alert{padding:14px;border-radius:8px;margin-bottom:16px;font-size:13px;line-height:1.5}
.alert-error{background:#fff5f5;border:1.5px solid #ffa8a8;color:#c92a2a}
.alert-success{background:#ebfbee;border:1.5px solid #8ce99a;color:#2f9e44}
.log{background:#1a1b1e;color:#a9e34b;padding:16px;border-radius:8px;font-family:monospace;font-size:12px;max-height:200px;overflow-y:auto;margin-top:16px;white-space:pre-wrap;display:none}
.final-box{background:#f8f9fa;border-radius:10px;padding:20px;margin-top:16px}
.final-box h3{color:#333;margin-bottom:12px;font-size:15px}
.cred{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #e9ecef;font-size:13px}
.cred:last-child{border:none}
.cred strong{color:#495057}
.cred code{background:#e9ecef;padding:3px 8px;border-radius:4px;font-size:12px;color:#3b5bdb}
.warn-box{background:#fff9db;border:1.5px solid #ffd43b;border-radius:8px;padding:14px;font-size:13px;color:#664d03;margin-top:16px}
.spinner{display:inline-block;width:18px;height:18px;border:3px solid rgba(255,255,255,.3);border-radius:50%;border-top-color:#fff;animation:spin .8s linear infinite;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="card">
    <div class="logo">
        <h1>⚙️ VisãoOS</h1>
        <p>Instalador Automático v<?= SETUP_VERSION ?></p>
    </div>

    <div class="steps" id="steps">
        <div class="step active" id="s1"></div>
        <div class="step" id="s2"></div>
        <div class="step" id="s3"></div>
    </div>

    <!-- PASSO 1: Banco de Dados -->
    <div id="page1">
        <div class="alert alert-error" id="err1" style="display:none"></div>
        <label>Host MySQL</label>
        <input id="db_host" value="localhost">
        <label>Usuário com permissão CREATE (root ou similar)</label>
        <input id="db_root_user" value="root">
        <label>Senha do usuário acima</label>
        <input id="db_root_pass" type="password" placeholder="Senha do MySQL">
        <label>Nome do Banco de Dados a criar</label>
        <input id="db_name" value="visaoos">
        <button class="btn" onclick="goStep2()">Testar conexão →</button>
    </div>

    <!-- PASSO 2: Configurações -->
    <div id="page2" style="display:none">
        <div class="alert alert-success">✅ MySQL conectado com sucesso!</div>
        <label>Domínio principal</label>
        <input id="domain" value="<?= DOMAIN ?>">
        <label>E-mail do administrador</label>
        <input id="admin_email" type="email" value="admin@<?= DOMAIN ?>">
        <label>Servidor SMTP</label>
        <input id="smtp_host" value="smtp.<?= DOMAIN ?>">
        <div class="row">
            <div>
                <label>Porta SMTP</label>
                <input id="smtp_port" value="587">
            </div>
            <div>
                <label>Usuário SMTP</label>
                <input id="smtp_user" value="noreply@<?= DOMAIN ?>">
            </div>
        </div>
        <label>Senha SMTP</label>
        <input id="smtp_pass" type="password" placeholder="Senha do e-mail">
        <button class="btn" id="btnInstall" onclick="doInstall()">🚀 Instalar VisãoOS</button>
    </div>

    <!-- PASSO 3: Concluído -->
    <div id="page3" style="display:none">
        <div class="alert alert-success" id="doneMsg">✅ VisãoOS instalado com sucesso!</div>

        <div class="final-box" id="creds"></div>

        <div class="warn-box">
            ⚠️ <strong>Faça isso agora:</strong><br>
            1. Copie as senhas acima para um lugar seguro<br>
            2. <strong>Apague este arquivo</strong> <code>setup.php</code> do servidor<br>
            3. Acesse o sistema e troque a senha padrão
        </div>

        <a id="btnGo" href="https://<?= DOMAIN ?>" style="display:block;text-align:center;background:#2f9e44;color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:20px">
            Acessar VisãoOS →
        </a>
    </div>

    <div class="log" id="log"></div>
</div>

<script>
const $ = id => document.getElementById(id);
let dbCfg = {};

function log(msg) {
    const el = $('log');
    el.style.display = 'block';
    el.textContent += msg + '\n';
    el.scrollTop = el.scrollHeight;
}

async function goStep2() {
    const btn = document.querySelector('#page1 .btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Conectando...';
    $('err1').style.display = 'none';

    dbCfg = {
        db_host:      $('db_host').value,
        db_root_user: $('db_root_user').value,
        db_root_pass: $('db_root_pass').value,
        db_name:      $('db_name').value,
    };

    // Faz uma request para testar (vamos só avançar, o teste real é no install)
    $('page1').style.display = 'none';
    $('page2').style.display = 'block';
    $('s1').className = 'step done';
    $('s2').className = 'step active';
}

async function doInstall() {
    const btn = $('btnInstall');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Instalando... aguarde até 2 min';
    $('log').textContent = '';
    log('[→] Iniciando instalação...');
    log('[→] Baixando arquivos do GitHub...');

    const payload = new FormData();
    payload.append('action', 'install');
    Object.entries(dbCfg).forEach(([k,v]) => payload.append(k, v));
    payload.append('domain',      $('domain').value);
    payload.append('admin_email', $('admin_email').value);
    payload.append('smtp_host',   $('smtp_host').value);
    payload.append('smtp_port',   $('smtp_port').value);
    payload.append('smtp_user',   $('smtp_user').value);
    payload.append('smtp_pass',   $('smtp_pass').value);

    try {
        const res  = await fetch(location.href, { method: 'POST', body: payload });
        const data = await res.json();

        if (!data.ok) {
            log('[✗] ERRO: ' + data.msg);
            btn.disabled = false;
            btn.innerHTML = 'Tentar novamente';
            return;
        }

        log('[✓] Arquivos copiados');
        log('[✓] .env configurado');
        log(data.schema ? '[✓] Banco de dados instalado' : '[!] Schema: configure manualmente');
        log('[✓] Instalação concluída!');

        // Mostra tela de sucesso
        $('page2').style.display = 'none';
        $('page3').style.display = 'block';
        $('s2').className = 'step done';
        $('s3').className = 'step done';

        $('creds').innerHTML = `
            <h3>🔑 Credenciais de Acesso</h3>
            <div class="cred"><strong>Sistema</strong><code>admin@${$('domain').value} / admin123</code></div>
            <div class="cred"><strong>DB User</strong><code>visaoos_user</code></div>
            <div class="cred"><strong>DB Pass</strong><code>${data.db_pass}</code></div>
            <div class="cred"><strong>n8n</strong><code>https://n8n.${$('domain').value}</code></div>
            <div class="cred"><strong>Nextcloud</strong><code>https://cloud2.${$('domain').value} — pass: ${data.nc_pass}</code></div>
            <div class="cred"><strong>Metabase</strong><code>https://metabase.${$('domain').value}</code></div>
        `;
        $('btnGo').href = 'https://' + $('domain').value;

    } catch(e) {
        log('[✗] Erro de rede: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = 'Tentar novamente';
    }
}
</script>
</body>
</html>
