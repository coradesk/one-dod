<?php
declare(strict_types=1);

/**
 * Unduh hasil.
 *   ?id=<job>&k=transparan|s512|s1024[&dl=1]  -> satu PNG
 *   ?ids=<job>,<job>,...                       -> ZIP berisi semua output
 */
require dirname(__DIR__, 2) . '/src/bootstrap.php';

function meta_of(array $cfg, string $id): array
{
    $dir = job_dir($cfg, $id);
    $raw = @file_get_contents("$dir/meta.json");
    if ($raw === false) {
        throw new RuntimeException('Hasil tidak ditemukan atau sudah kedaluwarsa.');
    }
    return json_decode($raw, true);
}

try {
    if (isset($_GET['ids'])) {
        $ids = array_slice(array_unique(explode(',', (string)$_GET['ids'])), 0, 100);
        $zipPath = tempnam(sys_get_temp_dir(), 'imgz');
        $zip = new ZipArchive();
        $zip->open($zipPath, ZipArchive::OVERWRITE);
        $used = [];
        foreach ($ids as $id) {
            $meta = meta_of($CFG, $id);
            foreach ($meta['files'] as $file) {
                $entry = $file['file'];
                for ($n = 2; isset($used[$entry]); $n++) {   // nama kembar dari file berbeda
                    $entry = preg_replace('/\.png$/', "-$n.png", $file['file']);
                }
                $used[$entry] = true;
                $zip->addFile(job_dir($CFG, $id) . '/' . $file['file'], $entry);
                $zip->setCompressionName($entry, ZipArchive::CM_STORE); // PNG sudah terkompresi
            }
        }
        $zip->close();
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="hasil-gambar-' . date('Ymd-His') . '.zip"');
        header('Content-Length: ' . filesize($zipPath));
        header('Cache-Control: no-store');
        readfile($zipPath);
        unlink($zipPath);
        exit;
    }

    $id = (string)($_GET['id'] ?? '');
    $meta = meta_of($CFG, $id);
    $k = (string)($_GET['k'] ?? '');
    if ($k === 'src' || $k === 'cut') {
        $name = "$k.png";                       // gambar kerja untuk editor koreksi
        if (!is_file(job_dir($CFG, $id) . "/$name")) {
            throw new RuntimeException('Gambar kerja tidak tersedia.');
        }
    } elseif (isset($meta['files'][$k])) {
        $name = $meta['files'][$k]['file'];
    } else {
        throw new RuntimeException('File tidak ditemukan.');
    }
    $path = job_dir($CFG, $id) . '/' . $name;
    header('Content-Type: image/png');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=3600');
    header('X-Content-Type-Options: nosniff');
    if (!empty($_GET['dl'])) {
        header('Content-Disposition: attachment; filename="' . $name . '"');
    }
    readfile($path);
} catch (Throwable $e) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo $e instanceof RuntimeException || $e instanceof InvalidArgumentException ? $e->getMessage() : 'Galat';
}
