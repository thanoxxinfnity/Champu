#!/usr/bin/env python3
"""Turn raw TRELLIS .glb files into game-ready LOD meshes.

TRELLIS gives one ~40k-triangle mesh with a fragmented UV atlas, so a plain
simplifier stalls at the UV seams. For every asset this script

1. samples the texture at each vertex and welds the seams, giving one
   connected mesh coloured per vertex;
2. simplifies it with gltfpack (meshoptimizer) into a NEAR and a FAR LOD;
3. stands it on the ground (base at y=0, centred), scales it to 1 m tall,
   recomputes smooth normals and bakes a cheap ambient-occlusion term into
   the vertex colours;
4. for props that are seen up close (TEXTURED), also writes a lightly
   simplified NEAR mesh that keeps the UVs and a 1024 px texture.

    python3 tools/prep_trellis.py <raw_dir> <out_dir> [name ...]

Needs numpy, Pillow and `npx gltfpack@0.22`.
"""
import io
import json
import os
import struct
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

NEAR_TRIS = 3200
FAR_TRIS = 420
TEXTURED = {"barn", "busstop", "kiosk", "fountain", "billboard", "bench", "sedan", "suv", "truck",
            "cabin", "windmill", "gasstation"}
TEXTURED_TRIS = 9000
# Standing plants: TRELLIS often stands these on a round ground plate.
PLANTS = {"oak", "pine", "birch", "palm", "deadtree", "cactus", "snowpine"}


# ─────────────────────────────── glb io ────────────────────────────────────

def read_glb(path):
    b = open(path, "rb").read()
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bin_chunk = b""
    if off < len(b):
        bl = struct.unpack("<I", b[off:off + 4])[0]
        bin_chunk = b[off + 8:off + 8 + bl]
    return j, bin_chunk


def accessor(j, blob, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a["componentType"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0)
    item = np.dtype(dt).itemsize * comps
    if stride and stride != item:
        raw = np.frombuffer(blob, np.uint8, count=stride * a["count"], offset=start).reshape(a["count"], stride)
        arr = raw[:, :item].copy().view(dt).reshape(a["count"], comps)
    else:
        arr = np.frombuffer(blob, dt, count=a["count"] * comps, offset=start).reshape(a["count"], comps)
    if a.get("normalized"):
        return arr.astype(np.float64) / float(np.iinfo(dt).max)
    return arr.astype(np.float64 if dt == np.float32 else np.int64)


def node_matrix(n):
    if "matrix" in n:
        return np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    t = n.get("translation", [0, 0, 0])
    r = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    x, y, z, w = r
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m[:3, :3] = rot * np.array(s)
    m[:3, 3] = t
    return m


def load_mesh(path):
    """All triangles of the first mesh, in world space: pos, uv, idx, image."""
    j, blob = read_glb(path)
    mats = {}

    def walk(ni, parent):
        n = j["nodes"][ni]
        m = parent @ node_matrix(n)
        if "mesh" in n and n["mesh"] not in mats:
            mats[n["mesh"]] = m
        for c in n.get("children", []):
            walk(c, m)

    for root in j["scenes"][j.get("scene", 0)]["nodes"]:
        walk(root, np.eye(4))
    mesh_i = next(iter(mats))
    prim = j["meshes"][mesh_i]["primitives"][0]
    pos = accessor(j, blob, prim["attributes"]["POSITION"])
    pos = (np.c_[pos, np.ones(len(pos))] @ mats[mesh_i].T)[:, :3]
    uv = accessor(j, blob, prim["attributes"]["TEXCOORD_0"]) if "TEXCOORD_0" in prim["attributes"] else None
    col = accessor(j, blob, prim["attributes"]["COLOR_0"]) if "COLOR_0" in prim["attributes"] else None
    idx = accessor(j, blob, prim["indices"]).reshape(-1)
    img = None
    if j.get("images"):
        im = j["images"][0]
        bv = j["bufferViews"][im["bufferView"]]
        data = blob[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        img = Image.open(io.BytesIO(data)).convert("RGB")
    return pos, uv, col, idx, img


def write_glb(path, pos, idx, normal=None, color=None, uv=None, image_bytes=None, name="mesh"):
    """Minimal glTF 2.0 binary: one mesh, one material, optional texture."""
    chunks = []
    views = []
    accs = []

    def add(arr, target, comp_type, typ, minmax=False):
        data = arr.tobytes()
        while len(b"".join(chunks)) % 4:
            chunks.append(b"\0")
        offset = len(b"".join(chunks))
        chunks.append(data)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            view["target"] = target
        views.append(view)
        acc = {"bufferView": len(views) - 1, "componentType": comp_type, "count": len(arr), "type": typ}
        if minmax:
            acc["min"] = arr.min(axis=0).tolist()
            acc["max"] = arr.max(axis=0).tolist()
        accs.append(acc)
        return len(accs) - 1

    attrs = {"POSITION": add(pos.astype(np.float32), 34962, 5126, "VEC3", True)}
    if normal is not None:
        attrs["NORMAL"] = add(normal.astype(np.float32), 34962, 5126, "VEC3")
    if color is not None:
        attrs["COLOR_0"] = add(color.astype(np.float32), 34962, 5126, "VEC4")
    if uv is not None:
        attrs["TEXCOORD_0"] = add(uv.astype(np.float32), 34962, 5126, "VEC2")
    ind = add(idx.astype(np.uint32), 34963, 5125, "SCALAR")
    mat = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 0.9}}
    gl = {
        "asset": {"version": "2.0", "generator": "chomu-horizon prep_trellis"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": name, "mesh": 0}],
        "meshes": [{"name": name, "primitives": [{"attributes": attrs, "indices": ind, "material": 0}]}],
        "materials": [mat],
        "accessors": accs,
        "bufferViews": views,
    }
    if image_bytes is not None:
        while len(b"".join(chunks)) % 4:
            chunks.append(b"\0")
        offset = len(b"".join(chunks))
        chunks.append(image_bytes)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(image_bytes)})
        gl["images"] = [{"bufferView": len(views) - 1, "mimeType": "image/jpeg"}]
        gl["textures"] = [{"source": 0}]
        mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}
    blob = b"".join(chunks)
    while len(blob) % 4:
        blob += b"\0"
    gl["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(gl, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(blob), 0x004E4942) + blob
    open(path, "wb").write(out)


# ─────────────────────────────── processing ────────────────────────────────

def sample(img, uv):
    a = np.asarray(img, dtype=np.float64) / 255.0
    h, w, _ = a.shape
    x = np.clip(uv[:, 0] * (w - 1), 0, w - 1)
    y = np.clip(uv[:, 1] * (h - 1), 0, h - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    top = a[y0, x0] * (1 - fx) + a[y0, x1] * fx
    bot = a[y1, x0] * (1 - fx) + a[y1, x1] * fx
    return top * (1 - fy) + bot * fy


def weld(pos, idx, attr):
    """Merge vertices that share a position; average `attr` over them."""
    key = np.round(pos * 20000).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    n = len(first)
    acc = np.zeros((n, attr.shape[1]))
    np.add.at(acc, inv, attr)
    cnt = np.bincount(inv, minlength=n)[:, None]
    new_idx = inv[idx].reshape(-1, 3)
    keep = (new_idx[:, 0] != new_idx[:, 1]) & (new_idx[:, 1] != new_idx[:, 2]) & (new_idx[:, 0] != new_idx[:, 2])
    return pos[first], new_idx[keep].reshape(-1), acc / cnt


def smooth_normals(pos, idx):
    tri = idx.reshape(-1, 3)
    fn = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
    n = np.zeros_like(pos)
    for k in range(3):
        np.add.at(n, tri[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    ln[ln == 0] = 1
    return n / ln


def ambient_occlusion(pos, nrm):
    """Cheap AO: darker low down and deep inside the silhouette."""
    y = pos[:, 1]
    h = max(y.max(), 1e-6)
    r = np.linalg.norm(pos[:, [0, 2]], axis=1)
    # Radius of the silhouette at each height, from the outermost vertices.
    bins = np.clip((y / h * 24).astype(int), 0, 23)
    rmax = np.zeros(24)
    np.maximum.at(rmax, bins, r)
    rmax = np.maximum(rmax, 1e-3)
    depth = 1.0 - np.clip(r / rmax[bins], 0, 1)
    ao = 1.0 - 0.45 * depth ** 1.5
    ao *= 0.72 + 0.28 * np.clip(y / (0.25 * h), 0, 1)
    ao *= 0.9 + 0.1 * np.clip(nrm[:, 1] * 0.5 + 0.5, 0, 1)
    return np.clip(ao, 0.3, 1.0)


def strip_plate(pos, idx):
    """Drop a ground plate: a wide slab at the very bottom under a thin trunk."""
    y = pos[:, 1]
    y0, h = y.min(), y.max() - y.min()
    trunk = pos[(y > y0 + 0.1 * h) & (y < y0 + 0.2 * h)]
    if len(trunk) < 8:
        return idx
    c = np.median(trunk[:, [0, 2]], axis=0)
    trunk_r = np.percentile(np.linalg.norm(trunk[:, [0, 2]] - c, axis=1), 90)
    r = np.linalg.norm(pos[:, [0, 2]] - c, axis=1)
    cut = y0
    for k in range(1, 13):
        band = (y >= y0 + (k - 1) * 0.01 * h) & (y < y0 + k * 0.01 * h)
        if band.sum() < 4 or np.percentile(r[band], 95) < 2.5 * trunk_r:
            break
        cut = y0 + k * 0.01 * h
    if cut == y0:
        return idx
    tri = idx.reshape(-1, 3)
    wide = (pos[tri, 1] <= cut + 0.004 * h).all(axis=1) | ((pos[tri, 1] <= cut + 0.004 * h) & (r[tri] > 2.0 * trunk_r)).any(axis=1)
    return tri[~wide].reshape(-1)


def normalise(pos):
    """Base on y=0, centred on the footprint, 1 unit tall."""
    y0 = pos[:, 1].min()
    h = pos[:, 1].max() - y0
    base = pos[pos[:, 1] < y0 + 0.08 * h]
    cx = (base[:, 0].min() + base[:, 0].max()) * 0.5
    cz = (base[:, 2].min() + base[:, 2].max()) * 0.5
    out = pos - np.array([cx, y0, cz])
    return out / h


def rasterize(pos, idx, col, nrm, axis_u, axis_depth, hu, size=256):
    """Orthographic side view of a vertex-coloured mesh: RGBA image.

    u runs along world axis `axis_u` over [-hu, hu], v over height [1, 0];
    nearer means larger `axis_depth` coordinate.
    """
    img = np.zeros((size, size, 3))
    alpha = np.zeros((size, size))
    zbuf = np.full((size, size), -np.inf)
    u = (pos[:, axis_u] + hu) / (2 * hu) * (size - 1)
    v = (1.0 - pos[:, 1]) * (size - 1)
    z = pos[:, axis_depth]
    light = np.array([0.35, 0.85, 0.4])
    light /= np.linalg.norm(light)
    shade = 0.5 + 0.6 * np.clip(np.abs(nrm @ light), 0, 1)
    c = col[:, :3] * shade[:, None]
    for t in idx.reshape(-1, 3):
        x0, x1 = int(max(np.floor(u[t].min()), 0)), int(min(np.ceil(u[t].max()), size - 1))
        y0, y1 = int(max(np.floor(v[t].min()), 0)), int(min(np.ceil(v[t].max()), size - 1))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, bx, cx), (ay, by, cy) = u[t], v[t]
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-9:
            continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / det
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / det
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not inside.any():
            continue
        depth = w0 * z[t[0]] + w1 * z[t[1]] + w2 * z[t[2]]
        sub = zbuf[y0:y1 + 1, x0:x1 + 1]
        win = inside & (depth > sub)
        if not win.any():
            continue
        sub[win] = depth[win]
        colr = w0[..., None] * c[t[0]] + w1[..., None] * c[t[1]] + w2[..., None] * c[t[2]]
        img[y0:y1 + 1, x0:x1 + 1][win] = colr[win]
        alpha[y0:y1 + 1, x0:x1 + 1][win] = 1.0
    # Bleed colour into the transparent border so mipmaps have no dark fringe.
    filled = alpha > 0
    for _ in range(8):
        grow = np.zeros_like(img)
        cnt = np.zeros(alpha.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(filled, (dy, dx), (0, 1))
            grow += np.roll(img, (dy, dx), (0, 1)) * m[..., None]
            cnt += m
        new = (~filled) & (cnt > 0)
        img[new] = grow[new] / cnt[new][:, None]
        filled = filled | new
    return img, alpha


def impostor(pos, idx, col, nrm, path):
    """Two orthographic views side by side (front: XY, side: ZY)."""
    hx = float(np.abs(pos[:, 0]).max()) * 1.02
    hz = float(np.abs(pos[:, 2]).max()) * 1.02
    a_img, a_alpha = rasterize(pos, idx, col, nrm, 0, 2, hx)
    b_img, b_alpha = rasterize(pos, idx, col, nrm, 2, 0, hz)
    rgb = np.concatenate([a_img, b_img], axis=1)
    al = np.concatenate([a_alpha, b_alpha], axis=1)
    out = np.dstack([np.clip(rgb, 0, 1) ** (1 / 2.2), al])
    Image.fromarray((out * 255).astype(np.uint8), "RGBA").save(path)
    return [round(hx, 4), round(hz, 4)]


def gltfpack(src, dst, ratio, aggressive=False):
    cmd = ["npx", "-y", "gltfpack@0.22", "-i", src, "-o", dst, "-si", f"{ratio:.5f}", "-noq", "-kn"]
    if aggressive:
        cmd.append("-sa")
    subprocess.run(cmd, check=True, capture_output=True)


def finish(pos, idx, col, uv=None, jpeg=None):
    pos = normalise(pos)
    nrm = smooth_normals(pos, idx)
    ao = ambient_occlusion(pos, nrm)
    rgba = np.c_[col[:, :3] * ao[:, None] if col is not None else np.repeat(ao[:, None], 3, 1), ao]
    return pos, nrm, rgba


def process(name, raw_dir, out_dir):
    pos, uv, _, idx, img = load_mesh(os.path.join(raw_dir, name + ".glb"))
    if name in PLANTS:
        idx = strip_plate(pos, idx)
        used = np.unique(idx)
        remap = np.full(len(pos), -1)
        remap[used] = np.arange(len(used))
        pos, uv, idx = pos[used], uv[used] if uv is not None else None, remap[idx]
    tris = len(idx) // 3
    colors = sample(img, uv) if img is not None else np.full((len(pos), 3), 0.6)
    if name in PLANTS or name == "bush":
        # Real foliage has an albedo around 0.1-0.2; TRELLIS textures are often
        # much brighter, which reads as plastic in a sunlit scene.
        lum = colors @ np.array([0.2126, 0.7152, 0.0722])
        mean = float(np.mean(lum))
        if mean > 0.18:
            colors = colors * (0.18 / mean)
    wpos, widx, wcol = weld(pos, idx, colors)
    report = [f"{name}: {tris} tris"]
    imp = None
    with tempfile.TemporaryDirectory() as tmp:
        welded = os.path.join(tmp, "w.glb")
        write_glb(welded, wpos, widx, color=np.c_[wcol, np.ones(len(wcol))])
        wt = len(widx) // 3
        for lod, target in (("near", NEAR_TRIS), ("far", FAR_TRIS)):
            dst = os.path.join(tmp, lod + ".glb")
            ratio = min(1.0, target / wt)
            gltfpack(welded, dst, ratio)
            p, _, c, i, _ = load_mesh(dst)
            if len(i) // 3 > target * 1.6:
                gltfpack(welded, dst, ratio, aggressive=True)
                p, _, c, i, _ = load_mesh(dst)
            p, n, rgba = finish(p, i, c)
            write_glb(os.path.join(out_dir, f"{name}_{lod}.glb"), p, i, normal=n, color=rgba, name=name)
            report.append(f"{lod} {len(i) // 3}")
            if lod == "near" and name in PLANTS:
                imp = impostor(p, i, rgba, n, os.path.join(out_dir, f"{name}_imp.png"))
        if name in TEXTURED and img is not None:
            src = os.path.join(tmp, "src.glb")
            buf = io.BytesIO()
            img.resize((1024, 1024), Image.LANCZOS).save(buf, "JPEG", quality=88)
            # Keep the original vertices (UV seams intact) but drop the texture
            # into a JPEG first, so gltfpack only has to simplify geometry.
            write_glb(src, pos, idx, uv=uv, image_bytes=buf.getvalue())
            dst = os.path.join(tmp, "tex.glb")
            gltfpack(src, dst, min(1.0, TEXTURED_TRIS / tris))
            p, u, _, i, _ = load_mesh(dst)
            # Same normalisation as the vertex-coloured LODs so they line up.
            ref = pos
            y0 = ref[:, 1].min()
            h = ref[:, 1].max() - y0
            base = ref[ref[:, 1] < y0 + 0.08 * h]
            c0 = np.array([(base[:, 0].min() + base[:, 0].max()) * 0.5, y0, (base[:, 2].min() + base[:, 2].max()) * 0.5])
            p = (p - c0) / h
            n = smooth_normals(p, i)
            ao = ambient_occlusion(p, n)
            write_glb(os.path.join(out_dir, f"{name}_tex.glb"), p, i, normal=n, color=np.c_[np.repeat(ao[:, None], 3, 1), ao],
                      uv=u, image_bytes=buf.getvalue(), name=name)
            report.append(f"tex {len(i) // 3}")
    # Footprint and height ratios for placement and collision.
    q = normalise(pos)
    meta = {"width": float(q[:, 0].max() - q[:, 0].min()), "depth": float(q[:, 2].max() - q[:, 2].min()),
            "trunk": float(np.percentile(np.linalg.norm(q[q[:, 1] < 0.15][:, [0, 2]], axis=1), 60)) if (q[:, 1] < 0.15).any() else 0.1}
    if imp:
        meta["imp_x"], meta["imp_z"] = imp
    print("  ".join(report), " ", {k: round(v, 3) for k, v in meta.items()})
    return meta


def main():
    raw_dir, out_dir = sys.argv[1], sys.argv[2]
    names = sys.argv[3:] or sorted(f[:-4] for f in os.listdir(raw_dir) if f.endswith(".glb"))
    os.makedirs(out_dir, exist_ok=True)
    meta_path = os.path.join(out_dir, "meta.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    for n in names:
        meta[n] = process(n, raw_dir, out_dir)
    json.dump(meta, open(meta_path, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
