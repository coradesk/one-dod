<?php
declare(strict_types=1);

/**
 * Render ulang output dari hasil koreksi manual di editor.
 * POST id, file (PNG RGBA berukuran sama dengan src.png), margin (0-20)
 */
require dirname(__DIR__, 2) . '/src/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_out(['error' => 'Metode tidak diizinkan'], 405);
}
set_time_limit(300);

try {
    $id = (string)($_POST['id'] ?? '');
    $dir = job_dir($CFG, $id);
    $raw = @file_get_contents("$dir/meta.json");
    if ($raw === false) {
        json_out(['error' => 'Hasil tidak ditemukan atau sudah kedaluwarsa. Proses ulang gambarnya.'], 404);
    }
    $meta = json_decode($raw, true);

    $f = $_FILES['file'] ?? null;
    if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK || $f['size'] > 40 * 1024 * 1024) {
        json_out(['error' => 'Data koreksi tidak valid.'], 400);
    }
    if ((new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']) !== 'image/png') {
        json_out(['error' => 'Data koreksi harus PNG.'], 415);
    }

    $src = new Imagick();
    $src->pingImage("$dir/src.png");
    $edit = new Imagick($f['tmp_name']);
    if ($edit->getImageWidth() !== $src->getImageWidth() || $edit->getImageHeight() !== $src->getImageHeight()) {
        json_out(['error' => 'Ukuran hasil koreksi tidak cocok dengan gambar sumber.'], 422);
    }
    $edit->setImageColorspace(Imagick::COLORSPACE_SRGB);
    $edit->setImagePage(0, 0, 0, 0);

    $opt = $meta['opt'] ?? ['enhance' => 'auto'];
    $margin = isset($_POST['margin']) ? max(0, min(20, (float)$_POST['margin'])) / 100 : ($opt['margin'] ?? 0);
    $pipe = new Pipeline($CFG, new WorkerClient($CFG['worker_url'], $CFG['worker_timeout']));
    $wasEnhanced = (bool)array_filter($meta['steps'], fn($s) => $s['key'] === 'enhance' && $s['done']);
    $res = $pipe->rerender($edit, $dir, $meta['name'], ['enhance' => $opt['enhance'] ?? 'auto', 'margin' => $margin], $wasEnhanced);
} catch (InvalidArgumentException $e) {
    json_out(['error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    error_log('[imgtool] render: ' . $e->getMessage());
    json_out(['error' => $e instanceof RuntimeException || $e instanceof ImagickException
        ? $e->getMessage() : 'Gagal merender ulang.'], 422);
}

$meta['files'] = $res['files'];
$meta['steps'] = array_merge(array_values(array_filter($meta['steps'], fn($s) => empty($s['post']))), $res['steps']);
$meta['warnings'] = $res['warnings'];
$meta['opt']['margin'] = $margin;
$meta['edited'] = true;
file_put_contents("$dir/meta.json", json_encode($meta, JSON_UNESCAPED_UNICODE));
$meta['seconds'] = $res['seconds'];
json_out(with_urls($meta, $id, $dir));
