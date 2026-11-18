"""
Image worker: layanan AI ringan yang dipanggil oleh PHP lewat HTTP localhost.

Endpoint:
  GET  /health                 -> status + model yang tersedia
  POST /remove-bg  (file, model?)            -> PNG RGBA (background transparan)
  POST /enhance    (file, mode?, target?)    -> PNG (di-upscale/diperbaiki bila perlu)

Header respons:
  X-Enhanced: 1|0, X-Sharpness: <float>, X-Reason: <teks>

Semua model dimuat sekali (lazy) lalu di-cache di memori.
"""
from __future__ import annotations

import io
import os
import threading
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageFilter, ImageOps

BASE = Path(__file__).resolve().parent
MODELS_DIR = BASE / "models"
os.environ.setdefault("U2NET_HOME", str(MODELS_DIR / "rembg"))

from rembg import new_session, remove  # noqa: E402  (setelah U2NET_HOME diset)

from refine import refine as logo_refine  # noqa: E402

def _default_threads() -> int:
    # = jumlah core yang boleh dipakai proses ini (menghormati batas cgroup/taskset), maks. 4.
    # Server 2 core -> 2 thread. Lebih banyak thread dari core justru memperlambat.
    try:
        n = len(os.sched_getaffinity(0))
    except AttributeError:
        n = os.cpu_count() or 2
    return max(1, min(4, n))


THREADS = int(os.getenv("WORKER_THREADS") or _default_threads())
MAX_CONCURRENT = int(os.getenv("WORKER_MAX_CONCURRENT", "1"))
DEFAULT_BG_MODEL = os.getenv("BG_MODEL", "isnet-general-use")
SHARPNESS_THRESHOLD = float(os.getenv("SHARPNESS_THRESHOLD", "35"))
MAX_PIXELS = int(os.getenv("MAX_PIXELS", str(30_000_000)))
BG_MAX_SIDE = int(os.getenv("BG_MAX_SIDE", "1600"))  # input remove-bg diperkecil ke sini dulu
SR_MODEL_PATH = MODELS_DIR / "realesr-general-x4v3.onnx"
SR_TILE = int(os.getenv("SR_TILE", "384"))
SR_TILE_PAD = 16
# Server kecil: input model dibatasi (biaya ~ kuadrat ukuran: 256px ±1,3 dtk, 512px ±6,8 dtk di 2 core)
SR_MAX_INPUT = int(os.getenv("SR_MAX_INPUT", "512"))
SR_ALPHA_MODEL_MAX = int(os.getenv("SR_ALPHA_MODEL_MAX", "384"))   # alpha lewat model hanya bila input <= ini
LANCZOS_MAX_FACTOR = float(os.getenv("LANCZOS_MAX_FACTOR", "1.6"))  # kenaikan kecil & tajam: cukup Lanczos

# Hanya model berlisensi bebas-komersial (bria-rmbg sengaja tidak dimasukkan: CC BY-NC).
ALLOWED_BG_MODELS = {
    "isnet-general-use",      # Apache-2.0, default: cepat & hemat RAM (~1-2GB)
    "birefnet-general-lite",  # MIT, tepi lebih halus, RAM besar (bisa >6GB di CPU) - butuh server besar/GPU
    "birefnet-general",       # MIT, kualitas terbaik, paling berat
    "u2net",                  # Apache-2.0, tercepat, kualitas terendah
}

Image.MAX_IMAGE_PIXELS = MAX_PIXELS

app = FastAPI(title="image-worker")
_gate = threading.Semaphore(MAX_CONCURRENT)
_lock = threading.Lock()
_bg_sessions: dict[str, object] = {}
_sr_session: ort.InferenceSession | None = None


def _sess_opts() -> ort.SessionOptions:
    o = ort.SessionOptions()
    o.intra_op_num_threads = THREADS
    o.inter_op_num_threads = 1
    o.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    # arena memori ORT menahan RAM puncak selamanya; matikan agar worker kembali ramping
    o.enable_cpu_mem_arena = False
    o.enable_mem_pattern = False
    return o


def _providers() -> list[str]:
    """CUDA bila ada (server GPU), selain itu CPU."""
    avail = ort.get_available_providers()
    return [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in avail]


def _provider_names() -> list[str]:
    return _providers()


def _session(path) -> ort.InferenceSession:
    """Buat sesi ONNX; bila provider akselerasi gagal dimuat, ulangi dengan CPU saja."""
    try:
        return ort.InferenceSession(str(path), _sess_opts(), providers=_providers())
    except Exception:
        return ort.InferenceSession(str(path), _sess_opts(), providers=["CPUExecutionProvider"])


def bg_session(model: str):
    with _lock:
        if model not in _bg_sessions:
            try:
                _bg_sessions[model] = new_session(model, sess_opts=_sess_opts(), providers=_providers())
            except Exception:
                _bg_sessions[model] = new_session(model, sess_opts=_sess_opts(), providers=["CPUExecutionProvider"])
        return _bg_sessions[model]


def sr_session() -> ort.InferenceSession:
    global _sr_session
    with _lock:
        if _sr_session is None:
            if not SR_MODEL_PATH.exists():
                raise HTTPException(500, f"Model enhance tidak ditemukan: {SR_MODEL_PATH.name}")
            _sr_session = _session(SR_MODEL_PATH)
        return _sr_session


async def read_image(file: UploadFile) -> Image.Image:
    data = await file.read()
    if not data:
        raise HTTPException(400, "File kosong")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Image.DecompressionBombError:
        raise HTTPException(413, "Resolusi gambar terlalu besar")
    except Exception:
        raise HTTPException(400, "File bukan gambar yang valid")
    img = ImageOps.exif_transpose(img)  # hormati orientasi EXIF dari kamera/HP
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if ("A" in img.getbands() or "transparency" in img.info) else "RGB")
    return img


def png_response(img: Image.Image, headers: dict[str, str]) -> Response:
    buf = io.BytesIO()
    img.save(buf, "PNG", compress_level=3)
    return Response(buf.getvalue(), media_type="image/png", headers=headers)


# ---------------------------------------------------------------- sharpness

def sharpness(img: Image.Image) -> float:
    """Skor ketajaman 0..100 pada resolusi asli (maks. 1536px).
    Membandingkan energi detail halus (selisih gambar vs versi turun-naik 2x) terhadap energi gradien.
    Gambar buram/hasil upscale kehilangan sedikit sekali informasi saat diturun-naikkan -> skor rendah."""
    g = img.convert("RGBA")
    white = Image.new("RGBA", g.size, (255, 255, 255, 255))
    g = Image.alpha_composite(white, g).convert("L")
    if max(g.size) > 1536:
        g.thumbnail((1536, 1536), Image.LANCZOS)
    w, h = g.size
    if w < 16 or h < 16:
        return 0.0
    a = np.asarray(g, dtype=np.float32)
    small = g.resize((max(1, w // 2), max(1, h // 2)), Image.BOX).resize((w, h), Image.BICUBIC)
    hf = a - np.asarray(small, dtype=np.float32)
    gx = np.abs(np.diff(a, axis=1))[:-1, :]
    gy = np.abs(np.diff(a, axis=0))[:, :-1]
    grad = gx + gy
    edges = grad > 8  # hanya area bertepi; bidang polos logo diabaikan
    if edges.mean() < 0.001:
        return 100.0  # nyaris polos: tidak ada yang bisa dipertajam
    ratio = np.abs(hf[:-1, :-1][edges]).mean() / (grad[edges].mean() + 1e-6)
    return float(min(100.0, ratio * 200))


# ---------------------------------------------------------------- super resolution

def _sr_run(arr: np.ndarray) -> np.ndarray:
    """arr: HxWx3 float32 [0,1] -> (4H)x(4W)x3 float32, diproses per-tile agar memori stabil."""
    sess = sr_session()
    h, w, _ = arr.shape
    x = np.transpose(arr, (2, 0, 1))[None]
    if h <= SR_TILE and w <= SR_TILE:
        out = sess.run(None, {"input": x})[0][0]
        return np.transpose(out, (1, 2, 0))

    out = np.zeros((3, h * 4, w * 4), dtype=np.float32)
    for y0 in range(0, h, SR_TILE):
        for x0 in range(0, w, SR_TILE):
            y1, x1 = min(y0 + SR_TILE, h), min(x0 + SR_TILE, w)
            py0, px0 = max(y0 - SR_TILE_PAD, 0), max(x0 - SR_TILE_PAD, 0)
            py1, px1 = min(y1 + SR_TILE_PAD, h), min(x1 + SR_TILE_PAD, w)
            tile = sess.run(None, {"input": x[:, :, py0:py1, px0:px1]})[0][0]
            oy, ox = (y0 - py0) * 4, (x0 - px0) * 4
            out[:, y0 * 4:y1 * 4, x0 * 4:x1 * 4] = tile[:, oy:oy + (y1 - y0) * 4, ox:ox + (x1 - x0) * 4]
    return np.transpose(out, (1, 2, 0))


def upscale4(img: Image.Image) -> Image.Image:
    """Upscale 4x dengan Real-ESRGAN. Kanal alpha juga diproses model (lebih tajam dari Lanczos)."""
    has_alpha = img.mode == "RGBA"
    rgba = img.convert("RGBA")
    arr = np.asarray(rgba, dtype=np.float32) / 255.0
    rgb, alpha = arr[..., :3], arr[..., 3]

    if has_alpha:
        # piksel yang 100% transparan isi dengan warna tetangga terdekat (mencegah halo gelap di tepi)
        rgb = _bleed_colors(rgba)
    out_rgb = np.clip(_sr_run(np.ascontiguousarray(rgb)), 0, 1)
    if has_alpha:
        if max(img.size) <= SR_ALPHA_MODEL_MAX:
            a3 = np.repeat(alpha[..., None], 3, axis=2)
            out_a = np.clip(_sr_run(np.ascontiguousarray(a3)).mean(axis=2), 0, 1)
        else:
            # hemat CPU (biaya model 2x): Lanczos + kurva kontras ringan agar tepi tetap tegas
            a_img = Image.fromarray((alpha * 255).astype(np.uint8)).resize(
                (out_rgb.shape[1], out_rgb.shape[0]), Image.LANCZOS)
            out_a = np.clip((np.asarray(a_img, dtype=np.float32) / 255.0 - 0.5) * 1.15 + 0.5, 0, 1)
        out = np.dstack([out_rgb, out_a])
        return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")
    return Image.fromarray((out_rgb * 255 + 0.5).astype(np.uint8), "RGB")


def _bleed_colors(rgba: Image.Image) -> np.ndarray:
    """Ganti warna piksel transparan dengan warna rata-rata objek yang di-blur, agar model tidak
    menarik warna 'sampah' (biasanya hitam) ke tepi objek."""
    arr = np.asarray(rgba, dtype=np.float32) / 255.0
    a = arr[..., 3:4]
    if a.min() > 0.99:
        return arr[..., :3]
    premul = Image.fromarray((np.dstack([arr[..., :3] * a, a]) * 255).astype(np.uint8), "RGBA")
    blurred = np.asarray(premul.filter(ImageFilter.GaussianBlur(4)), dtype=np.float32) / 255.0
    ba = np.maximum(blurred[..., 3:4], 1e-4)
    fill = np.clip(blurred[..., :3] / ba, 0, 1)
    mask = (a < 0.95)  # tepi semi-transparan juga diisi warna objek -> tanpa cincin/halo
    rgb = np.where(mask, fill, arr[..., :3])
    return rgb.astype(np.float32)


# ---------------------------------------------------------------- endpoints

@app.get("/health")
def health():
    return {
        "ok": True,
        "providers": _provider_names(),
        "threads": THREADS,
        "default_bg_model": DEFAULT_BG_MODEL,
        "bg_models": sorted(ALLOWED_BG_MODELS),
        "sr_model": SR_MODEL_PATH.name if SR_MODEL_PATH.exists() else None,
        "loaded": sorted(_bg_sessions.keys()) + (["sr"] if _sr_session else []),
    }


@app.post("/remove-bg")
async def remove_bg(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_BG_MODEL),
    refine: str = Form("auto"),    # auto: perbaikan khusus logo bila latar sederhana | off
):
    if model not in ALLOWED_BG_MODELS:
        raise HTTPException(400, f"Model tidak dikenal: {model}")
    img = await read_image(file)
    if max(img.size) > BG_MAX_SIDE:
        img.thumbnail((BG_MAX_SIDE, BG_MAX_SIDE), Image.LANCZOS)
    t = time.perf_counter()
    with _gate:
        out = remove(img.convert("RGB"), session=bg_session(model), post_process_mask=False)
    out = out.convert("RGBA")
    # pertahankan transparansi asli bila input sudah punya alpha
    if img.mode == "RGBA":
        orig_a = np.asarray(img.getchannel("A"))
        new_a = np.asarray(out.getchannel("A"))
        out.putalpha(Image.fromarray(np.minimum(orig_a, new_a)))
        refine = "off"
    info = "off"
    if refine == "auto":
        fixed, info = logo_refine(np.asarray(img.convert("RGB")), np.asarray(out.getchannel("A")))
        if fixed is not None:
            out = Image.fromarray(fixed, "RGBA")
    return png_response(out, {"X-Model": model, "X-Refine": info, "X-Time": f"{time.perf_counter() - t:.2f}"})


@app.post("/enhance")
async def enhance(
    file: UploadFile = File(...),
    mode: str = Form("auto"),      # auto | force
    target: int = Form(1024),      # sisi terpanjang minimal yang dibutuhkan output
):
    if mode not in ("auto", "force"):
        raise HTTPException(400, "mode harus auto atau force")
    target = max(64, min(target, 4096))
    img = await read_image(file)
    w, h = img.size
    longest = max(w, h)
    sharp = sharpness(img)
    small = longest < target
    blurry = sharp < SHARPNESS_THRESHOLD

    if mode == "auto" and not small and not blurry:
        return png_response(img, {"X-Enhanced": "0", "X-Sharpness": f"{sharp:.1f}",
                                  "X-Reason": "cukup-besar-dan-tajam"})

    final_longest = max(target, longest)
    factor = final_longest / longest

    # Kenaikan kecil pada gambar tajam (mis. 819 -> 1024): Lanczos + unsharp ringan, hasil hampir sama
    # dengan model tetapi ribuan kali lebih murah - penting di server 2 core.
    if mode == "auto" and small and not blurry and factor < LANCZOS_MAX_FACTOR:
        s = factor
        up = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
        rgb = up.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
        if up.mode == "RGBA":
            rgb.putalpha(up.getchannel("A"))
        return png_response(rgb, {"X-Enhanced": "1", "X-Sharpness": f"{sharp:.1f}", "X-Reason": "lanczos"})

    # Model selalu 4x lalu diperkecil Lanczos ke ukuran akhir. Input dibatasi SR_MAX_INPUT agar biaya
    # tetap terkendali:
    #  - gambar kecil  : input = ukuran asli (maks. SR_MAX_INPUT)
    #  - besar & buram : perkecil dulu (maks. SR_MAX_INPUT), model merekonstruksi detail saat 4x
    in_longest = min(longest if small else max(final_longest // 2, 128), SR_MAX_INPUT)
    src = img
    if in_longest < longest:
        s = in_longest / longest
        src = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)

    t = time.perf_counter()
    with _gate:
        up = upscale4(src)
    # kecilkan hasil 4x ke ukuran akhir dengan Lanczos (hasil lebih bersih daripada 2x/3x langsung)
    uw, uh = up.size
    s = final_longest / max(uw, uh)
    if s < 1:
        up = up.resize((max(1, round(uw * s)), max(1, round(uh * s))), Image.LANCZOS)
    reason = "kecil" if small else "buram"
    if mode == "force":
        reason = "dipaksa"
    return png_response(up, {"X-Enhanced": "1", "X-Sharpness": f"{sharp:.1f}", "X-Reason": reason,
                             "X-Time": f"{time.perf_counter() - t:.2f}"})


@app.exception_handler(HTTPException)
async def http_exc(_, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)
