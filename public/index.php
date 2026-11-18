<?php
declare(strict_types=1);
$CFG = require dirname(__DIR__) . '/src/config.php';
$h = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$v = static fn(string $f): string => (string)@filemtime(__DIR__ . '/assets/' . $f); // cache-busting
?><!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Olah Gambar · DoD IT</title>
  <meta name="color-scheme" content="light dark">
  <script src="assets/theme-init.js?v=<?= $v('theme-init.js') ?>"></script>
  <link rel="preload" href="assets/fonts/poppins-latin-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="assets/app.css?v=<?= $v('app.css') ?>">
  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
</head>
<body>
<a class="skip" href="#konten">Langsung ke konten</a>

<header class="topbar">
  <div class="topbar-in">
    <div class="brandmark">
      <img src="assets/favicon.svg" alt="" width="32" height="32">
      <div>
        <div class="brand-name">DoD IT</div>
        <div class="brand-sub">Olah Gambar</div>
      </div>
    </div>
    <div class="topbar-right">
      <span id="worker-status" class="badge mute" role="status" aria-live="polite">Memeriksa worker…</span>
      <label class="sr-only" for="theme">Tema</label>
      <select id="theme" class="select select-sm" aria-label="Tema">
        <option value="system">Tema: sistem</option>
        <option value="light">Tema: terang</option>
        <option value="dark">Tema: gelap</option>
      </select>
    </div>
  </div>
</header>

<main id="konten" class="wrap">
  <div class="page-head">
    <div class="eyebrow">Alat gambar</div>
    <h1>Olah <b>logo &amp; foto</b></h1>
    <p class="lead">Perjelas gambar buram, hapus background, pangkas padding, lalu dapatkan tiga PNG:
      transparan dengan rasio asli (sisi terpanjang min. <?= (int)$CFG['min_side'] ?>px), serta persegi
      <?= implode(' &amp; ', array_map(fn($s) => "{$s}px", $CFG['squares'])) ?> berlatar putih.</p>
  </div>

  <div class="layout">
    <!-- Panel kiri: unggah + pengaturan -->
    <section class="card panel" aria-labelledby="h-unggah">
      <div class="card-head"><h2 id="h-unggah">Unggah &amp; atur</h2></div>
      <form id="form" class="card-body stack" novalidate>
        <div id="drop" class="drop" tabindex="0" role="button" aria-describedby="drop-hint">
          <svg class="drop-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
          <div class="drop-title">Tarik gambar ke sini atau <u>pilih file</u></div>
          <div id="drop-hint" class="hint">JPG, PNG, WEBP, GIF, HEIC, AVIF · maks. <?= (int)$CFG['max_upload_mb'] ?> MB per file · bisa banyak sekaligus</div>
          <input id="file" type="file" accept="image/*,.heic,.heif,.avif" multiple class="sr-only" tabindex="-1">
        </div>

        <ul id="queue" class="queue" aria-label="Antrean file"></ul>

        <div class="field">
          <label for="enhance">Perjelas gambar (enhance)</label>
          <div class="select-wrap">
            <select id="enhance" name="enhance" class="select" aria-describedby="enhance-hint">
              <option value="auto" selected>Otomatis: hanya jika kecil atau buram</option>
              <option value="force">Selalu</option>
              <option value="off">Mati</option>
            </select>
          </div>
          <div id="enhance-hint" class="hint">AI Real-ESRGAN, dijalankan sebelum hapus background agar tepinya lebih akurat.</div>
        </div>

        <div class="field">
          <label for="bg">Hapus background</label>
          <div class="select-wrap">
            <select id="bg" name="bg" class="select" aria-describedby="bg-hint">
              <?php foreach ($CFG['bg_models'] as $k => $label): ?>
                <option value="<?= $h($k) ?>"<?= $k === $CFG['default_bg_model'] ? ' selected' : '' ?>><?= $h($label) ?></option>
              <?php endforeach; ?>
              <option value="solid">Warna solid (tanpa AI, untuk logo berlatar polos)</option>
              <option value="off">Jangan hapus</option>
            </select>
          </div>
          <div id="bg-hint" class="hint">Gambar yang sudah transparan otomatis dilewati.</div>
        </div>

        <div class="field">
          <label for="margin">Margin di output persegi <span class="opt">(opsional)</span></label>
          <div class="input-suffix">
            <input id="margin" name="margin" type="number" class="input" min="0" max="20" step="1" value="0" inputmode="numeric" aria-describedby="margin-hint">
            <span aria-hidden="true">%</span>
          </div>
          <div id="margin-hint" class="hint">0% = objek menyentuh tepi kotak. 5–10% memberi ruang napas.</div>
        </div>

        <div id="form-error" class="alert-bad" role="alert" hidden></div>

        <div class="actions">
          <button type="button" id="clear" class="btn ghost" hidden>Kosongkan</button>
          <button type="submit" id="run" class="btn primary" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>
            <span id="run-label">Proses</span>
          </button>
        </div>
      </form>
    </section>

    <!-- Panel kanan: hasil -->
    <section class="results" aria-labelledby="h-hasil">
      <div class="results-head">
        <div>
          <h2 id="h-hasil">Hasil</h2>
          <div id="summary" class="hint" aria-live="polite">Belum ada gambar yang diproses.</div>
        </div>
        <a id="zip" class="btn soft" href="#" hidden download>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16"/></svg>
          Unduh semua (ZIP)
        </a>
      </div>
      <div id="progress" class="progress" role="progressbar" aria-label="Kemajuan proses" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><i></i></div>

      <div id="empty" class="card empty">
        <div class="empty-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h5l1 2h6l1-2h5M5.5 5h13L21 15v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4z"/></svg></div>
        <div class="empty-title">Belum ada hasil</div>
        <p class="hint">Unggah satu atau beberapa gambar di panel kiri, lalu tekan <b>Proses</b>.</p>
      </div>
      <div id="list" class="list"></div>
    </section>
  </div>
</main>

<div id="toasts" class="toasts" role="status" aria-live="polite"></div>

<div id="ed" class="ed-overlay" hidden>
  <div class="ed-panel" role="dialog" aria-modal="true" aria-labelledby="ed-title" aria-describedby="ed-desc">
    <div class="ed-head">
      <div class="ed-headtext">
        <h2 id="ed-title">Koreksi</h2>
        <p id="ed-desc" class="hint">Klik area yang ingin dihapus atau dikembalikan. Tepi dihaluskan otomatis.</p>
      </div>
      <button type="button" class="btn icon ghost" data-ed="close" aria-label="Tutup editor">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="ed-body">
      <div class="ed-tools" role="toolbar" aria-label="Alat koreksi">
        <button type="button" class="ed-tool" data-tool="object" aria-pressed="false" title="Pilih Objek dengan AI (S)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M21 19a2 2 0 0 1-2 2M5 21a2 2 0 0 1-2-2M9 3h1M9 21h1M14 3h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1"/><path d="m12 12 4 10 1.7-4.3L22 16z"/></svg>
          <span>Pilih Objek</span>
        </button>
        <button type="button" class="ed-tool" data-tool="magic-erase" aria-pressed="true" title="Magic Eraser (W)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l9.5-9.5M17 3v2M21 7h-2M19 3l-1 1"/><path d="M8 16l-2-2"/></svg>
          <span>Magic Eraser</span>
        </button>
        <button type="button" class="ed-tool" data-tool="magic-restore" aria-pressed="false" title="Magic Restore (R)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>
          <span>Magic Restore</span>
        </button>
        <button type="button" class="ed-tool" data-tool="brush-erase" aria-pressed="false" title="Kuas Hapus (E)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4-4a2 2 0 0 1 0-2.8L13.2 4a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L10 21z"/><path d="M22 21H7M5 11l9 9"/></svg>
          <span>Kuas Hapus</span>
        </button>
        <button type="button" class="ed-tool" data-tool="brush-restore" aria-pressed="false" title="Kuas Pulihkan (B)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.06 11.9 17.1 3.86a2.9 2.9 0 1 1 4.1 4.1l-8.05 8.04"/><path d="M7.07 14.94C5.4 14.94 4 16.3 4 18c0 1.3-2 2-2 2 1 1 3 2 5 2 2.2 0 4-1.8 4-4.04a3 3 0 0 0-3.93-3.02z"/></svg>
          <span>Kuas Pulihkan</span>
        </button>
        <button type="button" class="ed-tool" data-tool="bg-erase" aria-pressed="false" title="Hapus Latar dengan kuas: hanya warna yang mirip titik awal (G)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4-4a2 2 0 0 1 0-2.8L13.2 4a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L10 21z"/><path d="M22 21H7"/><circle cx="18" cy="5" r="1.5"/></svg>
          <span>Hapus Latar</span>
        </button>
        <button type="button" class="ed-tool" data-tool="refine" aria-pressed="false" title="Rapikan Tepi: sapukan di tepi rambut/bulu/bayangan (F)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c2 3 6 5 6 10a6 6 0 0 1-12 0c0-5 4-7 6-10z"/><path d="M9 14c.5 1.5 1.5 2.5 3 3"/></svg>
          <span>Rapikan Tepi</span>
        </button>
        <button type="button" class="ed-tool" data-tool="hand" aria-pressed="false" title="Geser tampilan (H, tahan Spasi, atau geser 3 jari di layar sentuh)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>
          <span>Geser</span>
        </button>
      </div>

      <div class="ed-main">
        <div class="ed-opts">
          <div class="ed-opt" data-for="magic bgerase">
            <label for="ed-tol">Tolerance</label>
            <input id="ed-tol" type="range" min="0" max="128" value="32">
            <output id="ed-tol-v" for="ed-tol" class="num">32</output>
          </div>
          <label class="ed-check" data-for="magic"><input id="ed-contig" type="checkbox" checked> Contiguous</label>
          <label class="ed-check" data-for="magic"><input id="ed-aa" type="checkbox" checked> Anti-alias</label>
          <div class="ed-opt" data-for="brush bgerase refine" hidden>
            <label for="ed-size">Ukuran kuas</label>
            <input id="ed-size" type="range" min="2" max="200" value="24">
            <output id="ed-size-v" for="ed-size" class="num">24</output>
          </div>
          <div class="ed-opt" data-for="brush bgerase" hidden>
            <label for="ed-hard">Kekerasan</label>
            <input id="ed-hard" type="range" min="0" max="100" value="70">
            <output id="ed-hard-v" for="ed-hard" class="num">70</output>
          </div>
          <button type="button" class="btn sm soft" data-for="refine" data-ed="refine-all" hidden>Rapikan semua tepi</button>
          <div class="ed-objbar" data-for="object" hidden>
            <span id="ed-obj-status" class="hint" aria-live="polite">Klik objek (paling cocok untuk foto &amp; bentuk; teks tipis lebih rapi dengan Magic Eraser). Alt+klik = kurangi.</span>
            <button type="button" class="btn sm outline num" data-ed="obj-level" disabled title="Ganti cakupan pilihan: bagian kecil, sedang, atau keseluruhan (C)">Cakupan: otomatis</button>
            <button type="button" class="btn sm soft" data-ed="obj-keep" disabled>Sisakan objek</button>
            <button type="button" class="btn sm outline" data-ed="obj-restore" disabled>Pulihkan objek</button>
            <button type="button" class="btn sm outline" data-ed="obj-erase" disabled>Hapus objek</button>
            <button type="button" class="btn sm ghost" data-ed="obj-reset" disabled>Reset titik</button>
          </div>
        </div>
        <div id="ed-stage" class="ed-stage bg-checker">
          <div id="ed-layer" class="ed-layer">
            <canvas id="ed-canvas"></canvas>
            <canvas id="ed-overlay" class="ed-overlay-canvas"></canvas>
          </div>
          <div id="ed-cursor" class="ed-cursor" hidden></div>
          <div id="ed-loading" class="ed-loading"><span class="spin"></span> Memuat gambar…</div>
        </div>
      </div>
    </div>

    <div class="ed-foot">
      <div class="ed-group">
        <button type="button" class="btn icon outline" data-ed="undo" aria-label="Urungkan (Ctrl+Z)" title="Urungkan (Ctrl+Z)" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
        </button>
        <button type="button" class="btn icon outline" data-ed="redo" aria-label="Ulangi (Ctrl+Shift+Z)" title="Ulangi (Ctrl+Shift+Z)" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
        </button>
        <span class="ed-sep" aria-hidden="true"></span>
        <button type="button" class="btn icon outline" data-ed="zoom-out" aria-label="Perkecil">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
        </button>
        <button type="button" class="btn sm outline num" data-ed="fit" title="Pas di layar (0)"><span id="ed-zoom">100%</span></button>
        <button type="button" class="btn icon outline" data-ed="zoom-in" aria-label="Perbesar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <span class="ed-sep" aria-hidden="true"></span>
        <label class="sr-only" for="ed-bg">Latar preview</label>
        <select id="ed-bg" class="select select-sm">
          <option value="checker">Latar: kotak-kotak</option>
          <option value="white">Latar: putih</option>
          <option value="dark">Latar: gelap</option>
          <option value="magenta">Latar: magenta</option>
        </select>
        <button type="button" class="btn sm ghost" data-ed="peek" title="Tahan untuk melihat gambar asli">Tahan: lihat asli</button>
      </div>
      <div class="ed-group">
        <button type="button" class="btn ghost" data-ed="close">Batal</button>
        <button type="button" class="btn primary" data-ed="apply">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>
          <span>Terapkan</span>
        </button>
      </div>
    </div>
  </div>
</div>

<template id="tpl-result">
  <article class="card result">
    <div class="result-head">
      <div class="result-title">
        <img class="result-thumb" alt="">
        <div>
          <h3 class="result-name"></h3>
          <div class="hint result-meta"></div>
        </div>
      </div>
      <div class="result-actions">
        <button type="button" class="btn sm outline result-edit" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          Koreksi
        </button>
        <span class="badge mute result-badge">Antre</span>
      </div>
    </div>
    <ul class="steps"></ul>
    <div class="alert-bad result-error" role="alert" hidden></div>
    <div class="outputs"></div>
  </article>
</template>

<script src="assets/editor.js?v=<?= $v('editor.js') ?>" data-sam="assets/sam.js?v=<?= $v('sam.js') ?>" defer></script>
<script src="assets/app.js?v=<?= $v('app.js') ?>" defer></script>
</body>
</html>
