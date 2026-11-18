/*
 * Pilih objek dengan klik - SlimSAM-77 (Segment Anything, 5,5M parameter, Apache-2.0) yang berjalan
 * DI BROWSER dengan onnxruntime-web (WASM SIMD, multi-thread bila halaman cross-origin isolated).
 *
 * Kenapa di browser: server kecil (2 core / 4 GB), sedangkan laptop pengguna (MacBook M1/M2) jauh
 * lebih kuat. Encoder dijalankan sekali per gambar; decoder per klik hanya puluhan milidetik dan
 * tidak perlu bolak-balik ke server. Runtime + model (~14 MB terkompresi) di-cache browser.
 */
const BASE = new URL('./', import.meta.url).href;            // .../assets/
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225], SIZE = 1024;

let ort = null, enc = null, dec = null, loading = null;

export function info() {
  return { threads: ort?.env.wasm.numThreads ?? 0, isolated: self.crossOriginIsolated === true, secure: self.isSecureContext === true };
}

/** Muat runtime & model (sekali). */
export function load() {
  if (loading) return loading;
  loading = (async () => {
    ort = await import(BASE + 'vendor/ort/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = BASE + 'vendor/ort/';
    // M1/M2: 4 performance core. Multi-thread hanya bisa bila cross-origin isolated (header COOP/COEP).
    // (butuh HTTPS + header COOP/COEP; di HTTP biasa otomatis 1 thread).
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4)) : 1;
    // Jalankan inferensi di Web Worker agar halaman tidak membeku selama analisis.
    ort.env.wasm.proxy = true;
    const o = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    [enc, dec] = await Promise.all([
      ort.InferenceSession.create(BASE + 'models/sam/vision_encoder_quantized.onnx', o),
      ort.InferenceSession.create(BASE + 'models/sam/prompt_encoder_mask_decoder_quantized.onnx', o),
    ]);
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/**
 * Analisis gambar (encoder). rgba = Uint8ClampedArray W*H*4 (warna asli).
 * Return state untuk predict().
 */
export async function embed(rgba, W, H) {
  await load();
  const s = SIZE / Math.max(W, H), nw = Math.max(1, Math.round(W * s)), nh = Math.max(1, Math.round(H * s));
  const full = new OffscreenCanvas(W, H);
  full.getContext('2d').putImageData(new ImageData(rgba, W, H), 0, 0);
  const small = new OffscreenCanvas(nw, nh), sc = small.getContext('2d', { willReadFrequently: true });
  sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = 'high';
  sc.drawImage(full, 0, 0, nw, nh);
  const px = sc.getImageData(0, 0, nw, nh).data;
  const t = new Float32Array(3 * SIZE * SIZE);                // padding kanan/bawah = 0
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const i = (y * nw + x) * 4, p = y * SIZE + x;
    t[p] = (px[i] / 255 - MEAN[0]) / STD[0];
    t[SIZE * SIZE + p] = (px[i + 1] / 255 - MEAN[1]) / STD[1];
    t[2 * SIZE * SIZE + p] = (px[i + 2] / 255 - MEAN[2]) / STD[2];
  }
  const out = await enc.run({ pixel_values: new ort.Tensor('float32', t, [1, 3, SIZE, SIZE]) });
  return { emb: out.image_embeddings, pos: out.image_positional_embeddings, s, nw, nh, W, H };
}

/**
 * points = [[x, y, label]] (koordinat gambar asli, label 1 = objek, 0 = bukan).
 * level = 'auto' atau 0..2 (SAM memberi 3 tingkat cakupan).
 * Return { mask: Uint8Array W*H (0..255), chosen, order (index dari cakupan terkecil ke terbesar) }.
 */
export async function predict(st, points, level = 'auto') {
  const n = points.length;
  const pts = new Float32Array(n * 2), lbl = new BigInt64Array(n);
  points.forEach(([x, y, l], k) => { pts[k * 2] = x * st.s; pts[k * 2 + 1] = y * st.s; lbl[k] = BigInt(l ? 1 : 0); });
  const out = await dec.run({
    input_points: new ort.Tensor('float32', pts, [1, 1, n, 2]),
    input_labels: new ort.Tensor('int64', lbl, [1, 1, n]),
    image_embeddings: st.emb,
    image_positional_embeddings: st.pos,
  });
  const iou = out.iou_scores.data, m = out.pred_masks.data;   // [1,1,3] & [1,1,3,256,256]
  const lw = Math.max(1, Math.round((st.nw / SIZE) * 256)), lh = Math.max(1, Math.round((st.nh / SIZE) * 256));
  const cov = [0, 1, 2].map((k) => {
    let c = 0; const o = k * 65536;
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) if (m[o + y * 256 + x] > 0) c++;
    return c / (lw * lh);
  });
  let chosen;
  if (level === 'auto') {
    // skor tertinggi, tapi lewati masker "seluruh gambar" (>90%) bila ada alternatif
    const order = [0, 1, 2].sort((a, b) => iou[b] - iou[a]);
    chosen = order.find((k) => cov[k] <= 0.9) ?? order[0];
  } else chosen = (+level) % 3;

  // Ambang di resolusi asli SAM (logit > 0), lalu perbesar bilinear: biner dengan tepi halus.
  // (Logit SAM di area luas sering kecil, jadi peluang sigmoid mentah tidak dipakai.)
  const lo = new OffscreenCanvas(256, 256), lc = lo.getContext('2d');
  const id = lc.createImageData(256, 256), d = id.data, o = chosen * 65536;
  for (let p = 0; p < 65536; p++) { const v = m[o + p] > 0 ? 255 : 0; d[p * 4] = v; d[p * 4 + 3] = 255; }
  lc.putImageData(id, 0, 0);
  const up = new OffscreenCanvas(st.W, st.H), uc = up.getContext('2d', { willReadFrequently: true });
  uc.imageSmoothingEnabled = true; uc.imageSmoothingQuality = 'high';
  uc.drawImage(lo, 0, 0, lw, lh, 0, 0, st.W, st.H);
  const ud = uc.getImageData(0, 0, st.W, st.H).data, mask = new Uint8Array(st.W * st.H);
  for (let p = 0; p < mask.length; p++) mask[p] = ud[p * 4];
  const order = [0, 1, 2].sort((a, b) => cov[a] - cov[b]);
  return { mask, chosen, order };
}
