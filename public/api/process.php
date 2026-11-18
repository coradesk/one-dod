<?php
declare(strict_types=1);

require dirname(__DIR__, 2) . '/src/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_out(['error' => 'Metode tidak diizinkan'], 405);
}
set_time_limit(300);

$f = $_FILES['file'] ?? null;
if (!$f || !is_array($f) || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    $code = $f['error'] ?? UPLOAD_ERR_NO_FILE;
    $msg = in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
        ? 'File terlalu besar.' : 'Tidak ada file yang diunggah.';
    json_out(['error' => $msg], 400);
}
if ($f['size'] > $CFG['max_upload_mb'] * 1024 * 1024) {
    json_out(['error' => "File terlalu besar (maks. {$CFG['max_upload_mb']} MB)."], 413);
}

$allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/x-ms-bmp',
            'image/tiff', 'image/heic', 'image/heif', 'image/avif'];
$mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
if (!in_array($mime, $allowed, true)) {
    json_out(['error' => 'Format tidak didukung. Pakai JPG, PNG, WEBP, GIF, BMP, TIFF, HEIC, atau AVIF.'], 415);
}

$enhance = in_array($_POST['enhance'] ?? '', Pipeline::ENHANCE, true) ? $_POST['enhance'] : 'auto';
$bg = $_POST['bg'] ?? $CFG['default_bg_model'];
if (!isset($CFG['bg_models'][$bg]) && !in_array($bg, ['solid', 'off'], true)) {
    $bg = $CFG['default_bg_model'];
}
$margin = max(0, min(20, (float)($_POST['margin'] ?? 0))) / 100;

if (random_int(1, 20) === 1) {
    cleanup_jobs($CFG);
}

$id = bin2hex(random_bytes(12));
$dir = job_dir($CFG, $id);
if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
    json_out(['error' => 'Gagal menyiapkan penyimpanan.'], 500);
}

$base = safe_basename((string)$f['name']);
try {
    $pipe = new Pipeline($CFG, new WorkerClient($CFG['worker_url'], $CFG['worker_timeout']));
    $meta = $pipe->run($f['tmp_name'], $dir, $base, ['enhance' => $enhance, 'bg' => $bg, 'margin' => $margin]);
} catch (Throwable $e) {
    array_map('unlink', glob("$dir/*") ?: []);
    @rmdir($dir);
    error_log('[imgtool] ' . $e->getMessage());
    $msg = $e instanceof RuntimeException || $e instanceof ImagickException
        ? $e->getMessage() : 'Terjadi galat saat memproses gambar.';
    json_out(['error' => $msg], 422);
}

$meta['id'] = $id;
$meta['name'] = $base;
$meta['opt'] = ['enhance' => $enhance, 'bg' => $bg, 'margin' => $margin];
file_put_contents("$dir/meta.json", json_encode($meta, JSON_UNESCAPED_UNICODE));
json_out(with_urls($meta, $id, $dir));
