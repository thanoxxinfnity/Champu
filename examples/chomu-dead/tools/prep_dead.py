#!/usr/bin/env python3
"""Turn raw TRELLIS .glb files into phone-sized game models for Chomu Dead.

A raw TRELLIS model is 6-20k triangles with a 1024 px texture. That is fine for
one prop and far too much for fourteen ghouls on a phone, so every model is

1. read with its original UVs (the texture is what makes the faces and the
   clothes, so it is kept, not baked into vertex colours);
2. re-encoded with a smaller JPEG texture (`TEX_SIZE`);
3. simplified with gltfpack (meshoptimizer) to a per-model triangle budget;
4. given smooth normals, merged across UV seams so there is no visible crease.

Models stay in their own scale and orientation: scripts/assets.gd stands them up
at load time from their bounds, so nothing here needs to know how tall a ghoul is.

    python3 tools/prep_dead.py <raw_dir> <out_dir> [name ...]

Needs numpy, Pillow and `npx gltfpack@0.22`. The reading/writing helpers come from
the Chomu Horizon pipeline, which solved the same problem first.
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

# TRELLIS often stands its subject on a round ground plate; these are drawn on
# the real ground instead, so the plate has to go.
PLATED = {"player", "zombie_walker", "zombie_runner", "zombie_cop", "zombie_nurse", "zombie_bloater", "boss_warden",
          "deadtree", "streetlamp", "tombstone_cross", "tombstone_slab", "doll"}

# name -> (triangle budget, texture px). Anything not listed gets DEFAULT.
DEFAULT = (2200, 512)
BUDGET = {
    "player": (6500, 1024), "zombie_walker": (6500, 1024), "zombie_runner": (6000, 1024),
    "zombie_cop": (6500, 1024), "zombie_nurse": (6000, 1024), "zombie_bloater": (6500, 1024),
    "boss_warden": (9000, 1024),
    "gun_pistol": (2200, 512), "gun_shotgun": (2600, 512), "gun_smg": (2600, 512), "gun_rifle": (2800, 512),
    "medkit": (900, 512), "ammo_box": (900, 512), "barrel": (1200, 512), "crate": (1200, 512), "doll": (1600, 512),
    "wheelchair": (2200, 512), "hospital_bed": (2600, 512), "bodybag": (800, 512),
    "streetlamp": (1500, 512), "barrier": (1200, 512), "sandbags": (1500, 512), "dumpster": (1400, 512),
    "fence": (500, 512), "tombstone_cross": (600, 512), "tombstone_slab": (600, 512), "deadtree": (1600, 512),
    "car_wreck": (4200, 1024), "police_car": (4500, 1024), "ambulance": (4500, 1024), "van": (4200, 1024),
    "helicopter": (5500, 1024),
    "house": (5000, 1024), "clinic": (6000, 1024), "church": (6000, 1024), "gas_station": (5000, 1024),
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
