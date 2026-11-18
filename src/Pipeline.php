<?php
declare(strict_types=1);

require_once __DIR__ . '/ImageOps.php';
require_once __DIR__ . '/WorkerClient.php';

/**
 * Alur: muat -> pre-crop padding -> enhance (AI) -> hapus background -> trim alpha -> 3 output PNG.
 * src.png (sebelum hapus background) & cut.png (sesudahnya) disimpan berukuran sama untuk editor koreksi.
 * Enhance dijalankan SEBELUM hapus background: model segmentasi jauh lebih akurat pada gambar
 * yang sudah besar & tajam (terutama logo kecil).
 */
final class Pipeline
{
    public const ENHANCE = ['auto', 'force', 'off'];

    private array $steps = [];
    private array $warnings = [];
    private bool $enhanced = false;
    private bool $workerDown = false;
    private bool $post = false;   // langkah dari finish() ditandai agar bisa diganti saat render ulang

    public function __construct(private array $cfg, private WorkerClient $worker) {}

    /**
     * @param array{enhance:string,bg:string,margin:float} $opt
     * @return array<string,mixed> metadata hasil
     */
    public function run(string $inputPath, string $outDir, string $baseName, array $opt): array
    {
        $t0 = microtime(true);
        $im = ImageOps::load($inputPath, $this->cfg['max_pixels']);
        $orig = ['w' => $im->getImageWidth(), 'h' => $im->getImageHeight()];
        $transparentInput = ImageOps::hasTransparency($im);
        $bg = $opt['bg'];

        // 1. pangkas padding lebih dulu supaya enhance & AI fokus ke objek
        if ($transparentInput) {
            if (ImageOps::trimAlpha($im)) {
                $this->step('crop', 'Padding transparan dipangkas');
            }
        } elseif (ImageOps::precropSolid($im, $bg === 'off' ? 0.0 : 0.04)) {
            $this->step('crop', 'Padding latar solid dipangkas');
        }

        // 2. enhance
        if ($opt['enhance'] !== 'off') {
            $im = $this->enhance($im, $opt['enhance']);
        }

        // batasi ukuran kerja: src & cut harus berukuran sama persis untuk editor koreksi
        $maxSide = (int)($this->cfg['work_max_side'] ?? 2048);
        if (max($im->getImageWidth(), $im->getImageHeight()) > $maxSide) {
            $im->resizeImage($maxSide, $maxSide, Imagick::FILTER_LANCZOS, 1, true);
        }
        ImageOps::writeWork($im, "$outDir/src.png");

        // 3. hapus background
        if ($transparentInput) {
            $this->step('bg', 'Sudah transparan, hapus background dilewati');
        } elseif ($bg === 'solid') {
            ImageOps::removeSolidBackground($im);
            $this->step('bg', 'Background warna solid dihapus');
        } elseif ($bg !== 'off') {
            $im = $this->removeBgAi($im, $bg);
        }
        ImageOps::writeWork($im, "$outDir/cut.png");

        $meta = $this->finish($im, $outDir, $baseName, $opt);
        $meta['original'] = $orig;
        $meta['seconds'] = round(microtime(true) - $t0, 2);
        return $meta;
    }

    /**
     * Render ulang dari hasil koreksi manual (RGBA, ukuran sama dengan src.png).
     * @param array{enhance:string,margin:float} $opt
     */
    public function rerender(Imagick $cut, string $outDir, string $baseName, array $opt, bool $wasEnhanced = false): array
    {
        $t0 = microtime(true);
        $this->enhanced = $wasEnhanced;
        ImageOps::writeWork($cut, "$outDir/cut.png");
        $this->post = true;
        $this->step('edit', 'Dikoreksi manual');
        $meta = $this->finish($cut, $outDir, $baseName, $opt);
        $meta['seconds'] = round(microtime(true) - $t0, 2);
        return $meta;
    }

    /** trim -> enhance susulan (bila perlu) -> tulis 3 PNG output. */
    private function finish(Imagick $im, string $outDir, string $baseName, array $opt): array
    {
        $im = clone $im;
        $this->post = true;
        // 4. pangkas sisa area transparan (padding benar-benar hilang)
        if (ImageOps::hasTransparency($im) && ImageOps::trimAlpha($im)) {
            $this->step('trim', 'Area kosong di sekitar objek dipangkas');
        }

        // 4b. setelah trim, konten bisa jadi lebih kecil dari target (mis. latar gradien tidak
        //     ikut dipangkas di langkah 1) -> enhance sekali lagi bila belum pernah.
        //     Bila sudah pernah di-enhance, ulangi hanya jika konten menyusut jauh (< 75% target).
        $need = $this->cfg['enhance_target'] * ($this->enhanced ? 0.75 : 1.0);
        if ($opt['enhance'] !== 'off' && !$this->workerDown
            && max($im->getImageWidth(), $im->getImageHeight()) < $need) {
            $im = $this->enhance($im, $opt['enhance']);
        }
        if ($opt['enhance'] !== 'off' && !$this->enhanced && !$this->workerDown) {
            $this->step('enhance', 'Kualitas sudah baik, enhance tidak diperlukan', false);
        }

        // 5. output
        $files = [];
        $tr = clone $im;
        ImageOps::ensureMinSide($tr, $this->cfg['min_side']);
        $name = $baseName . '_transparan.png';
        ImageOps::writePng($tr, "$outDir/$name", true);
        $files['transparan'] = ['file' => $name, 'w' => $tr->getImageWidth(), 'h' => $tr->getImageHeight(),
                                'label' => 'Transparan · rasio asli'];
        $tr->clear();

        foreach ($this->cfg['squares'] as $size) {
            $sq = ImageOps::whiteSquare($im, $size, $opt['margin']);
            $name = "{$baseName}_{$size}.png";
            ImageOps::writePng($sq, "$outDir/$name", false);
            $files["s$size"] = ['file' => $name, 'w' => $size, 'h' => $size, 'label' => "Putih · {$size}×{$size}"];
            $sq->clear();
        }
        $im->clear();

        foreach ($files as &$f) {
            $f['bytes'] = filesize("$outDir/{$f['file']}");
        }
        unset($f);
        return ['files' => $files, 'steps' => $this->steps, 'warnings' => $this->warnings];
    }

    private function enhance(Imagick $im, string $mode): Imagick
    {
        try {
            $r = $this->worker->enhance(ImageOps::toPngBlob($im), $mode, $this->cfg['enhance_target']);
        } catch (WorkerUnavailable) {
            if (!$this->workerDown) {
                $this->warnings[] = 'Worker AI tidak aktif: enhance dilewati.';
            }
            $this->workerDown = true;
            return $im;
        }
        if (($r['headers']['x-enhanced'] ?? '0') !== '1') {
            return $im;
        }
        $this->enhanced = true;
        $reason = ['kecil' => 'resolusi kecil', 'buram' => 'gambar buram', 'dipaksa' => 'dipaksa',
                   'lanczos' => 'kenaikan kecil, mode cepat'][$r['headers']['x-reason'] ?? ''] ?? '';
        $out = new Imagick();
        $out->readImageBlob($r['blob']);
        $how = ($r['headers']['x-reason'] ?? '') === 'lanczos' ? 'Diperbesar' : 'Diperjelas dengan AI';
        $this->step('enhance', sprintf('%s (%s): %d×%d → %d×%d', $how, $reason,
            $im->getImageWidth(), $im->getImageHeight(), $out->getImageWidth(), $out->getImageHeight()));
        $im->clear();
        return $out;
    }

    private function removeBgAi(Imagick $im, string $model): Imagick
    {
        try {
            $r = $this->worker->removeBg(ImageOps::toPngBlob($im), $model);
        } catch (WorkerUnavailable $e) {
            if (ImageOps::solidBackground($im, 0.15) !== null) {
                $this->warnings[] = 'Worker AI tidak aktif: memakai mode warna solid sebagai cadangan.';
                ImageOps::removeSolidBackground($im);
                $this->step('bg', 'Background warna solid dihapus (cadangan)');
                return $im;
            }
            throw new RuntimeException('Worker AI tidak aktif dan latar gambar tidak polos, jadi background tidak bisa dihapus. Jalankan worker, atau pilih "Jangan hapus".', 0, $e);
        }
        $out = new Imagick();
        $out->readImageBlob($r['blob']);
        $label = $this->cfg['bg_models'][$model] ?? $model;
        $this->step('bg', "Background dihapus: $label");
        if (preg_match('/^(warna|gradien)/', $r['headers']['x-refine'] ?? '')) {
            $this->step('refine', 'Diperhalus khusus logo (area putih di dalam logo, teks tipis, bayangan)');
        }
        $im->clear();
        return $out;
    }

    private function step(string $key, string $text, bool $done = true): void
    {
        $this->steps[] = ['key' => $key, 'text' => $text, 'done' => $done, 'post' => $this->post];
    }
}
