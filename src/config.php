<?php
declare(strict_types=1);

/**
 * Konfigurasi. Semua nilai bisa ditimpa lewat environment (fastcgi_param di nginx / env php-fpm).
 */
$env = static fn(string $k, $d) => ($v = getenv($k)) === false || $v === '' ? $d : $v;

return [
    // Worker AI (Python, lihat worker/app.py)
    'worker_url'      => rtrim((string)$env('IMG_WORKER_URL', 'http://127.0.0.1:7001'), '/'),
    'worker_timeout'  => (int)$env('IMG_WORKER_TIMEOUT', 180),

    // Penyimpanan hasil (di luar public/)
    'storage_dir'     => (string)$env('IMG_STORAGE_DIR', dirname(__DIR__) . '/storage/jobs'),
    'job_ttl_hours'   => (int)$env('IMG_JOB_TTL_HOURS', 24),

    // Batas unggahan
    'max_upload_mb'   => (int)$env('IMG_MAX_UPLOAD_MB', 20),
    'max_pixels'      => (int)$env('IMG_MAX_PIXELS', 30_000_000),
    'work_max_side'   => (int)$env('IMG_WORK_MAX_SIDE', 1600), // ukuran kerja maks. (output terbesar 1024px)

    // Output
    'min_side'        => 512,          // output transparan: sisi terpanjang minimal 512px
    'squares'         => [512, 1024],  // output persegi berlatar putih
    'enhance_target'  => 1024,         // enhance bila sisi terpanjang konten < nilai ini (atau buram)

    // Model remove-bg yang ditawarkan di UI (kunci = nama model worker)
    'bg_models' => [
        'isnet-general-use'     => 'AI cepat (ISNet)',
        'birefnet-general-lite' => 'AI halus (BiRefNet, RAM besar)',
    ],
    'default_bg_model' => 'isnet-general-use',

    // Batas sumber daya ImageMagick per request
    'imagick_memory_mb' => (int)$env('IMG_IMAGICK_MEMORY_MB', 256),   // server kecil: 4 GB RAM
];
