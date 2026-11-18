<?php
declare(strict_types=1);

require_once __DIR__ . '/Pipeline.php';

$CFG = require __DIR__ . '/config.php';

Imagick::setResourceLimit(Imagick::RESOURCETYPE_MEMORY, $CFG['imagick_memory_mb'] * 1024 * 1024);
Imagick::setResourceLimit(Imagick::RESOURCETYPE_MAP, $CFG['imagick_memory_mb'] * 2 * 1024 * 1024);
Imagick::setResourceLimit(Imagick::RESOURCETYPE_THREAD, 2);

function json_out(array $data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function job_dir(array $cfg, string $id): string
{
    if (!preg_match('/^[a-f0-9]{24}$/', $id)) {
        throw new InvalidArgumentException('ID tidak valid');
    }
    return $cfg['storage_dir'] . '/' . $id;
}

/** Hapus job yang lebih tua dari TTL. */
function cleanup_jobs(array $cfg): void
{
    $limit = time() - $cfg['job_ttl_hours'] * 3600;
    foreach (glob($cfg['storage_dir'] . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
        if (filemtime($dir) < $limit) {
            array_map('unlink', glob("$dir/*") ?: []);
            @rmdir($dir);
        }
    }
}

function safe_basename(string $name): string
{
    $base = pathinfo($name, PATHINFO_FILENAME);
    $base = preg_replace('/[^A-Za-z0-9._-]+/', '-', $base) ?? 'gambar';
    $base = trim($base, '.-_');
    return substr($base !== '' ? $base : 'gambar', 0, 60);
}

/** Tambahkan URL (dengan penanda versi agar cache browser tidak menahan hasil lama). */
function with_urls(array $meta, string $id, string $dir): array
{
    foreach ($meta['files'] as $k => &$file) {
        $file['url'] = "api/file.php?id=$id&k=$k&v=" . @filemtime("$dir/{$file['file']}");
    }
    unset($file);
    $v = @filemtime("$dir/cut.png");
    $meta['edit'] = [
        'src' => "api/file.php?id=$id&k=src",
        'cut' => "api/file.php?id=$id&k=cut&v=$v",
    ];
    return $meta;
}
