#!/usr/bin/env python3
"""Turn raw generated .glb files (TRELLIS or Pixal3D) into phone-sized game models for Grinworks.

A raw model is thousands of triangles with a big texture. Every model is read with its original UVs,
re-encoded with a smaller JPEG texture, simplified with gltfpack (meshoptimizer) to a per-model triangle
budget, and given smooth normals merged across UV seams. Models keep their own scale and orientation:
scripts/assets.gd stands them up at load time from their bounds.

    python3 tools/prep_s9.py <raw_dir> <out_dir> [name ...]

Needs numpy, Pillow and `npx gltfpack@0.22`. The reading/writing helpers come from the Chomu Horizon pipeline.
"""

import io
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "chomu-horizon", "tools"))
from prep_trellis import load_mesh, write_glb  # noqa: E402

# A generator sometimes stands its subject on a round ground plate; the station has its own floor, so the
# plate has to go (strip_plate does nothing when there is none).
PLATED = {"teddy", "blocks", "robot_toy", "rocking_horse", "jack_box", "toy_train", "plush_bunny", "toy_drum", "delivery_truck", "doll_house", "xylophone", "gift_box", "toy_shelf", "mascot_head", "mr_grin", "mr_grin_c", "hollow", "diving_suit", "oxygen_tank", "specimen_tank", "valve_wheel", "chair", "fuse", "power_cell", "battery",
          "terminal", "radio", "toolbox", "barrel", "locker", "crate", "breaker_box", "desk", "cart", "gurney", "pipes"}

# name -> (triangle budget, texture px). Anything not listed gets DEFAULT.
DEFAULT = (1800, 512)
BUDGET = {
    "hollow": (7000, 1024), "mr_grin": (6500, 1024), "mr_grin_c": (6500, 1024), "teddy": (3500, 512), "mascot_head": (3500, 512), "delivery_truck": (4000, 1024),
    "keycard": (300, 256), "fuse": (500, 256), "battery": (500, 256), "power_cell": (700, 256), "toolbox": (900, 512),
    "valve_wheel": (1200, 256), "radio": (1500, 512), "oxygen_tank": (900, 512), "barrel": (1100, 512), "crate": (1100, 512),
    "chair": (2200, 512), "terminal": (2200, 512), "locker": (1400, 512), "breaker_box": (1400, 512), "desk": (1800, 512),
    "bunk_bed": (2800, 512), "gurney": (2400, 512), "cart": (2000, 512), "lab_bench": (3000, 512), "specimen_tank": (2000, 512),
    "diving_suit": (5000, 1024), "generator": (4500, 1024), "escape_pod": (3500, 1024), "pipes": (2500, 512), "submarine": (3500, 1024),
}


def strip_plate(pos, idx):
    """Drop a round ground plate under the subject.

    A plate shows up as a bottom band much wider than the legs, trunk or pole
    above it. Every triangle that touches the part of the plate wider than the
    subject goes; the subject's feet are narrower than the cut-off, so they stay.
    """
    y = pos[:, 1]
    y0, h = y.min(), y.max() - y.min()
    r = np.linalg.norm(pos[:, [0, 2]], axis=1)

    def r95(lo, hi):
        m = (y >= y0 + lo * h) & (y < y0 + hi * h)
        return float(np.percentile(r[m], 95)) if m.sum() > 8 else 0.0

    body = max(r95(0.10, 0.20), r95(0.20, 0.30), 1e-4)
    plate = max(r95(0.0, 0.01), r95(0.01, 0.03))
    if plate < 2.2 * body:
        return idx
    tri = idx.reshape(-1, 3)
    # The plate's thickness: the highest band that is still plate-wide (a band
    # can be empty in between, so no early exit).
    cut = 0.0
    for k in range(1, 16):
        if r95((k - 1) * 0.01, k * 0.01) > 1.6 * body:
            cut = k * 0.01
    limit = y0 + (cut + 0.03) * h
    bad = ((r[tri] > 1.3 * body) & (y[tri] < limit)).any(axis=1)
    return tri[~bad].reshape(-1)


# Models whose ground plate is no wider than their stance, so strip_plate cannot tell it from the feet:
# drop everything below this fraction of the height. (The feet float a hair; Assets.make rests the lowest vertex on the floor.)
PLATE_CUT = {}
SLABBED = {"teddy", "blocks", "robot_toy", "rocking_horse", "jack_box", "toy_train", "plush_bunny", "toy_drum", "delivery_truck", "doll_house", "xylophone", "gift_box", "mascot_head", "mr_grin", "mr_grin_c"}


def strip_slab(pos, idx):
    """Drop a flat ground slab: when a thin band near the bottom holds a big share of all the vertices it is a
    plane, not feet. Everything at or below the top of that band goes."""
    y = pos[:, 1]
    y0, h = y.min(), y.max() - y.min()
    if h <= 0:
        return idx
    bins = np.minimum(((y - y0) / h * 100).astype(int), 99)
    counts = np.bincount(bins, minlength=100)
    top = -1
    for k in range(0, 12):
        if counts[k] > 0.045 * len(pos):
            top = k
    if top < 0:
        return idx
    tri = idx.reshape(-1, 3)
    keep = y[tri].max(axis=1) > y0 + (top + 1.5) * 0.01 * h
    return tri[keep].reshape(-1)


def cut_below(pos, idx, frac):
    y = pos[:, 1]
    y0, h = y.min(), y.max() - y.min()
    tri = idx.reshape(-1, 3)
    keep = (y[tri].max(axis=1) >= y0 + frac * h)
    return tri[keep].reshape(-1)


def gltfpack(src, dst, ratio, aggressive=False):
    cmd = ["npx", "-y", "gltfpack@0.22", "-i", src, "-o", dst, "-si", f"{ratio:.5f}", "-noq", "-kn"]
    if aggressive:
        cmd.append("-sa")
    subprocess.run(cmd, check=True, capture_output=True)


def welded_normals(pos, idx):
    """Smooth normals shared by every vertex at the same position, so a UV seam
    does not show as a lighting crease."""
    tri = idx.reshape(-1, 3)
    fn = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
    key = np.round(pos * 10000).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    acc = np.zeros((inv.max() + 1, 3))
    for k in range(3):
        np.add.at(acc, inv[tri[:, k]], fn)
    ln = np.linalg.norm(acc, axis=1, keepdims=True)
    ln[ln == 0] = 1
    return (acc / ln)[inv]


def process(name, raw_dir, out_dir):
    budget, tex = BUDGET.get(name, DEFAULT)
    pos, uv, _, idx, img = load_mesh(os.path.join(raw_dir, name + ".glb"))
    if name in PLATED:
        idx = strip_plate(pos, idx)
    if name in SLABBED:
        idx = strip_slab(pos, idx)
    if name in PLATE_CUT:
        idx = cut_below(pos, idx, PLATE_CUT[name])
    tris = len(idx) // 3
    jpeg = None
    if img is not None:
        buf = io.BytesIO()
        img.resize((tex, tex), Image.LANCZOS).save(buf, "JPEG", quality=86)
        jpeg = buf.getvalue()
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "src.glb")
        dst = os.path.join(tmp, "dst.glb")
        write_glb(src, pos, idx, uv=uv, image_bytes=jpeg)
        ratio = min(1.0, budget / tris)
        gltfpack(src, dst, ratio)
        p, u, _, i, _ = load_mesh(dst)
        if len(i) // 3 > budget * 1.5:
            gltfpack(src, dst, ratio, aggressive=True)
            p, u, _, i, _ = load_mesh(dst)
    n = welded_normals(p, i)
    write_glb(os.path.join(out_dir, name + ".glb"), p, i, normal=n, uv=u, image_bytes=jpeg, name=name)
    size = os.path.getsize(os.path.join(out_dir, name + ".glb")) / 1e6
    print(f"{name:16s} {tris:6d} -> {len(i) // 3:5d} tris   {size:.2f} MB")


def main():
    raw_dir, out_dir = sys.argv[1], sys.argv[2]
    names = sys.argv[3:] or sorted(f[:-4] for f in os.listdir(raw_dir) if f.endswith(".glb"))
    os.makedirs(out_dir, exist_ok=True)
    for n in names:
        try:
            process(n, raw_dir, out_dir)
        except Exception as e:  # keep going: one bad model must not stop the batch
            print(f"{n}: FAILED {e}")


if __name__ == "__main__":
    main()
