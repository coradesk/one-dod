"""
Benchmark worker di server ini (CPU). Pakai:  .venv/bin/python tools/bench.py [gambar.png]
Mengukur waktu & puncak memori tiap tahap dengan jumlah thread yang akan dipakai worker.
"""
import os
import resource
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from PIL import Image  # noqa: E402

import app  # noqa: E402

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "remove-bg-2-shadow.png")
img = Image.open(path).convert("RGB")
print(f"gambar {img.size}, thread {app.THREADS}, provider {app._provider_names()}")


def run(name, fn, n=2):
    fn()
    t = time.perf_counter()
    for _ in range(n):
        fn()
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024
    print(f"  {name:<28} {(time.perf_counter() - t) / n:6.2f} dtk   (puncak RSS {rss} MB)")


run("hapus background (ISNet)", lambda: app.remove(img, session=app.bg_session("isnet-general-use")))
small = img.copy()
small.thumbnail((256, 256))
run("enhance 4x dari 256px", lambda: app.upscale4(small))
mid = img.copy()
mid.thumbnail((512, 512))
run("enhance 4x dari 512px", lambda: app.upscale4(mid), 1)
