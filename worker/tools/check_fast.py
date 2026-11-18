"""
Regresi jalur cepat (tanpa AI) untuk logo flat. Pakai:  .venv/bin/python tools/check_fast.py [folder-gambar]

Untuk tiap gambar (+ varian JPEG 85/60) mencetak keputusan refine(None): "...-cepat" bila dikerjakan tanpa AI,
"ai-perlu-..." / "lewati-..." bila diserahkan ke AI, plus IoU & selisih alpha rata-rata terhadap hasil AI+refine.
Harapan pada 3 gambar contoh di root repo: gradien & kotak-kotak = cepat (IoU ~1,0000); berbayangan = ai-perlu-bayangan.
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import app  # noqa: E402
import refine  # noqa: E402

folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
sess = app.bg_session(app.DEFAULT_BG_MODEL)


def jpeg(im, q):
    b = io.BytesIO()
    im.save(b, "JPEG", quality=q)
    b.seek(0)
    return Image.open(b).convert("RGB")


print(f"{'kasus':40s} {'keputusan':26s} {'IoU':>7s} {'dAlpha':>8s}")
for p in sorted(folder.glob("*.png")) + sorted(folder.glob("*.jpg")):
    base = Image.open(p).convert("RGB")
    for name, im in ((p.name, base), (p.stem + "_jpg85", jpeg(base, 85)), (p.stem + "_jpg60", jpeg(base, 60))):
        rgb = np.asarray(im)
        fx, info = refine.refine(rgb, None)
        if fx is None:
            print(f"{name:40s} {info:26s}")
            continue
        ai = np.asarray(app.remove(im, session=sess, post_process_mask=False).convert("RGBA").getchannel("A"))
        ref, _ = refine.refine(rgb, ai)
        ra = ref[..., 3] if ref is not None else ai
        a, b = fx[..., 3] > 127, ra > 127
        print(f"{name:40s} {info:26s} {(a & b).sum() / max((a | b).sum(), 1):7.4f} "
              f"{np.abs(fx[..., 3].astype(float) - ra.astype(float)).mean():8.3f}")
