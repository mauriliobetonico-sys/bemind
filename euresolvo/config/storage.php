<?php
// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — Upload/storage de arquivos (local; S3-compatible via env futuro)
// ══════════════════════════════════════════════════════════════════════════

function ensureUploadDir(string $subdir = ''): string {
    $base = rtrim(UPLOAD_DIR, '/') . '/';
    $dir = $subdir ? $base . trim($subdir, '/') . '/' : $base;
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    return $dir;
}

function saveUploadedFile(array $file, string $subdir = 'misc'): array {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Falha no upload (código ' . ($file['error'] ?? '?') . ').');
    }
    $maxBytes = UPLOAD_MAX_MB * 1024 * 1024;
    if (($file['size'] ?? 0) > $maxBytes) {
        throw new RuntimeException('Arquivo excede o limite de ' . UPLOAD_MAX_MB . ' MB.');
    }
    $orig = $file['name'] ?? 'file';
    $ext  = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
    if (!in_array($ext, ALLOWED_EXTS, true)) {
        throw new RuntimeException('Extensão não permitida (.' . $ext . ').');
    }
    $mime = mime_content_type($file['tmp_name']) ?: ($file['type'] ?? 'application/octet-stream');
    $safeName = bin2hex(random_bytes(12)) . '.' . $ext;
    $subdir = preg_replace('/[^a-z0-9_\/-]/i', '', $subdir);
    $dir = ensureUploadDir($subdir);
    $target = $dir . $safeName;
    if (!move_uploaded_file($file['tmp_name'], $target)) {
        throw new RuntimeException('Falha ao salvar o arquivo.');
    }
    return [
        'file_path'     => "uploads/$subdir/$safeName",
        'absolute'      => $target,
        'original_name' => $orig,
        'mime_type'     => $mime,
        'size'          => filesize($target),
    ];
}

function publicUploadUrl(string $relativePath): string {
    return APP_URL . '/' . ltrim($relativePath, '/');
}
