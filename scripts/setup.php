<?php
/**
 * VisãoOS — Bootstrap Installer v2.1
 * ─────────────────────────────────────────────────────────────────────
 * 1. Upload deste arquivo para: public_html/setup.php (via SFTP)
 * 2. Acesse: https://www.bemindmarketing.com.br/setup.php
 * 3. APAGUE após a instalação!
 * ─────────────────────────────────────────────────────────────────────
 */

define('SETUP_VERSION', '2.1');
define('REPO_ZIP', 'https://github.com/mauriliobetonico-sys/bemind/archive/refs/heads/claude/analyze-system-improvements-8RLOE.zip');
define('REPO_DIR', 'bemind-claude-analyze-system-improvements-8RLOE');
define('DOMAIN',   'bemindmarketing.com.br');
define('TIMEOUT',  180);

if (file_exists(__DIR__ . '/.env') && !isset($_GET['force'])) {
    die('<h2 style="font-family:sans-serif;padding:20px">Sistema já instalado. Para reinstalar adicione <code>?force=1</code></h2>');
}

set_time_limit(300);
ini_set('display_errors', 0);
error_reporting(E_ALL);

function rnd(int $b = 16): string { return bin2hex(random_bytes($b)); }

function tryMysql(string $host, string $user, string $pass, string $db): array {
    // Tenta múltiplas formas de conexão para compatibilidade com Cloudez/Nginx
    $attempts = [];
    if ($host === 'localhost') {
        $attempts = [
            "mysql:host=localhost;dbname=$db;charset=utf8mb4",
            "mysql:host=127.0.0.1;port=3306;dbname=$db;charset=utf8mb4",
            "mysql:unix_socket=/var/run/mysqld/mysqld.sock;dbname=$db;charset=utf8mb4",
            "mysql:unix_socket=/tmp/mysql.sock;dbname=$db;charset=utf8mb4",
        ];
    } else {
        $attempts = ["mysql:host=$host;dbname=$db;charset=utf8mb4"];
    }

    $lastErr = '';
    foreach ($attempts as $dsn) {
        try {
            $pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE   => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_TIMEOUT   => 5,
            ]);
            // Tenta criar o banco se não existir (pode falhar sem permissão — tudo bem)
            try { $pdo->exec("CREATE DATABASE IF NOT EXISTS `$db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); } catch (Exception $e) {}
            $pdo->exec("USE `$db`");
            return ['ok' => true, 'pdo' => $pdo, 'dsn' => $dsn];
        } catch (PDOException $e) {
            $lastErr = $e->getMessage();
        }
    }
    return ['ok' => false, 'msg' => $lastErr];
}

function downloadRepo(string $tmpDir): array {
    $zip = $tmpDir . '/repo.zip';

    // tenta curl primeiro
    if (function_exists('curl_init')) {
        $ch = curl_init(REPO_ZIP);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => TIMEOUT,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT      => 'VisaoOS-Installer/2.1',
        ]);
        $data = curl_exec($ch);
        $err  = curl_error($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if (!$data || $code !== 200) return ['ok' => false, 'msg' => "Download falhou (HTTP $code): $err"];
    } else {
        $ctx  = stream_context_create(['http' => ['timeout' => TIMEOUT, 'follow_location' => true, 'user_agent' => 'VisaoOS-Installer/2.1']]);
        $data = @file_get_contents(REPO_ZIP, false, $ctx);
        if (!$data) return ['ok' => false, 'msg' => 'curl e file_get_contents falharam. Verifique se allow_url_fopen está habilitado.'];
    }

    file_put_contents($zip, $data);
    $z = new ZipArchive();
    if ($z->open($zip) !== true) return ['ok' => false, 'msg' => 'Erro ao abrir ZIP baixado'];
    $z->extractTo($tmpDir);
    $z->close();
    unlink($zip);

    $dir = $tmpDir . '/' . REPO_DIR;
    if (!is_dir($dir)) return ['ok' => false, 'msg' => "Pasta não encontrada após extração: $dir"];
    return ['ok' => true, 'dir' => $dir];
}

function copyVisaoos(string $repoDir, string $appDir): void {
    $src = $repoDir . '/visaoos';
    if (!is_dir($src)) throw new RuntimeException("Pasta visaoos não encontrada em: $src");
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($src, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($it as $item) {
        $dst = $appDir . '/' . $it->getSubPathname();
        if ($item->isDir()) { if (!is_dir($dst)) mkdir($dst, 0755, true); }
        else                 { copy($item->getRealPath(), $dst); chmod($dst, 0644); }
    }
    foreach (['uploads', 'logs'] as $d) {
        if (!is_dir("$appDir/$d")) mkdir("$appDir/$d", 0775, true);
        chmod("$appDir/$d", 0775);
    }
}

function buildEnv(string $appDir, array $c, string $dbAppPass): void {
    $env = "# VisãoOS — gerado em " . date('d/m/Y H:i') . "\n"
         . "APP_URL=https://{$c['domain']}\nAPP_ENV=production\nAPP_VERSION=2.0\n\n"
         . "DB_HOST={$c['db_host']}\nDB_PORT=3306\nDB_NAME={$c['db_name']}\n"
         . "DB_USER=visaoos_user\nDB_PASS=$dbAppPass\n\n"
         . "JWT_SECRET=" . rnd(32) . "\nJWT_EXPIRES=86400\n\n"
         . "WS_PORT=6001\nWS_SECRET=" . rnd(16) . "\n\n"
         . "N8N_WEBHOOK_BASE=https://n8n.{$c['domain']}/webhook\n"
         . "NEXTCLOUD_URL=https://cloud2.{$c['domain']}\nNEXTCLOUD_USER=admin\nNEXTCLOUD_PASS=" . rnd(12) . "\n\n"
         . "SMTP_HOST={$c['smtp_host']}\nSMTP_PORT={$c['smtp_port']}\n"
         . "SMTP_USER={$c['smtp_user']}\nSMTP_PASS={$c['smtp_pass']}\n"
         . "SMTP_FROM=noreply@{$c['domain']}\nADMIN_EMAIL={$c['admin_email']}\n\n"
         . "VISAOOS_API_TOKEN=" . rnd(24) . "\n";
    file_put_contents("$appDir/.env", $env);
    chmod("$appDir/.env", 0600);
}

function runSchema(string $appDir): bool {
    try {
        foreach (file("$appDir/.env") as $line) {
            $line = trim($line);
            if (!$line || $line[0] === '#') continue;
            [$k, $v] = array_pad(explode('=', $line, 2), 2, '');
            putenv(trim($k) . '=' . trim($v));
            $_ENV[trim($k)] = trim($v);
        }
        define('_VISAOOS_', true);
        require_once "$appDir/config/database.php";
        installDB();
        return true;
    } catch (Throwable $e) {
        error_log('VisaoOS installSchema: ' . $e->getMessage());
        return false;
    }
}

// ── Endpoints AJAX ────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    $action = $_POST['action'] ?? '';

    // Diagnóstico do ambiente
    if ($action === 'diag') {
        $sockets = [];
        foreach (['/var/run/mysqld/mysqld.sock','/tmp/mysql.sock','/run/mysqld/mysqld.sock'] as $s) {
            if (file_exists($s)) $sockets[] = $s;
        }
        echo json_encode([
            'php'        => PHP_VERSION,
            'dir'        => __DIR__,
            'pdo_mysql'  => extension_loaded('pdo_mysql'),
            'curl'       => function_exists('curl_init'),
            'zip'        => class_exists('ZipArchive'),
            'tmp'        => sys_get_temp_dir(),
            'tmp_write'  => is_writable(sys_get_temp_dir()),
            'sockets'    => $sockets,
            'server_ip'  => gethostbyname(gethostname()),
        ]);
        exit;
    }

    // Testa conexão MySQL
    if ($action === 'test_mysql') {
        $r = tryMysql($_POST['db_host'] ?? '', $_POST['db_user'] ?? '', $_POST['db_pass'] ?? '', $_POST['db_name'] ?? 'visaoos');
        echo json_encode(['ok' => $r['ok'], 'msg' => $r['msg'] ?? 'Conectado!', 'dsn' => $r['dsn'] ?? '']);
        exit;
    }

    // Instalação completa
    if ($action === 'install') {
        $appDir = __DIR__;
        $tmpDir = sys_get_temp_dir() . '/vsinstall-' . time();
        mkdir($tmpDir, 0755, true);
        try {
            // 1. MySQL
            $r = tryMysql($_POST['db_host'], $_POST['db_user'], $_POST['db_pass'], $_POST['db_name']);
            if (!$r['ok']) throw new RuntimeException('MySQL: ' . $r['msg']);

            // 2. Cria usuário da aplicação (ignora se não tiver permissão)
            $appPass = rnd(12);
            try {
                $r['pdo']->exec("CREATE USER IF NOT EXISTS 'visaoos_user'@'localhost' IDENTIFIED BY '$appPass'");
                $r['pdo']->exec("GRANT ALL PRIVILEGES ON `{$_POST['db_name']}`.* TO 'visaoos_user'@'localhost'");
                $r['pdo']->exec("FLUSH PRIVILEGES");
            } catch (Exception $e) {
                // Hospedagem compartilhada: usa o próprio usuário fornecido
                $appPass = $_POST['db_pass'];
                // Atualiza o .env para usar o usuário fornecido diretamente
            }

            // 3. Download
            $dl = downloadRepo($tmpDir);
            if (!$dl['ok']) throw new RuntimeException($dl['msg']);

            // 4. Copia arquivos
            copyVisaoos($dl['dir'], $appDir);

            // 5. .env
            buildEnv($appDir, [
                'domain'      => $_POST['domain']      ?? DOMAIN,
                'db_host'     => $_POST['db_host'],
                'db_name'     => $_POST['db_name'],
                'admin_email' => $_POST['admin_email'] ?? 'admin@' . DOMAIN,
                'smtp_host'   => $_POST['smtp_host']   ?? 'smtp.' . DOMAIN,
                'smtp_port'   => $_POST['smtp_port']   ?? '587',
                'smtp_user'   => $_POST['smtp_user']   ?? '',
                'smtp_pass'   => $_POST['smtp_pass']   ?? '',
            ], $appPass);

            // Atualiza DB_USER no .env se usou o usuário fornecido
            if ($appPass === $_POST['db_pass']) {
                $env = file_get_contents("$appDir/.env");
                $env = preg_replace('/^DB_USER=visaoos_user/m', 'DB_USER=' . $_POST['db_user'], $env);
                file_put_contents("$appDir/.env", $env);
            }

            // 6. Schema
            $schema = runSchema($appDir);

            exec('rm -rf ' . escapeshellarg($tmpDir));
            echo json_encode(['ok' => true, 'schema' => $schema, 'db_pass' => $appPass]);
        } catch (Throwable $e) {
            @exec('rm -rf ' . escapeshellarg($tmpDir));
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
body{font-family:'Segoe UI',system-ui,sans-serif;background:linear-gradient(135deg,#3b5bdb,#1971c2);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border-radius:16px;padding:36px;width:100%;max-width:520px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.logo{text-align:center;margin-bottom:24px}
.logo h1{font-size:26px;color:#3b5bdb;font-weight:800;margin-bottom:4px}
.logo p{color:#868e96;font-size:13px}
.progress{display:flex;gap:6px;margin-bottom:24px}
.bar{flex:1;height:4px;border-radius:2px;background:#e9ecef;transition:.3s}
.bar.on{background:#3b5bdb}.bar.ok{background:#2f9e44}
label{display:block;font-size:11px;font-weight:700;color:#495057;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 5px}
input{width:100%;padding:10px 13px;border:1.5px solid #dee2e6;border-radius:8px;font-size:14px;outline:none;transition:.2s}
input:focus{border-color:#3b5bdb}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.btn{width:100%;padding:13px;background:#3b5bdb;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin-top:20px;transition:.2s}
.btn:hover{background:#2c4fcc}.btn:disabled{background:#adb5bd;cursor:not-allowed}
.btn-green{background:#2f9e44}.btn-green:hover{background:#237032}
.alert{padding:13px 15px;border-radius:8px;font-size:13px;margin-bottom:14px;line-height:1.5}
.err{background:#fff5f5;border:1.5px solid #ffa8a8;color:#c92a2a}
.suc{background:#ebfbee;border:1.5px solid #8ce99a;color:#2f9e44}
.info{background:#e7f5ff;border:1.5px solid #74c0fc;color:#1864ab;font-size:12px}
.log{background:#1a1b1e;color:#a9e34b;padding:14px;border-radius:8px;font:12px/1.6 monospace;max-height:160px;overflow-y:auto;margin-top:14px;white-space:pre-wrap;display:none}
.creds{background:#f8f9fa;border-radius:10px;padding:18px;margin-top:14px}
.creds h3{font-size:14px;color:#333;margin-bottom:10px}
.cr{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #e9ecef;font-size:13px}
.cr:last-child{border:none}
.cr code{background:#e9ecef;padding:2px 7px;border-radius:4px;font-size:12px;color:#3b5bdb}
.warn{background:#fff9db;border:1.5px solid #ffd43b;border-radius:8px;padding:13px;font-size:13px;color:#664d03;margin-top:14px;line-height:1.6}
.sp{display:inline-block;width:16px;height:16px;border:2.5px solid rgba(255,255,255,.3);border-radius:50%;border-top-color:#fff;animation:sp .8s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="card">
    <div class="logo">
        <h1>⚙️ VisãoOS</h1>
        <p>Instalador Automático v<?= SETUP_VERSION ?></p>
    </div>
    <div class="progress">
        <div class="bar on"  id="b1"></div>
        <div class="bar"     id="b2"></div>
        <div class="bar"     id="b3"></div>
    </div>

    <!-- ── PASSO 1: MySQL ───────────────────────────────────────────── -->
    <div id="p1">
        <div class="alert info">
            💡 <strong>Onde encontrar as credenciais MySQL no Cloudez:</strong><br>
            Painel Cloudez → <strong>Databases</strong> → crie um banco e anote:<br>
            • Host do MySQL (geralmente <code>localhost</code> ou um IP)<br>
            • Usuário e senha criados no painel
        </div>
        <div class="alert err" id="e1" style="display:none"></div>
        <label>Host MySQL</label>
        <input id="db_host" value="localhost" placeholder="localhost ou IP fornecido pelo Cloudez">
        <label>Nome do Banco de Dados</label>
        <input id="db_name" value="visaoos" placeholder="Ex: bemindmarketing5_visaoos">
        <label>Usuário MySQL</label>
        <input id="db_user" placeholder="Usuário criado no painel Cloudez">
        <label>Senha MySQL</label>
        <input id="db_pass" type="password" placeholder="Senha do usuário MySQL">
        <button class="btn" id="btn1" onclick="testDb()">Testar Conexão →</button>
    </div>

    <!-- ── PASSO 2: Config ──────────────────────────────────────────── -->
    <div id="p2" style="display:none">
        <div class="alert suc" id="db_ok_msg"></div>
        <div class="alert err" id="e2" style="display:none"></div>
        <label>Domínio principal</label>
        <input id="domain" value="<?= DOMAIN ?>">
        <label>E-mail do administrador</label>
        <input id="admin_email" type="email" value="admin@<?= DOMAIN ?>">
        <label>Servidor SMTP</label>
        <input id="smtp_host" value="smtp.<?= DOMAIN ?>">
        <div class="row2">
            <div><label>Porta SMTP</label><input id="smtp_port" value="587"></div>
            <div><label>Usuário SMTP</label><input id="smtp_user" value="noreply@<?= DOMAIN ?>"></div>
        </div>
        <label>Senha SMTP <span style="font-weight:400;text-transform:none">(pode deixar em branco por enquanto)</span></label>
        <input id="smtp_pass" type="password" placeholder="Opcional por enquanto">
        <button class="btn" id="btn2" onclick="install()">🚀 Instalar VisãoOS</button>
        <div class="log" id="log"></div>
    </div>

    <!-- ── PASSO 3: Concluído ───────────────────────────────────────── -->
    <div id="p3" style="display:none">
        <div class="alert suc">✅ VisãoOS instalado com sucesso!</div>
        <div class="creds" id="creds"></div>
        <div class="warn">
            ⚠️ <strong>Faça isso agora:</strong><br>
            1. Copie as senhas acima para um local seguro<br>
            2. <strong>Apague este arquivo</strong> <code>setup.php</code> do servidor via SFTP<br>
            3. Acesse o sistema e troque a senha padrão <code>admin123</code>
        </div>
        <a id="link" href="https://<?= DOMAIN ?>" style="display:block;text-align:center;background:#2f9e44;color:#fff;padding:13px;border-radius:8px;font-weight:700;text-decoration:none;margin-top:16px">Acessar VisãoOS →</a>
    </div>
</div>

<script>
const $  = id => document.getElementById(id);
const L  = msg => { const el = $('log'); el.style.display='block'; el.textContent += msg+'\n'; el.scrollTop=el.scrollHeight; };
let dbCfg = {};

async function post(data) {
    const fd = new FormData();
    Object.entries(data).forEach(([k,v]) => fd.append(k,v));
    const r = await fetch(location.href, {method:'POST', body:fd});
    return r.json();
}

async function testDb() {
    const btn = $('btn1');
    btn.disabled = true;
    btn.innerHTML = '<span class="sp"></span>Testando conexão...';
    $('e1').style.display = 'none';

    dbCfg = {
        db_host: $('db_host').value.trim(),
        db_name: $('db_name').value.trim(),
        db_user: $('db_user').value.trim(),
        db_pass: $('db_pass').value,
    };

    try {
        const r = await post({action:'test_mysql', ...dbCfg});
        if (!r.ok) {
            $('e1').textContent = '❌ ' + r.msg;
            $('e1').style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = 'Testar novamente →';
            return;
        }
        // Sucesso
        $('b1').className = 'bar ok';
        $('b2').className = 'bar on';
        $('db_ok_msg').textContent = '✅ MySQL conectado! Banco "' + dbCfg.db_name + '" pronto.';
        $('p1').style.display = 'none';
        $('p2').style.display = 'block';
    } catch(e) {
        $('e1').textContent = 'Erro de rede: ' + e.message;
        $('e1').style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = 'Testar novamente →';
    }
}

async function install() {
    const btn = $('btn2');
    btn.disabled = true;
    btn.innerHTML = '<span class="sp"></span>Instalando... aguarde ~2 min';
    $('e2').style.display = 'none';
    $('log').textContent = '';
    L('[→] Iniciando instalação...');
    L('[→] Baixando arquivos do GitHub (~15 MB)...');

    const data = {
        action:      'install',
        domain:      $('domain').value,
        admin_email: $('admin_email').value,
        smtp_host:   $('smtp_host').value,
        smtp_port:   $('smtp_port').value,
        smtp_user:   $('smtp_user').value,
        smtp_pass:   $('smtp_pass').value,
        ...dbCfg,
    };

    try {
        const r = await post(data);
        if (!r.ok) {
            L('[✗] ERRO: ' + r.msg);
            $('e2').textContent = '❌ ' + r.msg;
            $('e2').style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = 'Tentar novamente';
            return;
        }
        L('[✓] Arquivos copiados');
        L('[✓] .env configurado');
        L(r.schema ? '[✓] Banco instalado' : '[!] Schema: acesse /api/health para verificar');
        L('[✓] Instalação concluída!');

        $('b2').className = 'bar ok';
        $('b3').className = 'bar ok';
        $('p2').style.display = 'none';
        $('p3').style.display = 'block';

        $('creds').innerHTML = `<h3>🔑 Credenciais</h3>
            <div class="cr"><strong>Sistema</strong><code>admin@${$('domain').value} / admin123</code></div>
            <div class="cr"><strong>DB senha (app)</strong><code>${r.db_pass}</code></div>
            <div class="cr"><strong>n8n</strong><code>https://n8n.${$('domain').value}</code></div>
            <div class="cr"><strong>Nextcloud</strong><code>https://cloud2.${$('domain').value}</code></div>
            <div class="cr"><strong>Metabase</strong><code>https://metabase.${$('domain').value}</code></div>`;
        $('link').href = 'https://' + $('domain').value;
    } catch(e) {
        L('[✗] Erro de rede: ' + e.message);
        $('e2').textContent = '❌ Erro de rede: ' + e.message;
        $('e2').style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = 'Tentar novamente';
    }
}
</script>
</body>
</html>
