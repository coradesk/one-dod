"""
Refine khusus logo: memperbaiki kelemahan umum AI segmentasi pada logo berlatar sederhana.

Masalah yang ditangani:
  1. Bagian putih DI DALAM logo (siluet, bingkai) ikut terhapus karena latarnya juga putih.
  2. Teks tipis hilang pada latar bermotif sederhana (mis. "kotak-kotak transparan palsu").
  3. Bayangan (drop shadow) yang tersisa di sekitar logo.

Cara kerja (hanya bila latar di tepi gambar tersusun dari 1-4 warna):
  - palet latar diambil dari piksel tepi;
  - kandidat latar = piksel dekat warna palet ATAU "bayangan" (warna palet yang digelapkan merata,
    bergradasi halus);
  - latar = kandidat yang terhubung ke tepi gambar (region growing);
  - kandidat yang tertutup logo: lubang kecil (bagian dalam huruf A, O, &) dibuang,
    lubang besar (siluet putih, bingkai) dipertahankan;
  - tepi dihaluskan dengan estimasi alpha lokal dan warnanya dibersihkan dari warna latar.
Bila hasilnya terlihat bocor dibanding masker AI, masker AI yang dipakai.
"""
from __future__ import annotations

import cv2
import numpy as np

NEAR = 0.10          # jarak maks (0..1, per kanal) ke warna palet agar dianggap latar
SHADOW_MIN = 0.45    # bayangan paling gelap: 45% kecerahan latar
SHADOW_DEV = 0.06    # deviasi rasio antar-kanal (bayangan = digelapkan merata, tanpa ganti warna)
SHADOW_GRAD = 0.035  # gradien maks bayangan (bayangan selalu lembut, tepi objek tajam)
HOLE_MIN = 0.006     # lubang >= 0.6% luas objek dipertahankan sebagai bagian logo


def border_palette(rgb: np.ndarray, frame: int = 3, max_colors: int = 4):
    """Palet warna latar dari bingkai tepi. None bila tepi terlalu beragam (gradien, foto)."""
    b = np.concatenate([rgb[:frame].reshape(-1, 3), rgb[-frame:].reshape(-1, 3),
                        rgb[:, :frame].reshape(-1, 3), rgb[:, -frame:].reshape(-1, 3)])
    q = np.round(b * 15).astype(np.int32)                       # kuantisasi kasar
    keys, inv, counts = np.unique(q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2], return_inverse=True, return_counts=True)
    order = np.argsort(-counts)
    palette: list[np.ndarray] = []
    for k in order[:12]:
        if counts[k] < len(b) * 0.02:
            break
        c = np.median(b[inv == k], axis=0)
        if all(np.abs(c - p).max() > 0.04 for p in palette):
            palette.append(c)
        if len(palette) >= max_colors:
            break
    if not palette:
        return None
    pal = np.array(palette, dtype=np.float32)
    d = np.abs(b[:, None, :] - pal[None]).max(axis=2).min(axis=1)
    if (d < 0.06).mean() < 0.95:
        return None
    return pal


def gradient_background(rgb: np.ndarray, frame: int = 3):
    """Latar gradien halus: model polinomial 2D orde-2 per kanal dari piksel tepi.
    Return peta warna latar HxWx3, atau None bila tepi tidak cocok dengan gradien halus."""
    h, w, _ = rgb.shape
    yy, xx = np.mgrid[0:h, 0:w]
    m = np.zeros((h, w), bool)
    m[:frame], m[-frame:], m[:, :frame], m[:, -frame:] = True, True, True, True
    def basis(x, y):
        x = x / max(w - 1, 1) - 0.5
        y = y / max(h - 1, 1) - 0.5
        return np.stack([np.ones_like(x), x, y, x * x, y * y, x * y], axis=-1)
    A = basis(xx[m].astype(np.float32), yy[m].astype(np.float32))
    B = rgb[m]
    coef, *_ = np.linalg.lstsq(A, B, rcond=None)
    resid = np.abs(A @ coef - B).max(axis=1)
    if np.percentile(resid, 95) > 0.035:
        return None
    full = basis(xx.astype(np.float32), yy.astype(np.float32)) @ coef
    return np.clip(full, 0, 1).astype(np.float32)


FAST_FLAT_TOP = 40        # jumlah warna dominan (kuantisasi 4-bit) untuk menilai "logo flat"
FAST_FLAT_MIN = 0.88      # fraksi piksel objek yang harus tercakup warna dominan itu
FAST_EDGE_TOUCH = 0.005   # maks. fraksi piksel bingkai tepi yang boleh bukan-latar
FAST_FG_MIN, FAST_FG_MAX = 0.004, 0.85   # luas objek (fraksi gambar) yang masuk akal
FAST_SHADOW_MAX = 0.002   # maks. fraksi gambar berwarna "bayangan"; lebih dari ini -> serahkan ke AI


def flat_score(rgb: np.ndarray, mask: np.ndarray) -> float:
    """Fraksi piksel `mask` yang tercakup FAST_FLAT_TOP warna dominan. Logo flat ~0,9+; foto/gradien objek rendah."""
    px = rgb[mask]
    if px.shape[0] == 0:
        return 0.0
    q = np.clip(px * 15 + 0.5, 0, 15).astype(np.int32)
    counts = np.bincount(q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2], minlength=4096)
    return float(np.sort(counts)[::-1][:FAST_FLAT_TOP].sum() / px.shape[0])


def refine(rgb_u8: np.ndarray, ai_alpha_u8: np.ndarray | None = None):
    """rgb_u8: HxWx3, ai_alpha_u8: HxW atau None. Return (rgba_u8, info:str).

    ai_alpha_u8=None -> mode cepat tanpa AI: dipakai HANYA bila gambar jelas logo flat (latar 1-4 warna
    atau gradien halus, objek tidak menyentuh tepi, warna objek sedikit). Selain itu mengembalikan
    (None, "ai-perlu-...") dan pemanggil menjalankan model AI."""
    rgb = rgb_u8.astype(np.float32) / 255.0
    h, w, _ = rgb.shape
    fast = ai_alpha_u8 is None
    pal = border_palette(rgb)
    if pal is not None:
        # jarak ke palet & warna palet terdekat per piksel
        # per warna palet (hemat memori: tanpa array HxWxKx3)
        dist = np.full(rgb.shape[:2], np.inf, dtype=np.float32)
        idx = np.zeros(rgb.shape[:2], dtype=np.uint8)
        for k, pc in enumerate(pal):
            d = np.abs(rgb - pc).max(axis=2)
            better = d < dist
            dist[better] = d[better]
            idx[better] = k
        P = pal[idx]                                                      # HxWx3
        kind = f"warna-{len(pal)}"
    else:
        P = gradient_background(rgb)
        if P is None:
            return None, "lewati-latar-kompleks"
        dist = np.abs(rgb - P).max(axis=2)
        kind = "gradien"
    near = dist < NEAR

    # bayangan: rasio piksel/latar seragam antar-kanal, cukup terang, gradien lembut
    ratio = rgb / np.maximum(P, 1e-3)
    m = ratio.mean(axis=2)
    dev = np.abs(ratio - m[..., None]).max(axis=2)
    lum = cv2.GaussianBlur(rgb.mean(axis=2), (0, 0), 1.2)
    grad = np.hypot(cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3)) / 4
    shadow = (P.mean(axis=2) > 0.5) & (m >= SHADOW_MIN) & (m <= 1.02) & (dev < SHADOW_DEV) & (grad < SHADOW_GRAD)
    if fast and (shadow & ~near).mean() > FAST_SHADOW_MAX:
        # ada bayangan: memisahkannya dari objek butuh suara AI (tanpa AI tersisa abu-abu di sekitar huruf)
        return None, "ai-perlu-bayangan"
    cand = (near | shadow).astype(np.uint8)

    # region growing dari tepi
    n, lab = cv2.connectedComponents(cand, connectivity=4)
    edge_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge_labels = edge_labels[edge_labels != 0]
    reachable = np.isin(lab, edge_labels)

    nonbg = ~reachable
    ys, xs = np.nonzero(nonbg)
    if len(ys) == 0:
        return None, "lewati-gagal"
    if fast:
        # pengaman mode cepat: objek tidak boleh menyentuh tepi (latar & objek berwarna sama tak terpisahkan
        # tanpa AI), luasnya masuk akal, dan warnanya sedikit (bukan foto)
        frame = np.concatenate([nonbg[0], nonbg[-1], nonbg[:, 0], nonbg[:, -1]])
        if frame.mean() > FAST_EDGE_TOUCH:
            return None, "ai-perlu-objek-di-tepi"
        if not (FAST_FG_MIN <= nonbg.mean() <= FAST_FG_MAX):
            return None, "ai-perlu-luas-objek"
        if flat_score(rgb, nonbg & ~near) < FAST_FLAT_MIN:
            return None, "ai-perlu-warna-kompleks"
        # pengganti suara AI: piksel yang jelas bukan latar & bukan bayangan = objek
        ai = (~(near | shadow)).astype(np.float32)
        ai_alpha_u8 = (ai * 255).astype(np.uint8)
    else:
        ai = ai_alpha_u8.astype(np.float32) / 255.0
    fg_span = max(ys.max() - ys.min(), xs.max() - xs.min()) + 1
    fg_area = int(nonbg.sum())

    # lubang tertutup berwarna latar. Dipertahankan (bagian logo, mis. siluet/bingkai putih) bila
    # cukup besar relatif terhadap logo ATAU AI menganggapnya objek; selain itu dibuang
    # (bagian dalam huruf A, O, &).
    holes = (near & nonbg).astype(np.uint8)
    hn, hlab, stats, _ = cv2.connectedComponentsWithStats(holes, connectivity=4)
    drop = np.zeros(hn, dtype=bool)
    if hn > 1:
        ai_mean = np.bincount(hlab.ravel(), weights=ai.ravel(), minlength=hn) / np.maximum(stats[:, cv2.CC_STAT_AREA], 1)
        span = np.maximum(stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT])
        big = (stats[:, cv2.CC_STAT_AREA] >= HOLE_MIN * fg_area) & (span >= 0.10 * fg_span)
        drop = ~big & (ai_mean < 0.5)
        if fast:
            # tanpa suara AI: celah 1-8 piksel di tengah garis putih tipis bukan bagian dalam huruf; kalau
            # dibuang, estimasi alpha tepi ikut menipiskan garis di sekitarnya (bintik transparan)
            tiny = stats[:, cv2.CC_STAT_AREA] <= max(4, round(8 * (max(h, w) / 1024) ** 2))
            drop &= ~tiny
        drop[0] = False
    small_holes = drop[hlab]

    # sisa bayangan yang terjepit (mis. di antara huruf): warna bayangan + AI bilang latar
    shadow_color = (P.mean(axis=2) > 0.5) & (m >= SHADOW_MIN) & (m <= 1.02) & (dev < SHADOW_DEV) & ~near
    # (piksel anti-alias di sekitar area putih yang dipertahankan juga abu-abu netral: lindungi)
    kept = (hlab > 0) & ~drop[hlab]
    protect = cv2.dilate(kept.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    # Pengaman: (a) hanya di dekat objek yang dikenali AI - bayangan selalu menempel pada objek;
    # bila AI tidak melihat objek (mis. teks tipis di latar bermotif), suaranya tidak dipakai.
    # (b) hanya piksel bergradasi lembut - tepi anti-alias huruf yang tajam bukan bayangan.
    ai_near = cv2.dilate((ai > 0.5).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    shadow_left = nonbg & shadow_color & (ai < 0.5) & ~protect & ai_near & (grad < SHADOW_GRAD * 2.5)
    if fast:
        # gambar berbayangan sudah ditolak di atas; piksel "mirip bayangan" yang tersisa adalah tepi
        # anti-alias objek (mis. pinggir garis putih tipis), jadi jangan dibuang
        shadow_left[:] = False

    bg = reachable | small_holes | shadow_left
    fg = ~bg

    # pemeriksaan keamanan terhadap masker AI
    ai_fg = int((ai_alpha_u8 > 127).sum())
    color_fg = int(fg.sum())
    if color_fg == 0 or color_fg > 0.97 * h * w:
        return None, "lewati-gagal"
    if ai_fg > 0 and color_fg < 0.6 * ai_fg:
        return None, "lewati-bocor"   # objek berwarna latar menyentuh tepi -> percayai AI

    # alpha halus di tepi: perbandingan jarak piksel thd jarak maksimum lokal (estimasi warna objek)
    alpha = fg.astype(np.float32)
    band = cv2.dilate(bg.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2).astype(bool) & fg
    local_max = cv2.dilate(dist, np.ones((5, 5), np.uint8))
    est = np.clip(dist / np.maximum(local_max, 1e-3), 0, 1)
    est = np.where(local_max < 0.15, 1.0, est)   # objek berwarna mirip latar: jangan ditipiskan
    alpha[band] = np.maximum(est[band], 0.0)
    # tepi yang berbatasan dengan bayangan: rapatkan sedikit (buang rim abu-abu tipis)
    sh_edge = cv2.dilate(((reachable & shadow & ~near) | shadow_left).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    alpha[sh_edge & band & (grad < SHADOW_GRAD * 2)] = 0

    # bersihkan warna tepi dari campuran latar: F = P + (C - P) / a
    a3 = np.maximum(alpha, 1e-3)[..., None]
    clean = np.clip(P + (rgb - P) / a3, 0, 1)
    out_rgb = np.where((alpha > 0)[..., None] & (alpha < 0.999)[..., None], clean, rgb)

    rgba = np.dstack([out_rgb, alpha])
    return (rgba * 255 + 0.5).astype(np.uint8), kind + ("-cepat" if fast else "")
