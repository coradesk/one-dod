# Olah Gambar

Webapp internal untuk menyiapkan logo/foto. Hasilnya tiga PNG per gambar:

| File | Isi |
|---|---|
| `<nama>_transparan.png` | RGBA, rasio asli, padding dipangkas, sisi terpanjang min. 512px |
| `<nama>_512.png` | 512×512, latar putih (RGB) |
| `<nama>_1024.png` | 1024×1024, latar putih (RGB) |

## Alur

```
unggah → pre-crop padding solid → enhance (AI, bila kecil/buram) → hapus background (AI) → trim alpha → resize & tulis PNG
         └──────── PHP / Imagick ────────┘ └──────────── worker Python ────────────┘ └──────── PHP / Imagick ────────┘
```

Enhance sengaja dijalankan **sebelum** hapus background. Model segmentasi jauh lebih akurat pada gambar
yang sudah besar dan tajam, terutama untuk logo kecil.

## Komponen & alasan pemilihan

| Kebutuhan | Tool | Lisensi | Catatan |
|---|---|---|---|
| Enhance / upscale | Real-ESRGAN `realesr-general-x4v3` (ONNX) | BSD-3 | Model 4,7 MB, ±1 detik per logo di CPU. Dikonversi dari bobot resmi (`worker/tools/convert_realesrgan.py`) |
| Remove BG (default) | rembg + ISNet `isnet-general-use` | Apache-2.0 | Puncak RAM ±1,2 GB, ±1,5 detik per gambar di CPU |
| Remove BG (opsional) | rembg + BiRefNet-lite | MIT | Tepi lebih halus, tapi butuh RAM >6 GB di CPU. Pakai hanya di server besar atau GPU |
| Remove BG tanpa AI | Imagick flood-fill dari tepi | — | Untuk logo berlatar polos; juga jadi cadangan otomatis saat worker mati |
| Crop, resize, PNG | PHP Imagick | — | Sudah terpasang |

| Pilih objek (editor) | SlimSAM-77 INT8 (ONNX, ~14 MB) + onnxruntime-web 1.31.1 (MIT) | Apache-2.0 | Segment Anything terkecil, berjalan **di browser** (Web Worker, WASM SIMD). Server kecil tidak terbebani; laptop pengguna (M1/M2) yang menghitung |
| Refine khusus logo | `worker/refine.py` (numpy + OpenCV) | — | Bila latar di tepi gambar polos, berpola 2–4 warna (mis. kotak-kotak palsu), atau gradien halus: background ditentukan dengan region-growing dari tepi, termasuk menembus bayangan. Area putih besar yang tertutup logo dipertahankan, lubang huruf dibuang. AI jadi penentu di area yang ambigu, dan kalau hasilnya bocor otomatis kembali ke AI murni |

Tidak dipakai: **BRIA RMBG-2.0** (dan default baru rembg `bria-rmbg`), karena lisensinya CC BY-NC (non-komersial).

## Editor koreksi (tombol "Koreksi" di kartu hasil)

Terinspirasi Photopea: semua interaksi berjalan di browser (`public/assets/editor.js`, vanilla JS + typed array),
server hanya merender ulang output final (`api/render.php`). Editor bekerja di atas dua gambar berukuran sama:
`src.png` (sebelum hapus background) sebagai acuan warna, dan `cut.png` (hasil saat ini) yang diedit.

| Alat | Pintasan | Fungsi |
|---|---|---|
| Pilih Objek (AI) | S | Klik objek (Alt+klik = kurangi), lalu Sisakan / Pulihkan / Hapus objek. SlimSAM-77 di browser: model ±14 MB diunduh sekali lalu di-cache, analisis dimulai otomatis di latar belakang saat editor dibuka, lalu ±0,2 dtk per klik. Tombol **Cakupan** (C) untuk berganti bagian kecil/sedang/besar. Masker ditempelkan ke tepi gambar asli dengan guided filter. Paling cocok untuk foto dan bentuk; teks tipis lebih rapi dengan Magic Eraser |
| Hapus Latar | G | Background eraser: warna diambil sekali di awal sapuan, hanya warna mirip yang terhapus (objek aman) |
| Rapikan Tepi | F | Sapukan di tepi rambut/bulu/bayangan: color guided filter (He et al.) + pembersihan warna dari sampel latar asli. Tombol "Rapikan semua tepi" untuk sekali klik |
| Magic Eraser | W | Klik untuk menghapus area tersambung yang warnanya mirip. Tolerance, Contiguous, dan Anti-alias. Tepi dihaluskan dan warnanya dibersihkan dari sisa latar |
| Magic Restore | R | Kebalikannya: klik untuk mengembalikan area yang terhapus (mis. siluet putih) dari gambar asli |
| Kuas Hapus / Kuas Pulihkan | E / B | Koreksi manual, dengan ukuran (`[` `]`) dan kekerasan |
| Geser | H / tahan Spasi | Geser tampilan; scroll untuk zoom, `0` untuk pas di layar |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z | Disimpan per region (hemat memori) |

"Tahan: lihat asli" menampilkan gambar sebelum diproses. Latar preview bisa diganti (kotak-kotak, putih, gelap,
magenta) untuk menemukan sisa noda. Hasil koreksi tersimpan, jadi editor bisa dibuka lagi untuk melanjutkan.

## Struktur

```
public/            ← root nginx
  index.php        UI
  api/process.php  unggah + proses 1 file → JSON
  api/render.php   render ulang setelah koreksi di editor
  api/file.php     unduh PNG / ZIP
  api/health.php   status worker
  assets/          css, js, font Poppins lokal
src/               logika PHP (Pipeline, ImageOps, WorkerClient, config)
storage/jobs/      hasil (dihapus otomatis setelah 24 jam)
worker/            layanan AI Python (FastAPI + onnxruntime), hanya listen di 127.0.0.1:7001
deploy/            contoh konfigurasi nginx & systemd
```

## Instalasi

```bash
# 1. worker Python
cd worker
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# model ISNet (~170 MB) diunduh otomatis ke worker/models/rembg saat pertama dipakai

# 2. service worker (dengan batas memori)
sudo cp ../deploy/imgworker.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now imgworker
curl 127.0.0.1:7001/health

# 3. nginx + php-fpm (butuh ekstensi imagick, curl, fileinfo, zip)
sudo cp ../deploy/dod-logo.local.conf /etc/nginx/sites-available/dod-logo.conf   # ganti server_name & root
sudo ln -s /etc/nginx/sites-available/dod-logo.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# storage harus bisa ditulis oleh user php-fpm
sudo chown -R www-data: ../storage
```

### Laptop ini (Linux): http://dod-logo.local

- nginx: `/etc/nginx/sites-available/dod-logo.local.conf` (salinan di `deploy/dod-logo.local.conf`)
- storage bisa ditulis php-fpm (`www-data`) lewat ACL, kepemilikan file tetap milik user
- worker: user service `systemctl --user {status|restart} dod-logo-worker`, **meniru server target**: dikunci ke
  2 core (`taskset`) dengan `MemoryMax=2G` (salinan di `deploy/dod-logo-worker.user.service`)

## Target server: 2 core AMD EPYC, 4 GB RAM, tanpa GPU

Pembagian kerja mengikuti pola Photopea: **server hanya untuk pipeline otomatis**, interaksi editor (termasuk
AI "Pilih Objek") berjalan di **browser pengguna** (MacBook M1/M2 jauh lebih kuat daripada server).

Hasil uji dengan worker dikunci ke 2 core + batas 2 GB (`taskset -c 0,1`, sama seperti server target):

| Tahap | Waktu | Catatan |
|---|---|---|
| Satu gambar logo, pipeline lengkap | 4–8 dtk | termasuk hapus background, refine, enhance |
| Hapus background (ISNet) | ±3,5 dtk | |
| Enhance AI | ±1,3 dtk (input 256px) s/d ±6,8 dtk (512px) | input model dibatasi 512px; kenaikan < 1,6x pada gambar tajam memakai Lanczos (milidetik) |
| Puncak RAM worker | ±0,9–1,0 GB | idle ±0,5 GB |

Anggaran RAM 4 GB: OS + nginx ±0,4 GB, worker ≤ 2 GB (`MemoryMax=2G`), php-fpm ≤ 4 × ±0,3 GB.

Setelan yang disarankan di server:

- **php-fpm** (`/etc/php/8.4/fpm/pool.d/www.conf`):
  `pm = ondemand`, `pm.max_children = 4`, `pm.process_idle_timeout = 30s`, `pm.max_requests = 200`
- **Worker**: `deploy/imgworker.service` (thread otomatis = jumlah core, `WORKER_MAX_CONCURRENT=1` sehingga
  permintaan berat diantrikan, bukan berebut RAM). Jangan pakai BiRefNet di server ini (butuh >6 GB).
- **HTTPS wajib** untuk performa editor: "Pilih Objek" memakai WASM multi-thread yang hanya aktif di halaman
  *secure context* + header COOP/COEP (sudah ada di `deploy/dod-logo.local.conf`). Di HTTP biasa tetap berjalan,
  tapi dengan 1 thread (analisis ±8–12 dtk, halaman tetap responsif karena di Web Worker). Dengan HTTPS, M1/M2
  memakai 4 thread.
- Ukuran kerja maks. 1600px (`IMG_WORK_MAX_SIDE`), cukup untuk output terbesar 1024px dan menghemat CPU/RAM.
- Benchmark di server: `worker/.venv/bin/python worker/tools/bench.py`

Untuk development tanpa nginx:

```bash
systemd-run --user --unit=imgworker-dev -p MemoryMax=3G -p Restart=on-failure --working-directory=$PWD/worker \
  $PWD/worker/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 7001
php -d upload_max_filesize=25M -d post_max_size=26M -S 127.0.0.1:8099 -t public
```

> **Penting:** worker jangan dijalankan langsung dari terminal IDE tanpa `MemoryMax`. Jika RAM habis,
> OOM killer bisa ikut mematikan seluruh grup proses IDE.

## Konfigurasi

PHP: `src/config.php` (bisa ditimpa lewat env/`fastcgi_param`): `IMG_WORKER_URL`, `IMG_MAX_UPLOAD_MB`,
`IMG_JOB_TTL_HOURS`, `IMG_STORAGE_DIR`.

Worker (env di unit systemd):

| Env | Default | Arti |
|---|---|---|
| `BG_MODEL` | `isnet-general-use` | model hapus background default |
| `WORKER_THREADS` | 4 | thread CPU per inferensi |
| `WORKER_MAX_CONCURRENT` | 1 | jumlah inferensi bersamaan (menjaga RAM) |
| `SHARPNESS_THRESHOLD` | 35 | skor ketajaman (0–100) di bawah ini dianggap buram. Gambar tajam ±55–65, buram ±5–20 |
| `BG_MAX_SIDE` | 2048 | input hapus background diperkecil ke ukuran ini dulu |

### GPU (opsional)

Ganti `onnxruntime` dengan `onnxruntime-gpu` (butuh CUDA dan cuDNN). Worker otomatis memakai
`CUDAExecutionProvider` bila tersedia, dan badge di topbar berubah menjadi "GPU".
