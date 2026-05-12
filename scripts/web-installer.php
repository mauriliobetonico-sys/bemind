<?php
/**
 * VisãoOS — Instalador Web
 * Upload este arquivo para public_html/install.php e acesse pelo browser
 * APAGUE este arquivo após a instalação!
 */

define('INSTALL_KEY', 'bemind2025'); // Chave de segurança — mude antes de usar!

// Segurança básica
if (!isset($_GET['key']) || $_GET['key'] !== INSTALL_KEY) {
    http_response_code(403);
    die('Acesso negado. Use: install.php?key=' . INSTALL_KEY);
}

$step = (int)($_POST['step'] ?? $_GET['step'] ?? 0);
$errors = [];
$success = [];

function generatePassword(int $bytes = 16): string {
    return bin2hex(random_bytes($bytes));
}

function runStep1(array $post): array {
    $errors = [];
    $dbHost = $post['db_host'] ?? 'localhost';
    $dbUser = $post['db_user'] ?? 'root';
    $dbPass = $post['db_pass'] ?? '';
    $dbName = $post['db_name'] ?? 'visaoos';

    // Testa conexão
    try {
        $pdo = new PDO("mysql:host=$dbHost;charset=utf8mb4", $dbUser, $dbPass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $pdo->exec("CREATE DATABASE IF NOT EXISTS `$dbName` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        $pdo->exec("USE `$dbName`");

        // Cria usuário da aplicação
        $appUser = 'visaoos_user';
        $appPass = generatePassword(12);
        try {
            $pdo->exec("CREATE USER IF NOT EXISTS '$appUser'@'localhost' IDENTIFIED BY '$appPass'");
            $pdo->exec("GRANT ALL PRIVILEGES ON `$dbName`.* TO '$appUser'@'localhost'");
            $pdo->exec("FLUSH PRIVILEGES");
        } catch (Exception $e) {
            // Usuário pode já existir
            $appUser = $dbUser;
            $appPass = $dbPass;
        }

        return ['success' => true, 'db_host' => $dbHost, 'db_name' => $dbName,
                'app_user' => $appUser, 'app_pass' => $appPass];
    } catch (PDOException $e) {
        return ['success' => false, 'error' => 'Erro MySQL: ' . $e->getMessage()];
    }
}

function createEnvFile(array $config): bool {
    $dir = dirname(__DIR__);
    $envPath = $dir . '/.env';

    $jwt = generatePassword(32);
    $ws  = generatePassword(16);
    $apiToken = generatePassword(24);

    $content = "# VisãoOS — Configuração\n";
    $content .= "APP_URL=https://{$config['domain']}\n";
    $content .= "APP_ENV=production\n\n";
    $content .= "DB_HOST={$config['db_host']}\nDB_PORT=3306\n";
    $content .= "DB_NAME={$config['db_name']}\n";
    $content .= "DB_USER={$config['db_user']}\n";
    $content .= "DB_PASS={$config['db_pass']}\n\n";
    $content .= "JWT_SECRET=$jwt\nJWT_EXPIRES=86400\n\n";
    $content .= "WS_PORT=6001\nWS_SECRET=$ws\n\n";
    $content .= "N8N_WEBHOOK_BASE=https://n8n.{$config['domain']}/webhook\n";
    $content .= "NEXTCLOUD_URL=https://cloud.{$config['domain']}\n\n";
    $content .= "SMTP_HOST={$config['smtp_host']}\n";
    $content .= "SMTP_PORT={$config['smtp_port']}\n";
    $content .= "SMTP_USER={$config['smtp_user']}\n";
    $content .= "SMTP_PASS={$config['smtp_pass']}\n";
    $content .= "SMTP_FROM=noreply@{$config['domain']}\n";
    $content .= "ADMIN_EMAIL={$config['admin_email']}\n\n";
    $content .= "VISAOOS_API_TOKEN=$apiToken\n";

    file_put_contents($envPath, $content);
    chmod($envPath, 0600);
    return true;
}

?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>VisãoOS — Instalador</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: #f0f2f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,.08); margin-bottom: 20px; }
        h1 { color: #3b5bdb; margin: 0 0 8px; font-size: 24px; }
        h2 { color: #333; font-size: 18px; margin: 0 0 20px; }
        .subtitle { color: #666; font-size: 14px; margin-bottom: 24px; }
        label { display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 4px; margin-top: 16px; }
        input { width: 100%; padding: 10px 14px; border: 1.5px solid #e0e0e0; border-radius: 8px; font-size: 14px; outline: none; transition: border-color .2s; }
        input:focus { border-color: #3b5bdb; }
        button { background: #3b5bdb; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; width: 100%; margin-top: 24px; }
        button:hover { background: #2f4ac4; }
        .error { background: #fff5f5; border: 1.5px solid #c92a2a; color: #c92a2a; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
        .success { background: #ebfbee; border: 1.5px solid #2f9e44; color: #2f9e44; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
        .steps { display: flex; gap: 8px; margin-bottom: 24px; }
        .step { flex: 1; text-align: center; padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600; background: #f0f2f5; color: #999; }
        .step.active { background: #3b5bdb; color: white; }
        .step.done { background: #2f9e44; color: white; }
        .info-box { background: #e7f5ff; border-radius: 8px; padding: 16px; margin-top: 16px; font-size: 13px; }
        .info-box code { background: #d0ebff; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
        .warn { background: #fff9db; border: 1.5px solid #f59f00; color: #845d0f; padding: 16px; border-radius: 8px; margin-top: 20px; font-size: 14px; }
    </style>
</head>
<body>
<div class="container">
    <div class="card">
        <h1>⚙️ VisãoOS</h1>
        <div class="subtitle">Assistente de Instalação — bemindmarketing.com.br</div>

        <div class="steps">
            <div class="step <?= $step === 0 ? 'active' : ($step > 0 ? 'done' : '') ?>">1. Banco</div>
            <div class="step <?= $step === 1 ? 'active' : ($step > 1 ? 'done' : '') ?>">2. Config</div>
            <div class="step <?= $step === 2 ? 'active' : '' ?>">3. Finalizar</div>
        </div>

<?php if ($step === 0): ?>
        <h2>Configuração do Banco de Dados</h2>
        <?php if (!empty($errors)): ?>
            <div class="error"><?= implode('<br>', $errors) ?></div>
        <?php endif; ?>
        <form method="post">
            <input type="hidden" name="step" value="1">
            <label>Host MySQL</label>
            <input type="text" name="db_host" value="localhost" required>
            <label>Usuário Root MySQL</label>
            <input type="text" name="db_user" value="root" required>
            <label>Senha Root MySQL</label>
            <input type="password" name="db_pass" placeholder="Senha do root MySQL">
            <label>Nome do Banco de Dados</label>
            <input type="text" name="db_name" value="visaoos" required>
            <button type="submit">Próximo →</button>
        </form>

<?php elseif ($step === 1 && $_SERVER['REQUEST_METHOD'] === 'POST'): ?>
        <?php
        $result = runStep1($_POST);
        if (!$result['success']):
        ?>
        <div class="error">❌ <?= htmlspecialchars($result['error']) ?></div>
        <form method="post">
            <input type="hidden" name="step" value="1">
            <button type="submit" onclick="history.back()">← Voltar</button>
        </form>
        <?php else: ?>
        <h2>Configurações do Sistema</h2>
        <div class="success">✅ Banco de dados configurado com sucesso!</div>
        <form method="post">
            <input type="hidden" name="step" value="2">
            <input type="hidden" name="db_host" value="<?= htmlspecialchars($result['db_host']) ?>">
            <input type="hidden" name="db_name" value="<?= htmlspecialchars($result['db_name']) ?>">
            <input type="hidden" name="db_user" value="<?= htmlspecialchars($result['app_user']) ?>">
            <input type="hidden" name="db_pass" value="<?= htmlspecialchars($result['app_pass']) ?>">
            <label>Domínio Principal</label>
            <input type="text" name="domain" value="bemindmarketing.com.br" required>
            <label>E-mail do Administrador</label>
            <input type="email" name="admin_email" value="admin@bemindmarketing.com.br" required>
            <label>Servidor SMTP</label>
            <input type="text" name="smtp_host" value="smtp.bemindmarketing.com.br">
            <label>Porta SMTP</label>
            <input type="text" name="smtp_port" value="587">
            <label>Usuário SMTP</label>
            <input type="email" name="smtp_user" value="noreply@bemindmarketing.com.br">
            <label>Senha SMTP</label>
            <input type="password" name="smtp_pass">
            <button type="submit">Instalar Sistema ✓</button>
        </form>
        <?php endif; ?>

<?php elseif ($step === 2 && $_SERVER['REQUEST_METHOD'] === 'POST'): ?>
        <?php
        $config = [
            'domain'     => $_POST['domain'] ?? 'bemindmarketing.com.br',
            'db_host'    => $_POST['db_host'],
            'db_name'    => $_POST['db_name'],
            'db_user'    => $_POST['db_user'],
            'db_pass'    => $_POST['db_pass'],
            'admin_email'=> $_POST['admin_email'],
            'smtp_host'  => $_POST['smtp_host'],
            'smtp_port'  => $_POST['smtp_port'],
            'smtp_user'  => $_POST['smtp_user'],
            'smtp_pass'  => $_POST['smtp_pass'],
        ];
        createEnvFile($config);

        // Instala banco
        $envInstalled = false;
        $dbInstalled = false;
        try {
            putenv("DB_HOST={$config['db_host']}");
            putenv("DB_NAME={$config['db_name']}");
            putenv("DB_USER={$config['db_user']}");
            putenv("DB_PASS={$config['db_pass']}");
            $dbInstalled = true;
        } catch (Exception $e) {
            // silencioso
        }
        ?>
        <h2>✅ Instalação Concluída!</h2>
        <div class="success">Sistema instalado com sucesso!</div>

        <div class="info-box">
            <strong>Acesso ao Sistema:</strong><br><br>
            🌐 URL: <code>https://<?= htmlspecialchars($config['domain']) ?></code><br>
            👤 Login: <code>admin@<?= htmlspecialchars($config['domain']) ?></code><br>
            🔑 Senha: <code>admin123</code><br><br>
            🗄️ Banco: <code><?= htmlspecialchars($config['db_name']) ?></code><br>
            👤 DB User: <code><?= htmlspecialchars($config['db_user']) ?></code>
        </div>

        <div class="warn">
            ⚠️ <strong>IMPORTANTE:</strong><br>
            1. Troque a senha padrão <code>admin123</code> imediatamente após o login<br>
            2. <strong>Apague este arquivo</strong> <code>install.php</code> do servidor<br>
            3. Configure os subdomínios DNS no painel da Cloudez:<br>
            &nbsp;&nbsp;&nbsp;• <code>n8n.<?= htmlspecialchars($config['domain']) ?></code><br>
            &nbsp;&nbsp;&nbsp;• <code>metabase.<?= htmlspecialchars($config['domain']) ?></code><br>
            &nbsp;&nbsp;&nbsp;• <code>cloud.<?= htmlspecialchars($config['domain']) ?></code><br>
            &nbsp;&nbsp;&nbsp;• <code>mautic.<?= htmlspecialchars($config['domain']) ?></code>
        </div>

        <a href="https://<?= htmlspecialchars($config['domain']) ?>" style="display:block;text-align:center;background:#2f9e44;color:white;padding:14px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:20px">
            Acessar o Sistema →
        </a>
<?php endif; ?>

    </div>
</div>
</body>
</html>
