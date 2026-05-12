<?php
// ══════════════════════════════════════════════════════════════════════════
// VISÃOOS — Armazenamento de Arquivos (Local + Nextcloud WebDAV)
// ══════════════════════════════════════════════════════════════════════════

function useNextcloud(): bool {
    return !empty(NEXTCLOUD_URL) && !empty(NEXTCLOUD_USER) && !empty(NEXTCLOUD_PASS);
}

// ── Upload de arquivo: tenta Nextcloud primeiro, fallback para local ───────
function storeFile(string $tmpPath, string $filename, int $osId): array {
    $result = [
        'filename'       => $filename,
        'file_path'      => null,
        'nextcloud_path' => null,
        'storage'        => 'local',
    ];

    if (useNextcloud()) {
        $ncPath = NEXTCLOUD_FOLDER . '/os-' . $osId . '/' . $filename;
        $ok = uploadToNextcloud($tmpPath, $ncPath);
        if ($ok) {
            $result['nextcloud_path'] = $ncPath;
            $result['storage']        = 'nextcloud';
            return $result;
        }
    }

    // Fallback: armazenamento local
    $uploadDir = UPLOAD_DIR . $osId . '/';
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
    $dest = $uploadDir . $filename;
    move_uploaded_file($tmpPath, $dest);
    $result['file_path'] = $dest;
    return $result;
}

// ── Upload via WebDAV para o Nextcloud ────────────────────────────────────
function uploadToNextcloud(string $filePath, string $remotePath): bool {
    $url = NEXTCLOUD_URL . '/remote.php/dav/files/' . NEXTCLOUD_USER . $remotePath;

    // Garante que o diretório existe
    $dir = dirname($remotePath);
    ensureNextcloudDir($dir);

    $fh   = fopen($filePath, 'r');
    $size = filesize($filePath);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_PUT            => true,
        CURLOPT_INFILE         => $fh,
        CURLOPT_INFILESIZE     => $size,
        CURLOPT_USERPWD        => NEXTCLOUD_USER . ':' . NEXTCLOUD_PASS,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $result = curl_exec($ch);
    $code   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    fclose($fh);

    return in_array($code, [200, 201, 204]);
}

// ── Cria diretório no Nextcloud (MKCOL) ──────────────────────────────────
function ensureNextcloudDir(string $remotePath): void {
    $parts  = array_filter(explode('/', trim($remotePath, '/')));
    $cumulative = '';
    foreach ($parts as $part) {
        $cumulative .= '/' . $part;
        $url = NEXTCLOUD_URL . '/remote.php/dav/files/' . NEXTCLOUD_USER . $cumulative;
        $ch  = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => 'MKCOL',
            CURLOPT_USERPWD        => NEXTCLOUD_USER . ':' . NEXTCLOUD_PASS,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        curl_exec($ch);
        curl_close($ch);
    }
}

// ── Gera URL de download (Nextcloud share ou local) ───────────────────────
function getFileUrl(array $file): string {
    if (!empty($file['nextcloud_path'])) {
        return APP_URL . '/api/os/' . $file['os_id'] . '/files/' . $file['id'] . '/download';
    }
    if (!empty($file['file_path'])) {
        $relative = str_replace(UPLOAD_DIR, 'uploads/', $file['file_path']);
        return APP_URL . '/' . $relative;
    }
    return '';
}

// ── Download de arquivo do Nextcloud (stream) ──────────────────────────────
function streamNextcloudFile(string $remotePath, string $filename, string $mimeType): void {
    $url = NEXTCLOUD_URL . '/remote.php/dav/files/' . NEXTCLOUD_USER . $remotePath;

    header('Content-Type: ' . ($mimeType ?: 'application/octet-stream'));
    header('Content-Disposition: attachment; filename="' . addslashes($filename) . '"');

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_USERPWD        => NEXTCLOUD_USER . ':' . NEXTCLOUD_PASS,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    curl_exec($ch);
    curl_close($ch);
    exit;
}
