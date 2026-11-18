/*
 * Editor koreksi (berjalan di browser, gaya Photopea: typed array, tanpa framework).
 *
 * Data (berukuran sama):
 *   src = gambar sebelum hapus background (warna asli)  -> acuan warna seleksi, pemulihan, & guided filter
 *   cur = hasil saat ini (RGBA)                         -> yang diedit, lalu dikirim ke server
 *
 * Alat:
 *   object        : pilih objek dengan klik (SlimSAM di worker), lalu sisakan / pulihkan / hapus
 *   magic-erase   : flood-fill warna mirip -> transparan, tepi anti-alias + dekontaminasi warna
 *   magic-restore : kebalikannya, kembalikan dari src
 *   brush-erase / brush-restore : kuas bulat
 *   bg-erase      : "background eraser" - warna diambil sekali di awal sapuan, hanya warna mirip yang terhapus
 *   refine        : rapikan tepi - color guided filter (He et al.) dengan src sebagai panduan
 *   hand          : geser tampilan
 */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const ui = {
    root: $('#ed'), title: $('#ed-title'), stage: $('#ed-stage'), layer: $('#ed-layer'),
    canvas: $('#ed-canvas'), overlay: $('#ed-overlay'),
    cursor: $('#ed-cursor'), loading: $('#ed-loading'), zoom: $('#ed-zoom'), bg: $('#ed-bg'),
    tol: $('#ed-tol'), tolV: $('#ed-tol-v'), contig: $('#ed-contig'), aa: $('#ed-aa'),
    size: $('#ed-size'), sizeV: $('#ed-size-v'), hard: $('#ed-hard'), hardV: $('#ed-hard-v'),
    objStatus: $('#ed-obj-status'),
    undo: document.querySelector('[data-ed="undo"]'), redo: document.querySelector('[data-ed="redo"]'),
    apply: document.querySelector('[data-ed="apply"]'),
    objBtns: [...document.querySelectorAll('[data-ed^="obj-"]')],
  };
  if (!ui.root) return;
  const ctx = ui.canvas.getContext('2d', { willReadFrequently: true });
  // dimuat hanya saat Pilih Objek dipakai; URL berversi dari index.php agar cache browser tidak basi
  const SAM_URL = new URL(document.currentScript.dataset.sam || 'sam.js', document.baseURI).href;
  const octx = ui.overlay.getContext('2d');

  let W = 0, H = 0, src = null, cur = null, img = null, prev = null;
  let tool = 'magic-erase', z = 1, tx = 0, ty = 0;
  let undoStack = [], redoStack = [], undoBytes = 0, dirty = false;
  let opts = null, lastFocus = null, busy = false;
  const UNDO_MAX_BYTES = 160 * 1024 * 1024;

  /* ================================================================ util piksel */
  const dist = (d, i, r, g, b) => Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b));

  /** Flood-fill scanline pada warna src. */
  function selectRegion(sx, sy, tol, contiguous) {
    const n = W * H, mask = new Uint8Array(n);
    const si = (sy * W + sx) * 4, r = src[si], g = src[si + 1], b = src[si + 2];
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const mark = (p) => { mask[p] = 1; const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    if (!contiguous) {
      for (let p = 0; p < n; p++) if (dist(src, p * 4, r, g, b) <= tol) mark(p);
    } else {
      const stack = new Int32Array(n);
      let sp = 0; stack[sp++] = sy * W + sx;
      const ok = (p) => !mask[p] && dist(src, p * 4, r, g, b) <= tol;
      while (sp) {
        const p = stack[--sp];
        if (mask[p]) continue;
        const y = (p / W) | 0, row = y * W;
        let lx = p - row, rx = lx;
        while (lx > 0 && ok(row + lx - 1)) lx--;
        while (rx < W - 1 && ok(row + rx + 1)) rx++;
        let upOpen = false, dnOpen = false;
        for (let x = lx; x <= rx; x++) {
          const q = row + x; mark(q);
          if (y > 0) { const u = q - W; if (ok(u)) { if (!upOpen) { stack[sp++] = u; upOpen = true; } } else upOpen = false; }
          if (y < H - 1) { const d = q + W; if (ok(d)) { if (!dnOpen) { stack[sp++] = d; dnOpen = true; } } else dnOpen = false; }
        }
      }
    }
    if (x1 < 0) return null;
    return { mask, x0, y0, x1, y1, seed: [r, g, b] };
  }

  /* ================================================================ undo / redo (per region) */
  function pushUndo(x0, y0, x1, y1, from) {
    x0 = clamp(x0, 0, W - 1); y0 = clamp(y0, 0, H - 1); x1 = clamp(x1, 0, W - 1); y1 = clamp(y1, 0, H - 1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) data.set(from.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
    undoStack.push({ x: x0, y: y0, w, h, data });
    undoBytes += data.length;
    while (undoBytes > UNDO_MAX_BYTES && undoStack.length > 1) undoBytes -= undoStack.shift().data.length;
    redoStack = [];
    dirty = true;
    syncButtons();
  }
  function swapRegion(e) {
    const tmp = new Uint8ClampedArray(e.data.length);
    for (let y = 0; y < e.h; y++) {
      const o = ((e.y + y) * W + e.x) * 4, l = e.w * 4;
      tmp.set(cur.subarray(o, o + l), y * l);
      cur.set(e.data.subarray(y * l, y * l + l), o);
    }
    e.data = tmp;
    draw(e.x, e.y, e.w, e.h);
  }
  function undo() { const e = undoStack.pop(); if (!e) return; swapRegion(e); redoStack.push(e); dirty = true; syncButtons(); }
  function redo() { const e = redoStack.pop(); if (!e) return; swapRegion(e); undoStack.push(e); syncButtons(); }
  function syncButtons() { ui.undo.disabled = !undoStack.length; ui.redo.disabled = !redoStack.length; }

  function draw(x = 0, y = 0, w = W, h = H) { ctx.putImageData(img, 0, 0, x, y, w, h); }

  /* ================================================================ guided filter (rapikan tepi) */
  /** Box filter (rata-rata jendela (2r+1)^2) dengan running sum, O(N) - presisi tinggi. */
  function boxMean(a, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w; let s = 0;
      for (let x = -r; x <= r; x++) s += a[o + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = s;
        s += a[o + Math.min(x + r + 1, w - 1)] - a[o + Math.max(x - r, 0)];
      }
    }
    const k = 1 / ((2 * r + 1) * (2 * r + 1));
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s * k;
        s += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
      }
    }
    return out;
  }

  /**
   * Color guided filter pada region [x0..x1]x[y0..y1]: alpha baru mengikuti tepi di gambar asli.
   * weight(x, y) -> 0..1 menentukan seberapa banyak hasil filter dipakai. Setelah itu warna tepi
   * dibersihkan dengan sampel latar dari src: F = (C - (1-a)*B) / a.
   */
  /** Inti color guided filter: P (Float32, region w x h) -> q yang mengikuti tepi src. */
  function gfCore(x0, y0, w, h, P, r, eps) {
    const n = w * h;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x, i = ((y0 + y) * W + x0 + x) * 4;
      R[k] = src[i] / 255; G[k] = src[i + 1] / 255; B[k] = src[i + 2] / 255;
    }
    const mul = (a, b) => { const o = new Float32Array(n); for (let k = 0; k < n; k++) o[k] = a[k] * b[k]; return o; };
    const mR = boxMean(R, w, h, r), mG = boxMean(G, w, h, r), mB = boxMean(B, w, h, r), mP = boxMean(P, w, h, r);
    const mRR = boxMean(mul(R, R), w, h, r), mRG = boxMean(mul(R, G), w, h, r), mRB = boxMean(mul(R, B), w, h, r);
    const mGG = boxMean(mul(G, G), w, h, r), mGB = boxMean(mul(G, B), w, h, r), mBB = boxMean(mul(B, B), w, h, r);
    const mRP = boxMean(mul(R, P), w, h, r), mGP = boxMean(mul(G, P), w, h, r), mBP = boxMean(mul(B, P), w, h, r);
    const aR = new Float32Array(n), aG = new Float32Array(n), aB = new Float32Array(n), bb = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      // kovarians warna (3x3) + eps*I, lalu a = Sigma^-1 * cov(I, p)
      const vrr = mRR[k] - mR[k] * mR[k] + eps, vrg = mRG[k] - mR[k] * mG[k], vrb = mRB[k] - mR[k] * mB[k];
      const vgg = mGG[k] - mG[k] * mG[k] + eps, vgb = mGB[k] - mG[k] * mB[k], vbb = mBB[k] - mB[k] * mB[k] + eps;
      const cr = mRP[k] - mR[k] * mP[k], cg = mGP[k] - mG[k] * mP[k], cb = mBP[k] - mB[k] * mP[k];
      const i00 = vgg * vbb - vgb * vgb, i01 = vrb * vgb - vrg * vbb, i02 = vrg * vgb - vrb * vgg;
      const i11 = vrr * vbb - vrb * vrb, i12 = vrb * vrg - vrr * vgb, i22 = vrr * vgg - vrg * vrg;
      const det = vrr * i00 + vrg * i01 + vrb * i02;
      if (Math.abs(det) < 1e-12) { aR[k] = aG[k] = aB[k] = 0; bb[k] = mP[k]; continue; }
      const id = 1 / det;
      aR[k] = (i00 * cr + i01 * cg + i02 * cb) * id;
      aG[k] = (i01 * cr + i11 * cg + i12 * cb) * id;
      aB[k] = (i02 * cr + i12 * cg + i22 * cb) * id;
      bb[k] = mP[k] - aR[k] * mR[k] - aG[k] * mG[k] - aB[k] * mB[k];
    }
    const maR = boxMean(aR, w, h, r), maG = boxMean(aG, w, h, r), maB = boxMean(aB, w, h, r), mb = boxMean(bb, w, h, r);
    const q = new Float32Array(n);
    for (let k = 0; k < n; k++) q[k] = clamp(maR[k] * R[k] + maG[k] * G[k] + maB[k] * B[k] + mb[k], 0, 1);
    return { q, R, G, B };
  }

  /**
   * Masker kasar (mis. SAM 256px) -> ditempelkan ke tepi gambar asli. Diproses per tile agar memori
   * tetap kecil di gambar besar. Return Uint8Array W*H.
   */
  function snapMask(m, r, eps) {
    const out = new Uint8Array(W * H), T = 512, pad = r * 3;
    for (let ty0 = 0; ty0 < H; ty0 += T) for (let tx0 = 0; tx0 < W; tx0 += T) {
      const x0 = Math.max(0, tx0 - pad), y0 = Math.max(0, ty0 - pad);
      const x1 = Math.min(W - 1, tx0 + T - 1 + pad), y1 = Math.min(H - 1, ty0 + T - 1 + pad);
      const w = x1 - x0 + 1, h = y1 - y0 + 1, P = new Float32Array(w * h);
      let any0 = false, any1 = false;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = m[(y0 + y) * W + x0 + x]; P[y * w + x] = v / 255; if (v < 128) any0 = true; else any1 = true;
      }
      const ex1 = Math.min(W - 1, tx0 + T - 1), ey1 = Math.min(H - 1, ty0 + T - 1);
      if (!(any0 && any1)) {                       // tile seragam: tidak ada tepi, salin saja
        for (let y = ty0; y <= ey1; y++) for (let x = tx0; x <= ex1; x++) out[y * W + x] = m[y * W + x] > 127 ? 255 : 0;
        continue;
      }
      const { q } = gfCore(x0, y0, w, h, P, r, eps);
      for (let y = ty0; y <= ey1; y++) for (let x = tx0; x <= ex1; x++) {
        const v = q[(y - y0) * w + (x - x0)];
        out[y * W + x] = Math.round(clamp((v - 0.5) * 3 + 0.5, 0, 1) * 255);   // pertegas, tetap halus di tepi
      }
    }
    return out;
  }

  function guidedRefine(x0, y0, x1, y1, r, eps, weight) {
    x0 = clamp(x0 - r * 2, 0, W - 1); y0 = clamp(y0 - r * 2, 0, H - 1);
    x1 = clamp(x1 + r * 2, 0, W - 1); y1 = clamp(y1 + r * 2, 0, H - 1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h;
    const P = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) P[y * w + x] = cur[((y0 + y) * W + x0 + x) * 4 + 3] / 255;
    const { q: Q, R, G, B } = gfCore(x0, y0, w, h, P, r, eps);
    const mul = (a, b) => { const o = new Float32Array(n); for (let k = 0; k < n; k++) o[k] = a[k] * b[k]; return o; };

    // sampel warna latar asli di sekitar (piksel yang sudah transparan) untuk dekontaminasi
    const rb = Math.max(4, r * 2);
    const isBg = new Float32Array(n);
    for (let k = 0; k < n; k++) isBg[k] = P[k] < 0.05 ? 1 : 0;
    const cnt = boxMean(isBg, w, h, rb), bR = boxMean(mul(R, isBg), w, h, rb), bG = boxMean(mul(G, isBg), w, h, rb), bB = boxMean(mul(B, isBg), w, h, rb);

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const wt = weight(x0 + x, y0 + y);
      if (wt <= 0) continue;
      const k = y * w + x, i = ((y0 + y) * W + x0 + x) * 4;
      let q = Q[k];
      // buang sisa sangat tipis agar tidak muncul kabut
      if (q < 0.04) q = 0; else if (q > 0.97) q = 1;
      const a = P[k] + (q - P[k]) * wt;
      cur[i + 3] = Math.round(a * 255);
      if (a > 0.02 && a < 0.98 && cnt[k] > 0.02) {
        const br = bR[k] / cnt[k], bg = bG[k] / cnt[k], bl = bB[k] / cnt[k];
        cur[i] = clamp(((R[k] - (1 - a) * br) / a) * 255, 0, 255);
        cur[i + 1] = clamp(((G[k] - (1 - a) * bg) / a) * 255, 0, 255);
        cur[i + 2] = clamp(((B[k] - (1 - a) * bl) / a) * 255, 0, 255);
      } else if (a >= 0.98 && P[k] < 0.98) {
        cur[i] = src[i]; cur[i + 1] = src[i + 1]; cur[i + 2] = src[i + 2];
      }
    }
    return [x0, y0, x1, y1];
  }

  /** Pita tepi: piksel yang dalam radius rad memiliki alpha campuran (ada opak & transparan). */
  function edgeBand(x0, y0, x1, y1, rad) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h;
    const o = new Float32Array(n), t = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = cur[((y0 + y) * W + x0 + x) * 4 + 3];
      o[y * w + x] = a > 200 ? 1 : 0; t[y * w + x] = a < 55 ? 1 : 0;
    }
    const mo = boxMean(o, w, h, rad), mt = boxMean(t, w, h, rad);
    const band = new Uint8Array(n);
    for (let k = 0; k < n; k++) band[k] = mo[k] > 0.001 && mt[k] > 0.001 ? 1 : 0;
    return { band, w };
  }

  function refineAll() {
    if (!cur) return;
    prev.set(cur);
    const r = Math.max(2, Math.round(Math.max(W, H) / 400));       // ~3 px di gambar 1024
    const { band, w } = edgeBand(0, 0, W - 1, H - 1, r + 1);
    const box = guidedRefine(0, 0, W - 1, H - 1, r, 1e-4, (x, y) => band[y * w + x]);
    pushUndo(0, 0, W - 1, H - 1, prev);
    draw(box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1);
  }

  /* ================================================================ magic eraser / restore */
  function magic(sx, sy, restore) {
    const tol = +ui.tol.value, aa = ui.aa.checked;
    const reg = selectRegion(sx, sy, tol, ui.contig.checked);
    if (!reg) return;
    const { mask, seed } = reg;
    const pad = 3;
    const x0 = Math.max(0, reg.x0 - pad), y0 = Math.max(0, reg.y0 - pad);
    const x1 = Math.min(W - 1, reg.x1 + pad), y1 = Math.min(H - 1, reg.y1 + pad);
    pushUndo(x0, y0, x1, y1, cur);
    prev.set(cur);
    const [sr, sg, sb] = seed;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x; if (!mask[p]) continue;
      const i = p * 4;
      if (restore) { cur[i] = src[i]; cur[i + 1] = src[i + 1]; cur[i + 2] = src[i + 2]; cur[i + 3] = 255; }
      else cur[i + 3] = 0;
    }
    if (aa) edges(mask, x0, y0, x1, y1, sr, sg, sb, restore, tol);
    draw(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  /** Tepi region: C = a*F + (1-a)*S  ->  alpha a & warna bersih F' = (C - (1-a)*S) / a. */
  function edges(mask, x0, y0, x1, y1, sr, sg, sb, restore, tol) {
    const isEdge = (x, y) => {
      const m = mask[y * W + x];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (mask[ny * W + nx] !== m) return true;
      }
      return false;
    };
    const updates = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!isEdge(x, y)) continue;
      const p = y * W + x, i = p * 4;
      const cr = src[i], cg = src[i + 1], cb = src[i + 2];
      let best = -1, fr = 0, fg = 0, fb = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx; if (mask[q]) continue;
        const j = q * 4, d = dist(src, j, sr, sg, sb);
        if (d > best) { best = d; fr = src[j]; fg = src[j + 1]; fb = src[j + 2]; }
      }
      if (best < 8) continue;
      const vr = fr - sr, vg = fg - sg, vb = fb - sb;
      const a = clamp(((cr - sr) * vr + (cg - sg) * vg + (cb - sb) * vb) / (vr * vr + vg * vg + vb * vb), 0, 1);
      updates.push(p, a);
    }
    for (let k = 0; k < updates.length; k += 2) {
      const p = updates[k], a = updates[k + 1], i = p * 4;
      if (!restore) {
        const outA = Math.min(prev[i + 3], Math.round(a * 255));
        cur[i + 3] = outA;
        if (outA > 0 && a < 0.999) {
          cur[i] = clamp((src[i] - (1 - a) * sr) / a, 0, 255);
          cur[i + 1] = clamp((src[i + 1] - (1 - a) * sg) / a, 0, 255);
          cur[i + 2] = clamp((src[i + 2] - (1 - a) * sb) / a, 0, 255);
        }
      } else if (!mask[p]) {
        const d = dist(src, i, sr, sg, sb);
        const f = clamp((tol * 1.5 + 1 - d) / (tol * 0.5 + 1), 0, 1);
        const na = Math.round(f * 255);
        if (na > cur[i + 3]) {
          if (cur[i + 3] === 0) { cur[i] = src[i]; cur[i + 1] = src[i + 1]; cur[i + 2] = src[i + 2]; }
          cur[i + 3] = na;
        }
      }
    }
  }

  /* ================================================================ kuas (hapus, pulihkan, hapus latar, rapikan) */
  let stroke = null, refineMask = null;
  function brushStart(x, y) {
    prev.set(cur);
    stroke = { x0: W, y0: H, x1: -1, y1: -1, last: null, seed: null };
    if (tool === 'bg-erase') {
      const ix = clamp(Math.floor(x), 0, W - 1), iy = clamp(Math.floor(y), 0, H - 1), i = (iy * W + ix) * 4;
      stroke.seed = [src[i], src[i + 1], src[i + 2]];    // sampling "sekali" (aman: tidak ikut memakan objek)
    }
    if (tool === 'refine') {
      refineMask = new Uint8Array(W * H);
      octx.clearRect(0, 0, W, H);
    }
  }
  function brushDab(cx, cy) {
    const r = +ui.size.value / 2, hard = tool === 'refine' ? 1 : +ui.hard.value / 100, inner = r * hard;
    const bx0 = Math.max(0, Math.floor(cx - r)), by0 = Math.max(0, Math.floor(cy - r));
    const bx1 = Math.min(W - 1, Math.ceil(cx + r)), by1 = Math.min(H - 1, Math.ceil(cy + r));
    if (bx1 < bx0 || by1 < by0) return;
    const tol = +ui.tol.value, seed = stroke.seed;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const w = d <= inner ? 1 : (r - d) / Math.max(r - inner, 1e-3);
      const p = y * W + x, i = p * 4;
      if (tool === 'brush-erase') {
        cur[i + 3] = Math.min(cur[i + 3], Math.round(prev[i + 3] * (1 - w)));
      } else if (tool === 'bg-erase') {
        const cd = dist(src, i, seed[0], seed[1], seed[2]);
        if (cd > tol) continue;
        const e = w * (cd <= tol * 0.6 ? 1 : (tol - cd) / (tol * 0.4 + 1e-3));
        cur[i + 3] = Math.min(cur[i + 3], Math.round(prev[i + 3] * (1 - e)));
      } else if (tool === 'brush-restore') {
        const na = Math.max(cur[i + 3], Math.round(255 * w));
        if (na > cur[i + 3]) {
          const t = cur[i + 3] === 0 ? 1 : w;
          cur[i] += (src[i] - cur[i]) * t; cur[i + 1] += (src[i + 1] - cur[i + 1]) * t; cur[i + 2] += (src[i + 2] - cur[i + 2]) * t;
          cur[i + 3] = na;
        }
      } else if (tool === 'refine') {
        refineMask[p] = Math.max(refineMask[p], Math.round(255 * w));
      }
    }
    stroke.x0 = Math.min(stroke.x0, bx0); stroke.y0 = Math.min(stroke.y0, by0);
    stroke.x1 = Math.max(stroke.x1, bx1); stroke.y1 = Math.max(stroke.y1, by1);
    if (tool === 'refine') {
      octx.fillStyle = 'rgba(2, 172, 223, 0.35)';
      octx.beginPath(); octx.arc(cx, cy, r, 0, Math.PI * 2); octx.fill();
    } else draw(bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1);
  }
  function brushTo(x, y) {
    const l = stroke.last, step = Math.max(1, +ui.size.value / 6);
    if (!l) brushDab(x, y);
    else {
      const d = Math.hypot(x - l[0], y - l[1]), n = Math.ceil(d / step);
      for (let k = 1; k <= n; k++) brushDab(l[0] + ((x - l[0]) * k) / n, l[1] + ((y - l[1]) * k) / n);
    }
    stroke.last = [x, y];
  }
  function brushEnd() {
    if (stroke && stroke.x1 >= 0) {
      if (tool === 'refine') {
        const r = clamp(Math.round(+ui.size.value / 8), 2, 12);
        const box = guidedRefine(stroke.x0, stroke.y0, stroke.x1, stroke.y1, r, 1e-3, (x, y) => refineMask[y * W + x] / 255);
        octx.clearRect(0, 0, W, H);
        refineMask = null;
        pushUndo(box[0], box[1], box[2], box[3], prev);
        draw(box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1);
      } else pushUndo(stroke.x0, stroke.y0, stroke.x1, stroke.y1, prev);
    }
    stroke = null;
  }

  /* ================================================================ pilih objek (SAM, di worker) */
  const OBJ_HINT = 'Klik objek (paling cocok untuk foto & bentuk; teks tipis lebih rapi dengan Magic Eraser). Alt+klik = kurangi.';
  const obj = { ready: false, preparing: null, sam: null, state: null, seq: 0, points: [], mask: null, level: 'auto', order: null, chosen: null };
  const levelBtn = document.querySelector('[data-ed="obj-level"]');
  function levelLabel() {
    if (obj.level === 'auto' || !obj.order) { levelBtn.textContent = 'Cakupan: otomatis'; return; }
    const names = ['kecil', 'sedang', 'besar'];
    levelBtn.textContent = 'Cakupan: ' + names[obj.order.indexOf(obj.chosen)];
  }
  function objStatus(t) { ui.objStatus.textContent = t; }
  function objButtons() { ui.objBtns.forEach((b) => (b.disabled = !(b.dataset.ed === 'obj-reset' ? obj.points.length : obj.mask))); }
  // (tombol cakupan juga termasuk obj-* sehingga aktif hanya bila ada masker)

  /** Muat model di browser & analisis gambar (sekali per sesi editor). */
  async function objPrepare(silent = false) {
    if (obj.ready) return true;
    if (!obj.preparing) {
      obj.preparing = (async () => {
        try {
          objStatus('Memuat model AI di browser (sekali, ±14 MB)…');
          obj.sam = await import(SAM_URL);
          await obj.sam.load();
          objStatus('Menganalisis gambar…');
          const t0 = performance.now();
          obj.state = await obj.sam.embed(src, W, H);
          obj.ready = true;
          const inf = obj.sam.info();
          objStatus(`Siap (${((performance.now() - t0) / 1000).toFixed(1)} dtk, ${inf.threads} thread). ` + OBJ_HINT);
          return true;
        } catch (e) {
          const msg = 'Pilih Objek gagal dimuat: ' + (e.message || e);
          objStatus(msg); if (!silent) opts.onError?.(msg);
          return false;
        } finally { obj.preparing = null; }
      })();
    }
    return obj.preparing;
  }

  async function objClick(x, y, negative) {
    if (!(await objPrepare())) return;
    obj.points.push([Math.round(x), Math.round(y), negative ? 0 : 1]);
    objButtons();
    drawObjOverlay();
    return objRequest();
  }

  /** Ganti cakupan: kecil -> sedang -> besar -> kecil (urutan dari server, berdasar luas masker). */
  function objCycleLevel() {
    if (!obj.order || !obj.points.length) return;
    const i = obj.order.indexOf(obj.chosen);
    obj.level = String(obj.order[(i + 1) % 3]);
    objRequest();
  }

  async function objRequest() {
    const seq = ++obj.seq;
    objStatus('Memilih…');
    try {
      const r = await obj.sam.predict(obj.state, obj.points, obj.level);
      if (seq !== obj.seq) return;                     // ada klik lebih baru
      obj.mask = r.mask; obj.chosen = r.chosen; obj.order = r.order;
      levelLabel();
      objStatus(`${obj.points.length} titik · pilih aksi, atau tambah titik untuk memperbaiki.`);
    } catch (e) {
      objStatus(e.message || String(e));
    }
    objButtons();
    drawObjOverlay();
  }

  function drawObjOverlay() {
    octx.clearRect(0, 0, W, H);
    if (obj.mask) {
      const o = octx.createImageData(W, H), d = o.data, m = obj.mask;
      for (let p = 0; p < m.length; p++) if (m[p] > 127) { const i = p * 4; d[i] = 2; d[i + 1] = 172; d[i + 2] = 223; d[i + 3] = 110; }
      octx.putImageData(o, 0, 0);
    }
    const rr = Math.max(4, 7 / z);
    for (const [x, y, l] of obj.points) {
      octx.beginPath(); octx.arc(x, y, rr, 0, Math.PI * 2);
      octx.fillStyle = l ? '#16a34a' : '#dc2626'; octx.fill();
      octx.lineWidth = Math.max(1.5, 2 / z); octx.strokeStyle = '#fff'; octx.stroke();
    }
  }

  function objReset() { obj.points = []; obj.mask = null; obj.level = 'auto'; obj.order = null; obj.seq++; levelLabel(); objButtons(); drawObjOverlay(); objStatus(OBJ_HINT); }

  /** keep: hapus semua di luar objek | erase: hapus objek | restore: pulihkan objek dari gambar asli. */
  function objApply(mode) {
    if (!obj.mask) return;
    // masker SAM beresolusi rendah (256px): tempelkan ke tepi gambar asli sebelum dipakai
    const m = snapMask(obj.mask, Math.max(4, Math.round(Math.max(W, H) / 128)), 1e-3);
    prev.set(cur);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let p = 0; p < m.length; p++) {
      const i = p * 4, a = m[p] / 255;
      let changed = false;
      if (mode === 'keep') { const na = Math.min(cur[i + 3], Math.round(255 * a)); if (na !== cur[i + 3]) { cur[i + 3] = na; changed = true; } }
      else if (mode === 'erase') { const na = Math.round(cur[i + 3] * (1 - a)); if (na !== cur[i + 3]) { cur[i + 3] = na; changed = true; } }
      else if (a > 0) {
        const na = Math.max(cur[i + 3], Math.round(255 * a));
        if (na !== cur[i + 3]) { if (cur[i + 3] === 0) { cur[i] = src[i]; cur[i + 1] = src[i + 1]; cur[i + 2] = src[i + 2]; } cur[i + 3] = na; changed = true; }
      }
      if (changed) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) { objReset(); return; }
    // masker SAM beresolusi rendah -> rapikan tepinya dengan guided filter (mengikuti tepi gambar asli)
    const r = Math.max(2, Math.round(Math.max(W, H) / 300));
    const bx0 = Math.max(0, x0 - 8), by0 = Math.max(0, y0 - 8), bx1 = Math.min(W - 1, x1 + 8), by1 = Math.min(H - 1, y1 + 8);
    const { band, w } = edgeBand(bx0, by0, bx1, by1, r + 2);
    const box = guidedRefine(bx0, by0, bx1, by1, r, 1e-4, (x, y) => {
      const k = (y - by0) * w + (x - bx0);
      return x >= bx0 && x <= bx1 && y >= by0 && y <= by1 ? band[k] : 0;
    });
    pushUndo(Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1), prev);
    draw();
    objReset();
  }

  /* ================================================================ tampilan (zoom / pan) */
  function applyView() {
    ui.layer.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    ui.layer.classList.toggle('pixelated', z >= 3);
    ui.zoom.textContent = Math.round(z * 100) + '%';
    if (tool === 'object') drawObjOverlay();
    updateCursor();
  }
  function fit() {
    const r = ui.stage.getBoundingClientRect(), m = 24;
    z = Math.min((r.width - m * 2) / W, (r.height - m * 2) / H, 4);
    tx = (r.width - W * z) / 2; ty = (r.height - H * z) / 2;
    applyView();
  }
  function zoomAt(f, px, py) {
    const r = ui.stage.getBoundingClientRect();
    px = px ?? r.width / 2; py = py ?? r.height / 2;
    const nz = clamp(z * f, 0.05, 32);
    tx = px - ((px - tx) * nz) / z; ty = py - ((py - ty) * nz) / z; z = nz;
    applyView();
  }
  const toImg = (e) => {
    const r = ui.stage.getBoundingClientRect();
    return [(e.clientX - r.left - tx) / z, (e.clientY - r.top - ty) / z];
  };

  const BRUSHES = ['brush-erase', 'brush-restore', 'bg-erase', 'refine'];
  let mouse = null, space = false, panning = null;
  function updateCursor() {
    ui.stage.dataset.tool = space ? 'hand' : tool;
    if (!BRUSHES.includes(tool) || !mouse || space) { ui.cursor.hidden = true; return; }
    const d = +ui.size.value * z;
    ui.cursor.hidden = false;
    ui.cursor.style.width = ui.cursor.style.height = d + 'px';
    ui.cursor.style.transform = `translate(${mouse[0] - d / 2}px, ${mouse[1] - d / 2}px)`;
  }

  ui.stage.addEventListener('contextmenu', (e) => { if (tool === 'object') e.preventDefault(); });
  ui.stage.addEventListener('pointerdown', (e) => {
    if (busy || !cur) return;
    ui.stage.setPointerCapture(e.pointerId);
    if (tool === 'hand' || space || e.button === 1) { panning = [e.clientX - tx, e.clientY - ty]; ui.stage.classList.add('grabbing'); return; }
    const [x, y] = toImg(e), ix = Math.floor(x), iy = Math.floor(y);
    const inside = ix >= 0 && iy >= 0 && ix < W && iy < H;
    if (tool === 'object') { if (inside && (e.button === 0 || e.button === 2)) objClick(x, y, e.altKey || e.button === 2); return; }
    if (e.button !== 0) return;
    if (tool.startsWith('magic')) { if (inside) magic(ix, iy, tool === 'magic-restore'); }
    else { brushStart(x, y); brushTo(x, y); }
  });
  ui.stage.addEventListener('pointermove', (e) => {
    const r = ui.stage.getBoundingClientRect();
    mouse = [e.clientX - r.left, e.clientY - r.top];
    if (panning) { tx = e.clientX - panning[0]; ty = e.clientY - panning[1]; applyView(); return; }
    if (stroke) { const [x, y] = toImg(e); brushTo(x, y); }
    updateCursor();
  });
  const endPointer = () => { if (panning) { panning = null; ui.stage.classList.remove('grabbing'); } if (stroke) brushEnd(); };
  ui.stage.addEventListener('pointerup', endPointer);
  ui.stage.addEventListener('pointercancel', endPointer);
  ui.stage.addEventListener('pointerleave', () => { mouse = null; updateCursor(); });
  ui.stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = ui.stage.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  /* ================================================================ toolbar & opsi */
  const GROUP = { 'magic-erase': 'magic', 'magic-restore': 'magic', 'brush-erase': 'brush', 'brush-restore': 'brush', 'bg-erase': 'bgerase', refine: 'refine', object: 'object', hand: 'hand' };
  function setTool(t) {
    if (tool === 'object' && t !== 'object') { objReset(); octx.clearRect(0, 0, W, H); }
    tool = t;
    document.querySelectorAll('.ed-tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    const g = GROUP[t];
    document.querySelectorAll('[data-for]').forEach((el) => (el.hidden = !el.dataset.for.split(' ').includes(g)));
    if (t === 'bg-erase' && +ui.tol.value > 80) { ui.tol.value = 40; ui.tolV.textContent = '40'; }
    if (t === 'object' && opts) objPrepare();
    updateCursor();
  }
  document.querySelectorAll('.ed-tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  const bindRange = (inp, out) => inp.addEventListener('input', () => { out.textContent = inp.value; updateCursor(); });
  bindRange(ui.tol, ui.tolV); bindRange(ui.size, ui.sizeV); bindRange(ui.hard, ui.hardV);
  ui.bg.addEventListener('change', () => { ui.stage.className = 'ed-stage bg-' + ui.bg.value; });

  ui.root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]'); if (!b || b.disabled) return;
    const a = b.dataset.ed;
    if (a === 'close') close();
    else if (a === 'undo') undo();
    else if (a === 'redo') redo();
    else if (a === 'zoom-in') zoomAt(1.25);
    else if (a === 'zoom-out') zoomAt(0.8);
    else if (a === 'fit') fit();
    else if (a === 'apply') applyEdits();
    else if (a === 'refine-all') refineAll();
    else if (a === 'obj-keep') objApply('keep');
    else if (a === 'obj-erase') objApply('erase');
    else if (a === 'obj-restore') objApply('restore');
    else if (a === 'obj-reset') objReset();
    else if (a === 'obj-level') objCycleLevel();
  });
  const peek = document.querySelector('[data-ed="peek"]');
  const peekOn = () => { if (src) ctx.putImageData(new ImageData(src, W, H), 0, 0); };
  const peekOff = () => { if (cur) draw(); };
  peek.addEventListener('pointerdown', peekOn);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => peek.addEventListener(ev, peekOff));

  document.addEventListener('keydown', (e) => {
    if (ui.root.hidden) return;
    if (e.key === 'Escape') { if (tool === 'object' && obj.points.length) objReset(); else if (!dirty) close(); return; }
    if (e.target.matches('input, select, textarea')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod) return;
    if (k === ' ') { e.preventDefault(); space = true; updateCursor(); return; }
    const map = { s: 'object', w: 'magic-erase', r: 'magic-restore', e: 'brush-erase', b: 'brush-restore', g: 'bg-erase', f: 'refine', h: 'hand' };
    if (map[k]) { setTool(map[k]); return; }
    if (k === 'enter' && tool === 'object' && obj.mask) { objApply('keep'); return; }
    if (k === 'c' && tool === 'object') { objCycleLevel(); return; }
    if (k === '[' || k === ']') { ui.size.value = clamp(+ui.size.value + (k === ']' ? 4 : -4), 2, 200); ui.sizeV.textContent = ui.size.value; updateCursor(); }
    if (k === '0') fit();
    if (k === '+' || k === '=') zoomAt(1.25);
    if (k === '-') zoomAt(0.8);
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') { space = false; updateCursor(); } });

  ui.root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...ui.root.querySelectorAll('button:not([disabled]), input, select')].filter((el) => !el.closest('[hidden]'));
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  /* ================================================================ buka / tutup / terapkan */
  async function loadPixels(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.text()) || 'Gagal memuat gambar kerja');
    const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    return cx.getImageData(0, 0, bmp.width, bmp.height);
  }

  async function open(o) {
    opts = o; lastFocus = document.activeElement;
    ui.title.textContent = 'Koreksi · ' + o.name;
    ui.root.hidden = false; document.body.classList.add('modal-open');
    ui.loading.hidden = false; ui.layer.hidden = true;
    undoStack = []; redoStack = []; undoBytes = 0; dirty = false; syncButtons();
    obj.ready = false; obj.state = null; obj.points = []; obj.mask = null;
    try {
      const [s, c] = await Promise.all([loadPixels(o.edit.src), loadPixels(o.edit.cut)]);
      if (s.width !== c.width || s.height !== c.height) throw new Error('Ukuran gambar kerja tidak cocok.');
      W = s.width; H = s.height; src = s.data; img = c; cur = c.data; prev = new Uint8ClampedArray(cur.length);
      ui.canvas.width = ui.overlay.width = W; ui.canvas.height = ui.overlay.height = H;
      ui.layer.style.width = W + 'px'; ui.layer.style.height = H + 'px';
      draw(); octx.clearRect(0, 0, W, H);
      ui.loading.hidden = true; ui.layer.hidden = false;
      setTool('magic-erase');
      fit();
      // Siapkan "Pilih Objek" di latar belakang (Web Worker, CPU laptop pengguna - bukan server),
      // sehingga saat alatnya dipilih biasanya sudah siap.
      const session = opts;
      setTimeout(() => { if (opts === session && !ui.root.hidden) objPrepare(true); }, 800);
      document.querySelector('.ed-tool[aria-pressed="true"]').focus();
    } catch (err) {
      close();
      o.onError?.(err.message);
    }
  }

  function close() {
    if (busy) return;
    obj.seq++;
    ui.root.hidden = true; document.body.classList.remove('modal-open');
    src = cur = img = prev = null; undoStack = []; redoStack = []; refineMask = null;
    lastFocus?.focus?.();
  }

  async function applyEdits() {
    if (busy || !cur) return;
    if (!dirty) { close(); return; }
    busy = true;
    const label = ui.apply.querySelector('span'), old = label.textContent;
    ui.apply.disabled = true; label.textContent = 'Menerapkan…';
    try {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').putImageData(img, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const fd = new FormData();
      fd.append('id', opts.id); fd.append('file', blob, 'edit.png'); fd.append('margin', String(opts.margin ?? 0));
      const r = await fetch('api/render.php', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({ error: `Galat server (${r.status})` }));
      if (!r.ok || d.error) throw new Error(d.error || `Galat ${r.status}`);
      busy = false; dirty = false;
      close();
      opts.onApply?.(d);
    } catch (err) {
      opts.onError?.(err.message);
    } finally {
      busy = false; ui.apply.disabled = false; label.textContent = old;
    }
  }

  window.addEventListener('resize', () => { if (!ui.root.hidden && cur) fit(); });
  window.ImgEditor = { open };
})();
