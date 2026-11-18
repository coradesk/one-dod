<?php
declare(strict_types=1);

/**
 * Operasi gambar non-AI dengan Imagick: normalisasi, pre-crop padding, hapus background warna solid,
 * trim berdasarkan alpha, resize, dan penulisan PNG.
 */
final class ImageOps
{
    /** Baca file unggahan -> Imagick (frame pertama, orientasi EXIF dibetulkan, sRGB, 8-bit). */
    public static function load(string $path, int $maxPixels): Imagick
    {
        $im = new Imagick();
        $im->pingImage($path);
        if ($im->getImageWidth() * $im->getImageHeight() > $maxPixels) {
            throw new RuntimeException('Resolusi gambar terlalu besar (maks. ' . round($maxPixels / 1e6) . ' MP).');
        }
        $im->clear();
        $im->readImage($path . '[0]');               // GIF/TIFF/HEIC multi-frame -> frame pertama
        self::autoOrient($im);
        if ($im->getImageColorspace() === Imagick::COLORSPACE_CMYK) {
            $im->transformImageColorspace(Imagick::COLORSPACE_SRGB);
        }
        $im->setImageColorspace(Imagick::COLORSPACE_SRGB);
        $im->setImageDepth(8);
        $im->setImagePage(0, 0, 0, 0);
        $im->stripImage();
        return $im;
    }

    private static function autoOrient(Imagick $im): void
    {
        switch ($im->getImageOrientation()) {
            case Imagick::ORIENTATION_TOPRIGHT:    $im->flopImage(); break;
            case Imagick::ORIENTATION_BOTTOMRIGHT: $im->rotateImage('#000', 180); break;
            case Imagick::ORIENTATION_BOTTOMLEFT:  $im->flipImage(); break;
            case Imagick::ORIENTATION_LEFTTOP:     $im->transposeImage(); break;
            case Imagick::ORIENTATION_RIGHTTOP:    $im->rotateImage('#000', 90); break;
            case Imagick::ORIENTATION_RIGHTBOTTOM: $im->transverseImage(); break;
            case Imagick::ORIENTATION_LEFTBOTTOM:  $im->rotateImage('#000', -90); break;
        }
        $im->setImageOrientation(Imagick::ORIENTATION_TOPLEFT);
    }

    /**
     * Masker alpha grayscale dengan putih = opak, hitam = transparan.
     * ImageMagick 6 mengembalikan "opacity" (terbalik) saat memisahkan kanal alpha, IM7 tidak;
     * semantiknya dideteksi sekali saat runtime agar aman di keduanya.
     */
    public static function alphaMask(Imagick $im): Imagick
    {
        static $inverted = null;
        if ($inverted === null) {
            $probe = new Imagick();
            $probe->newImage(1, 1, new ImagickPixel('rgba(0,0,0,0)'), 'png');
            $probe->separateImageChannel(Imagick::CHANNEL_ALPHA);
            $inverted = $probe->getImagePixelColor(0, 0)->getColor()['r'] > 127; // transparan terbaca putih
            $probe->clear();
        }
        $a = clone $im;
        $a->separateImageChannel(Imagick::CHANNEL_ALPHA);
        if ($inverted) {
            $a->negateImage(false);
        }
        $a->setImageAlphaChannel(Imagick::ALPHACHANNEL_DEACTIVATE);
        return $a;
    }

    /** Nilai minimum kanal (IM6 & IM7: nama API berbeda antar versi). */
    private static function channelMin(Imagick $a): float
    {
        if (method_exists($a, 'getImageChannelRange')) {
            try {
                return (float)($a->getImageChannelRange(Imagick::CHANNEL_GRAY)['minima'] ?? 0);
            } catch (Throwable) {
            }
        }
        $st = $a->getImageChannelStatistics();
        $first = reset($st);
        return (float)($first['minima'] ?? 0);
    }

    /** Operator "salin alpha": COPYOPACITY di IM6, COPYALPHA di IM7. */
    private static function copyAlphaOp(): int
    {
        return defined('Imagick::COMPOSITE_COPYALPHA') ? Imagick::COMPOSITE_COPYALPHA : Imagick::COMPOSITE_COPYOPACITY;
    }

    /** True bila gambar benar-benar memakai transparansi (bukan sekadar punya kanal alpha penuh). */
    public static function hasTransparency(Imagick $im): bool
    {
        if (!$im->getImageAlphaChannel()) {
            return false;
        }
        $a = self::alphaMask($im);
        $min = self::channelMin($a);
        $a->clear();
        return $min < Imagick::getQuantum() * 0.98;
    }

    /**
     * Warna latar solid bila keempat sudut (dan tengah tiap tepi) seragam; null bila tidak.
     * @return array{0:int,1:int,2:int}|null
     */
    public static function solidBackground(Imagick $im, float $tolerance = 0.08): ?array
    {
        $w = $im->getImageWidth();
        $h = $im->getImageHeight();
        $pts = [[0, 0], [$w - 1, 0], [0, $h - 1], [$w - 1, $h - 1],
                [intdiv($w, 2), 0], [intdiv($w, 2), $h - 1], [0, intdiv($h, 2)], [$w - 1, intdiv($h, 2)]];
        $cols = [];
        foreach ($pts as [$x, $y]) {
            $c = $im->getImagePixelColor($x, $y)->getColor(); // 0..255
            $cols[] = [$c['r'], $c['g'], $c['b']];
        }
        $ref = $cols[0];
        foreach ($cols as $c) {
            $d = max(abs($c[0] - $ref[0]), abs($c[1] - $ref[1]), abs($c[2] - $ref[2])) / 255;
            if ($d > $tolerance) {
                return null;
            }
        }
        return $ref;
    }

    /**
     * Pangkas padding berwarna solid (sebelum AI) dan sisakan margin kecil sebagai konteks.
     * Mengembalikan true bila ada yang dipangkas.
     */
    public static function precropSolid(Imagick $im, float $marginRatio = 0.04): bool
    {
        $bg = self::solidBackground($im);
        if ($bg === null) {
            return false;
        }
        $w = $im->getImageWidth();
        $h = $im->getImageHeight();
        $t = clone $im;
        $t->setImageAlphaChannel(Imagick::ALPHACHANNEL_REMOVE);
        $t->setImageBackgroundColor(sprintf('rgb(%d,%d,%d)', ...$bg));
        $t->trimImage(0.10 * Imagick::getQuantum());
        $p = $t->getImagePage();
        $g = $t->getImageGeometry();
        $t->clear();
        if ($g['width'] >= $w - 2 && $g['height'] >= $h - 2) {
            return false;
        }
        if ($g['width'] < 4 || $g['height'] < 4) {
            return false; // gambar polos
        }
        $m = (int)round(max($g['width'], $g['height']) * $marginRatio);
        $x0 = max(0, $p['x'] - $m);
        $y0 = max(0, $p['y'] - $m);
        $x1 = min($w, $p['x'] + $g['width'] + $m);
        $y1 = min($h, $p['y'] + $g['height'] + $m);
        $im->cropImage($x1 - $x0, $y1 - $y0, $x0, $y0);
        $im->setImagePage(0, 0, 0, 0);
        return true;
    }

    /**
     * Hapus background warna solid tanpa AI: flood-fill dari seluruh tepi (bagian logo yang
     * berwarna sama dengan latar tapi tertutup tidak ikut hilang).
     */
    public static function removeSolidBackground(Imagick $im, float $fuzz = 0.12): void
    {
        $bg = self::solidBackground($im, 0.15);
        if ($bg === null) {
            throw new RuntimeException('Latar tidak berwarna solid. Pakai mode AI.');
        }
        $color = sprintf('rgb(%d,%d,%d)', ...$bg);
        $im->setImageAlphaChannel(Imagick::ALPHACHANNEL_SET);
        // bingkai 1px warna latar supaya satu titik flood-fill menjangkau seluruh tepi
        $im->borderImage($color, 1, 1);
        $im->floodFillPaintImage('transparent', $fuzz * Imagick::getQuantum(), $color, 0, 0, false, Imagick::CHANNEL_ALL);
        $im->shaveImage(1, 1);
        $im->setImagePage(0, 0, 0, 0);
        // haluskan tepi bergerigi hasil flood-fill
        $a = self::alphaMask($im);
        $a->blurImage(0, 0.6);
        $im->compositeImage($a, self::copyAlphaOp(), 0, 0);
        $a->clear();
    }

    /** Pangkas area transparan di sekeliling objek. Alpha < threshold dianggap kosong (buang noise). */
    public static function trimAlpha(Imagick $im, float $threshold = 0.06): bool
    {
        if (!$im->getImageAlphaChannel()) {
            return false;
        }
        $a = self::alphaMask($im);
        $a->thresholdImage($threshold * Imagick::getQuantum());
        $a->setImageBackgroundColor('black');
        $a->trimImage(0);
        $p = $a->getImagePage();
        $g = $a->getImageGeometry();
        $a->clear();
        $w = $im->getImageWidth();
        $h = $im->getImageHeight();
        if ($g['width'] <= 1 && $g['height'] <= 1) {
            throw new RuntimeException('Objek tidak terdeteksi: seluruh gambar menjadi transparan.');
        }
        if ($g['width'] >= $w && $g['height'] >= $h) {
            return false;
        }
        $im->cropImage($g['width'], $g['height'], $p['x'], $p['y']);
        $im->setImagePage(0, 0, 0, 0);
        return true;
    }

    /** Pastikan sisi terpanjang >= $min (upscale Lanczos bila perlu). */
    public static function ensureMinSide(Imagick $im, int $min): void
    {
        $w = $im->getImageWidth();
        $h = $im->getImageHeight();
        if (max($w, $h) >= $min) {
            return;
        }
        $s = $min / max($w, $h);
        $im->resizeImage(max(1, (int)round($w * $s)), max(1, (int)round($h * $s)), Imagick::FILTER_LANCZOS, 1);
    }

    /** Persegi $size x $size berlatar putih, objek di tengah dengan margin (rasio sisi). */
    public static function whiteSquare(Imagick $src, int $size, float $marginRatio): Imagick
    {
        $inner = max(1, (int)round($size * (1 - 2 * $marginRatio)));
        $obj = clone $src;
        $w = $obj->getImageWidth();
        $h = $obj->getImageHeight();
        $s = $inner / max($w, $h);
        $nw = max(1, (int)round($w * $s));
        $nh = max(1, (int)round($h * $s));
        $obj->resizeImage($nw, $nh, Imagick::FILTER_LANCZOS, 1);

        $canvas = new Imagick();
        $canvas->newImage($size, $size, new ImagickPixel('white'), 'png');
        $canvas->setImageColorspace(Imagick::COLORSPACE_SRGB);
        $canvas->compositeImage($obj, Imagick::COMPOSITE_OVER, intdiv($size - $nw, 2), intdiv($size - $nh, 2));
        $obj->clear();
        $canvas->setImageAlphaChannel(Imagick::ALPHACHANNEL_REMOVE);
        return $canvas;
    }

    /** Tulis PNG. $alpha=true -> RGBA (color-type 6), false -> RGB (color-type 2). */
    public static function writePng(Imagick $im, string $path, bool $alpha): void
    {
        $out = clone $im;
        $out->setImageFormat('png');
        if ($alpha) {
            $out->setImageAlphaChannel(Imagick::ALPHACHANNEL_SET);
            $out->setOption('png:color-type', '6');
        } else {
            $out->setImageBackgroundColor('white');
            $out = $out->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
            $out->setImageAlphaChannel(Imagick::ALPHACHANNEL_REMOVE);
            $out->setOption('png:color-type', '2');
        }
        $out->setOption('png:bit-depth', '8');
        $out->setImageCompressionQuality(95); // zlib level 9, filter adaptif
        $out->stripImage();
        $out->writeImage('png:' . $path);
        $out->clear();
    }

    /** Simpan gambar kerja (RGBA 8-bit, kompresi cepat) untuk editor koreksi. */
    public static function writeWork(Imagick $im, string $path): void
    {
        $c = clone $im;
        $c->setImageFormat('png');
        $c->setImageAlphaChannel(Imagick::ALPHACHANNEL_SET);
        $c->setOption('png:color-type', '6');
        $c->setOption('png:bit-depth', '8');
        $c->setImageCompressionQuality(10);
        $c->writeImage('png:' . $path);
        $c->clear();
    }

    public static function toPngBlob(Imagick $im): string
    {
        $c = clone $im;
        $c->setImageFormat('png');
        $c->setImageCompressionQuality(10); // cepat, hanya untuk transfer ke worker
        $blob = $c->getImageBlob();
        $c->clear();
        return $blob;
    }
}
