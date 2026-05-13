<?php
/**
 * VisãoOS — Script de Reparo de Emergência
 *
 * COMO USAR:
 * 1. Faça upload deste arquivo para a raiz do site (www/) via SFTP
 * 2. Acesse: https://www.bemindmarketing.com.br/fix.php?key=bemind2025
 * 3. Siga as instruções na tela
 * 4. APAGUE este arquivo após o reparo!
 */

if (!isset($_GET['key']) || $_GET['key'] !== 'bemind2025') {
    http_response_code(403);
    die('Acesso negado.');
}

$action = $_GET['action'] ?? 'view';
if ($action !== 'view') header('Content-Type: text/html; charset=utf-8');

// ── Ação: baixa e instala arquivos do GitHub ──────────────────────────────
if ($action === 'install_files') {
    header('Content-Type: application/json');

    $branch  = 'claude/analyze-system-improvements-8RLOE';
    $zipUrl  = 'https://github.com/mauriliobetonico-sys/bemind/archive/refs/heads/' . rawurlencode($branch) . '.zip';
    $tmpZip  = sys_get_temp_dir() . '/visaoos_deploy_' . time() . '.zip';
    $tmpDir  = sys_get_temp_dir() . '/visaoos_extract_' . time();
    $webRoot = __DIR__;

    // Baixa o ZIP
    $ctx = stream_context_create(['http' => ['timeout' => 60, 'follow_location' => true,
        'header' => "User-Agent: VisaOOS-Installer/1.0\r\n"]]);
    $data = @file_get_contents($zipUrl, false, $ctx);
    if (!$data) {
        echo json_encode(['ok' => false, 'msg' => 'Falha ao baixar ZIP do GitHub. Verifique conexão do servidor.']);
        exit;
    }
    file_put_contents($tmpZip, $data);

    // Extrai
    $zip = new ZipArchive();
    if ($zip->open($tmpZip) !== true) {
        echo json_encode(['ok' => false, 'msg' => 'Falha ao extrair ZIP.']);
        exit;
    }
    $zip->extractTo($tmpDir);
    $zip->close();
    unlink($tmpZip);

    // Encontra a pasta extraída (bemind-<branch-slug>/)
    $dirs = glob($tmpDir . '/bemind-*', GLOB_ONLYDIR);
    if (empty($dirs)) {
        // tenta outro padrão
        $dirs = glob($tmpDir . '/*', GLOB_ONLYDIR);
    }
    if (empty($dirs)) {
        echo json_encode(['ok' => false, 'msg' => 'Estrutura do ZIP inesperada.']);
        exit;
    }
    $repoDir = $dirs[0];
    $srcDir  = $repoDir . '/visaoos';

    if (!is_dir($srcDir)) {
        echo json_encode(['ok' => false, 'msg' => "Pasta visaoos/ não encontrada em: $repoDir"]);
        exit;
    }

    // Copia recursivamente
    function rcopy(string $src, string $dst): void {
        if (!is_dir($dst)) mkdir($dst, 0755, true);
        foreach (new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST
        ) as $item) {
            $target = $dst . '/' . substr($item->getPathname(), strlen($src) + 1);
            if ($item->isDir()) {
                if (!is_dir($target)) mkdir($target, 0755, true);
            } else {
                copy($item->getPathname(), $target);
            }
        }
    }

    rcopy($srcDir, $webRoot);

    // Cria pastas necessárias
    foreach (['uploads', 'logs'] as $d) {
        $p = $webRoot . '/' . $d;
        if (!is_dir($p)) mkdir($p, 0775, true);
    }

    // Limpa temp
    rcopy('/dev/null', '/dev/null'); // dummy — limpeza manual abaixo
    $it = new RecursiveDirectoryIterator($tmpDir, FilesystemIterator::SKIP_DOTS);
    $files = new RecursiveIteratorIterator($it, RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($files as $file) {
        $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    }
    rmdir($tmpDir);

    $copied = file_exists($webRoot . '/config/database.php');
    echo json_encode(['ok' => $copied,
        'msg' => $copied ? 'Arquivos instalados com sucesso!' : 'Cópia falhou — verifique permissões.']);
    exit;
}

$action = $_GET['action'] ?? 'view';
header('Content-Type: text/html; charset=utf-8');

// ── Ação: escreve .env ────────────────────────────────────────────────────
if ($action === 'write_env') {
    $db_host = trim($_POST['db_host'] ?? 'localhost');
    $db_name = trim($_POST['db_name'] ?? 'visaoos');
    $db_user = trim($_POST['db_user'] ?? '');
    $db_pass = trim($_POST['db_pass'] ?? '');
    $domain  = trim($_POST['domain']  ?? 'bemindmarketing.com.br');
    $admin   = trim($_POST['admin_email'] ?? "admin@$domain");

    // Testa conexão antes de salvar
    $connected = false;
    $dbError   = '';
    foreach ([
        "mysql:host=$db_host;dbname=$db_name;charset=utf8mb4",
        "mysql:host=127.0.0.1;port=3306;dbname=$db_name;charset=utf8mb4",
        "mysql:unix_socket=/var/run/mysqld/mysqld.sock;dbname=$db_name;charset=utf8mb4",
        "mysql:unix_socket=/tmp/mysql.sock;dbname=$db_name;charset=utf8mb4",
    ] as $dsn) {
        try {
            new PDO($dsn, $db_user, $db_pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $connected = true;
            break;
        } catch (PDOException $e) {
            $dbError = $e->getMessage();
        }
    }

    if (!$connected) {
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'msg' => $dbError]);
        exit;
    }

    $jwt = bin2hex(random_bytes(32));
    $ws  = bin2hex(random_bytes(16));
    $api = bin2hex(random_bytes(24));

    $envContent = <<<ENV
# VisãoOS — Configuração de Ambiente
APP_URL=https://$domain
APP_ENV=production

DB_HOST=$db_host
DB_PORT=3306
DB_NAME=$db_name
DB_USER=$db_user
DB_PASS=$db_pass

JWT_SECRET=$jwt
JWT_EXPIRES=86400

WS_PORT=6001
WS_SECRET=$ws

N8N_WEBHOOK_BASE=https://n8n.$domain/webhook
NEXTCLOUD_URL=https://cloud2.$domain

SMTP_HOST=smtp.$domain
SMTP_PORT=587
SMTP_USER=noreply@$domain
SMTP_PASS=
SMTP_FROM=noreply@$domain
ADMIN_EMAIL=$admin

VISAOOS_API_TOKEN=$api
ENV;

    // Escreve na raiz do site (onde este script está)
    $envPath = __DIR__ . '/.env';
    file_put_contents($envPath, $envContent);
    chmod($envPath, 0600);

    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'path' => $envPath]);
    exit;
}

// ── Ação: instala/repara banco ────────────────────────────────────────────
if ($action === 'install_db') {
    $envFile = __DIR__ . '/.env';
    if (!file_exists($envFile)) {
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'msg' => 'Arquivo .env não encontrado. Configure primeiro.']);
        exit;
    }
    // Carrega .env
    foreach (file($envFile) as $line) {
        $line = trim($line);
        if ($line && str_contains($line, '=') && !str_starts_with($line, '#')) {
            [$k, $v] = explode('=', $line, 2);
            putenv(trim($k) . '=' . trim($v));
        }
    }
    try {
        // Inclui database.php para usar installDB()
        if (file_exists(__DIR__ . '/config/database.php')) {
            require_once __DIR__ . '/config/database.php';
            installDB();

            // Garante que admin usa email correto
            $adminEmail = getenv('ADMIN_EMAIL') ?: 'admin@bemindmarketing.com.br';
            $db = getDB();
            $exists = $db->prepare("SELECT id FROM users WHERE email=?");
            $exists->execute([$adminEmail]);
            if (!$exists->fetch()) {
                // Verifica se existe outro admin e atualiza o email
                $firstAdmin = $db->query("SELECT id FROM users WHERE role='admin' LIMIT 1")->fetch();
                if ($firstAdmin) {
                    $db->prepare("UPDATE users SET email=? WHERE id=?")->execute([$adminEmail, $firstAdmin['id']]);
                }
            }

            header('Content-Type: application/json');
            echo json_encode(['ok' => true, 'msg' => "Banco instalado! Login: $adminEmail / admin123"]);
        } else {
            header('Content-Type: application/json');
            echo json_encode(['ok' => false, 'msg' => 'config/database.php não encontrado. Faça upload dos arquivos do sistema.']);
        }
    } catch (Throwable $e) {
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'msg' => $e->getMessage()]);
    }
    exit;
}

// ── Ação: diagnóstico ─────────────────────────────────────────────────────
if ($action === 'diag') {
    header('Content-Type: application/json');
    $envFile = __DIR__ . '/.env';
    $hasEnv  = file_exists($envFile);
    $hasConfig = file_exists(__DIR__ . '/config/database.php');
    $hasIndex  = file_exists(__DIR__ . '/index.php');
    $hasHtaccess = file_exists(__DIR__ . '/.htaccess');

    $dbOk = false;
    $dbMsg = 'N/A';
    if ($hasEnv && $hasConfig) {
        foreach (file($envFile) as $line) {
            $line = trim($line);
            if ($line && str_contains($line, '=') && !str_starts_with($line, '#')) {
                [$k,$v] = explode('=',$line,2);
                putenv(trim($k).'='.trim($v));
            }
        }
        try {
            require_once __DIR__ . '/config/database.php';
            getDB()->query('SELECT 1');
            $dbOk = true;
            $dbMsg = 'Conectado';
        } catch (Throwable $e) {
            $dbMsg = $e->getMessage();
        }
    }

    echo json_encode([
        'php'       => PHP_VERSION,
        'web_root'  => __DIR__,
        'env_file'  => $hasEnv ? $envFile : 'NÃO ENCONTRADO',
        'has_config'=> $hasConfig,
        'has_index' => $hasIndex,
        'has_htaccess' => $hasHtaccess,
        'db_status' => $dbOk ? 'ok' : 'erro',
        'db_msg'    => $dbMsg,
        'extensions'=> [
            'pdo_mysql' => extension_loaded('pdo_mysql'),
            'json'      => extension_loaded('json'),
            'curl'      => extension_loaded('curl'),
            'mbstring'  => extension_loaded('mbstring'),
        ],
    ]);
    exit;
}

// ── Tela principal ────────────────────────────────────────────────────────
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VisãoOS — Reparo</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#f0f2f5;padding:20px}
.card{background:#fff;border-radius:12px;padding:28px;max-width:560px;margin:0 auto 20px;box-shadow:0 4px 16px rgba(0,0,0,.08)}
h1{color:#3b5bdb;font-size:22px;margin-bottom:4px}
h2{color:#333;font-size:16px;margin-bottom:18px}
.sub{color:#888;font-size:13px;margin-bottom:20px}
label{display:block;font-size:12px;font-weight:600;color:#555;margin:14px 0 4px}
input{width:100%;padding:9px 12px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:14px;outline:none}
input:focus{border-color:#3b5bdb}
button{background:#3b5bdb;color:#fff;border:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;width:100%;margin-top:18px}
button.sec{background:#2f9e44}
button.warn{background:#e67700}
.msg{padding:12px;border-radius:8px;font-size:13px;margin-top:14px}
.ok{background:#ebfbee;color:#2f9e44;border:1px solid #b2f2bb}
.err{background:#fff5f5;color:#c92a2a;border:1px solid #ffc9c9}
.info{background:#e7f5ff;color:#1864ab;border:1px solid #a5d8ff}
pre{background:#f8f9fa;border-radius:8px;padding:12px;font-size:12px;overflow-x:auto;margin-top:10px}
</style>
</head>
<body>
<div class="card">
  <h1>VisãoOS — Reparo de Emergência</h1>
  <div class="sub">Detecta e corrige problemas de configuração</div>

  <div id="diag-box" class="msg info">Carregando diagnóstico...</div>
  <pre id="diag-pre"></pre>
</div>

<div class="card">
  <h2>0. Instalar Arquivos do Sistema</h2>
  <p style="font-size:13px;color:#555">Baixa os arquivos PHP do VisãoOS direto do GitHub e instala na raiz do site. Necessário quando <code>has_config: false</code>.</p>
  <button class="warn" onclick="installFiles()">⬇ Baixar e Instalar Arquivos do GitHub</button>
  <div id="files-msg"></div>
</div>

<div class="card">
  <h2>1. Configurar Banco de Dados</h2>
  <label>Host MySQL</label>
  <input id="db_host" value="localhost">
  <label>Nome do Banco</label>
  <input id="db_name" value="visaoos">
  <label>Usuário MySQL</label>
  <input id="db_user" value="visaoos26">
  <label>Senha MySQL</label>
  <input id="db_pass" type="password" value="Visaoos2025">
  <label>Domínio</label>
  <input id="domain" value="bemindmarketing.com.br">
  <label>E-mail do Admin</label>
  <input id="admin_email" value="admin@bemindmarketing.com.br">
  <button onclick="writeEnv()">Salvar Configuração e Criar .env</button>
  <div id="env-msg"></div>
</div>

<div class="card">
  <h2>2. Instalar / Reparar Banco de Dados</h2>
  <p style="font-size:13px;color:#555">Cria as tabelas e o usuário admin se não existirem. Seguro de rodar múltiplas vezes.</p>
  <button class="sec" onclick="installDb()">Instalar / Reparar Banco</button>
  <div id="db-msg"></div>
</div>

<div class="card" style="background:#fff9db;border:1px solid #ffd43b">
  <p style="font-size:13px;color:#6b4c00"><strong>IMPORTANTE:</strong> Após concluir, acesse o sistema em <a href="https://www.bemindmarketing.com.br">https://www.bemindmarketing.com.br</a> e <strong>apague este arquivo fix.php do servidor</strong>.</p>
</div>

<script>
const key = '<?= htmlspecialchars($_GET['key']) ?>';
const base = location.pathname.replace('fix.php','');

async function diag() {
  try {
    const r = await fetch(`${base}fix.php?key=${key}&action=diag`);
    const d = await r.json();
    const ok = d.db_status === 'ok';
    const allFiles = d.has_config && d.has_index && d.has_htaccess;
    document.getElementById('diag-box').className = 'msg ' + (ok && allFiles ? 'ok' : 'err');
    document.getElementById('diag-box').textContent =
      ok && allFiles ? '✅ Sistema OK — DB conectado, arquivos presentes' :
      !allFiles ? '❌ Arquivos do sistema ausentes — faça upload via SFTP' :
      '⚠️ Banco sem conexão — configure abaixo';
    document.getElementById('diag-pre').textContent = JSON.stringify(d, null, 2);
  } catch(e) {
    document.getElementById('diag-box').className = 'msg err';
    document.getElementById('diag-box').textContent = 'Erro ao carregar diagnóstico: ' + e.message;
  }
}

async function writeEnv() {
  const box = document.getElementById('env-msg');
  box.innerHTML = '<div class="msg info">Salvando...</div>';
  const fd = new FormData();
  fd.append('db_host', document.getElementById('db_host').value);
  fd.append('db_name', document.getElementById('db_name').value);
  fd.append('db_user', document.getElementById('db_user').value);
  fd.append('db_pass', document.getElementById('db_pass').value);
  fd.append('domain',  document.getElementById('domain').value);
  fd.append('admin_email', document.getElementById('admin_email').value);
  try {
    const r = await fetch(`${base}fix.php?key=${key}&action=write_env`, {method:'POST',body:fd});
    const d = await r.json();
    box.innerHTML = `<div class="msg ${d.ok?'ok':'err'}">${d.ok?'✅ .env salvo em: '+d.path:'❌ '+d.msg}</div>`;
    if (d.ok) diag();
  } catch(e) {
    box.innerHTML = `<div class="msg err">❌ ${e.message}</div>`;
  }
}

async function installDb() {
  const box = document.getElementById('db-msg');
  box.innerHTML = '<div class="msg info">Instalando banco...</div>';
  try {
    const r = await fetch(`${base}fix.php?key=${key}&action=install_db`);
    const d = await r.json();
    box.innerHTML = `<div class="msg ${d.ok?'ok':'err'}">${d.ok?'✅ '+d.msg:'❌ '+d.msg}</div>`;
    if (d.ok) diag();
  } catch(e) {
    box.innerHTML = `<div class="msg err">❌ ${e.message}</div>`;
  }
}

async function installFiles() {
  const box = document.getElementById('files-msg');
  box.innerHTML = '<div class="msg info">Baixando arquivos do GitHub (pode levar 30-60 segundos)...</div>';
  try {
    const r = await fetch(`${base}fix.php?key=${key}&action=install_files`, {signal: AbortSignal.timeout(120000)});
    const d = await r.json();
    box.innerHTML = `<div class="msg ${d.ok?'ok':'err'}">${d.ok?'✅ '+d.msg:'❌ '+d.msg}</div>`;
    if (d.ok) setTimeout(diag, 1000);
  } catch(e) {
    box.innerHTML = `<div class="msg err">❌ ${e.message}</div>`;
  }
}

diag();
</script>
</body>
</html>
