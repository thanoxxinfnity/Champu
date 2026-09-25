#!/usr/bin/env python3
"""Bake the open-world maps: terrain heights, roads, and where everything goes.

For every map this writes to maps/<id>/:
  height.f32   N×N float32 heights (row = z, x fastest), SPACING metres apart
  meta.json    roads (sampled every 2 m, with heights), placements of every
               TRELLIS asset, colliders, city blocks and buildings, ramps,
               coins, portals, spawn, speed trap and drift zone
  minimap.png  a shaded map for the HUD

    python3 tools/bake_maps.py [map_id ...]

Everything is seeded, so a bake is reproducible. The Godot side
(scripts/map_builder.gd) turns this data into meshes.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SIZE = 2048.0
SPACING = 4.0
N = int(SIZE / SPACING) + 1
HALF = SIZE / 2
STEP = 2.0
XS = np.linspace(-HALF, HALF, N)
GX, GZ = np.meshgrid(XS, XS)  # GX[j, i] = x of column i, GZ[j, i] = z of row j


# ─────────────────────────────── noise ─────────────────────────────────────

def fbm_grid(seed, scale, octaves=6, persistence=0.5, lacunarity=2.0, ridged=False):
    """Fractal value noise over the terrain grid (smooth, deterministic)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((N, N))
    amp, freq, total = 1.0, 1.0 / scale, 0.0
    for _ in range(octaves):
        cells = max(int(SIZE * freq) + 3, 4)
        lattice = rng.standard_normal((cells, cells))
        u = (GX + HALF) * freq
        v = (GZ + HALF) * freq
        n = map_coordinates(lattice, [v, u], order=3, mode="wrap")
        if ridged:
            n = 1.0 - np.abs(n)
            n = n * n
        out += n * amp
        total += amp
        amp *= persistence
        freq *= lacunarity
    return out / total


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def sample_h(h, x, z):
    """Bilinear height at world x, z (arrays)."""
    x = np.asarray(x, dtype=float)
    scalar = x.ndim == 0
    fi = (np.atleast_1d(x) + HALF) / SPACING
    fj = (np.atleast_1d(np.asarray(z, dtype=float)) + HALF) / SPACING
    out = map_coordinates(h, [fj, fi], order=1, mode="nearest")
    return out[0] if scalar else out


# ─────────────────────────────── roads ─────────────────────────────────────

def catmull_loop(ctrl, closed=True):
    pts = np.array(ctrl, dtype=float)
    n = len(pts)
    dense = []
    segs = n if closed else n - 1
    for i in range(segs):
        p0 = pts[(i - 1) % n] if closed or i > 0 else pts[0]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if closed or i + 2 < n else pts[-1]
        steps = max(int(np.linalg.norm(p2 - p1) / 0.5), 4)
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        dense.append(pts[-1])
    return resample(np.array(dense), closed)


def resample(dense, closed):
    if closed:
        dense = np.vstack([dense, dense[:1]])
    seg = np.linalg.norm(np.diff(dense, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    total = cum[-1]
    count = int(total / STEP) if closed else int(total / STEP) + 1
    d = np.arange(count) * STEP
    x = np.interp(d, cum, dense[:, 0])
    z = np.interp(d, cum, dense[:, 1])
    return np.c_[x, z]


def polyline(points, closed=False):
    """Straight segments (city streets), resampled every STEP metres."""
    return resample(np.array(points, dtype=float), closed)


def rounded_rect(x0, z0, x1, z1, r):
    pts = []
    corners = [(x1 - r, z0 + r, -90), (x1 - r, z1 - r, 0), (x0 + r, z1 - r, 90), (x0 + r, z0 + r, 180)]
    for cx, cz, a0 in corners:
        for k in range(9):
            a = math.radians(a0 + k * 90 / 8)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return resample(np.array(pts), True)


def road_profile(h, xz, closed, grade=0.085, smooth_m=90.0, min_h=None):
    """Heights along a road: smoothed terrain with the grade clamped."""
    y = sample_h(h, xz[:, 0], xz[:, 1])
    sigma = smooth_m / STEP
    if closed:
        pad = int(sigma * 4)
        y = gaussian_filter(np.concatenate([y[-pad:], y, y[:pad]]), sigma)[pad:-pad]
    else:
        y = gaussian_filter(y, sigma, mode="nearest")
    if min_h is not None:
        y = np.maximum(y, min_h)
    lim = grade * STEP
    for _ in range(3):
        for i in range(1, len(y)):
            y[i] = np.clip(y[i], y[i - 1] - lim, y[i - 1] + lim)
        for i in range(len(y) - 2, -1, -1):
            y[i] = np.clip(y[i], y[i + 1] - lim, y[i + 1] + lim)
        if closed:
            y = gaussian_filter(np.concatenate([y[-8:], y, y[:8]]), 2)[8:-8]
    return y


def carve(h, roads, flat_extra=6.0, blend=26.0):
    """Flatten the terrain under and beside every road to the road height."""
    pts = np.vstack([np.c_[r["xz"], r["y"]] for r in roads])
    halfs = np.concatenate([np.full(len(r["xz"]), r["half"]) for r in roads])
    tree = cKDTree(pts[:, :2])
    flat = np.c_[GX.ravel(), GZ.ravel()]
    d, i = tree.query(flat, distance_upper_bound=halfs.max() + flat_extra + blend + 10)
    ok = np.isfinite(d)
    road_y = np.full(len(flat), np.nan)
    road_y[ok] = pts[i[ok], 2]
    inner = np.full(len(flat), np.inf)
    inner[ok] = d[ok] - halfs[i[ok]] - flat_extra
    w = 1 - smoothstep(0, blend, inner)
    w[~ok] = 0
    hv = h.ravel()
    target = np.where(ok, road_y - 0.12, hv)
    out = hv * (1 - w) + target * w
    return out.reshape(h.shape), tree, pts


def flatten_rect(h, cx, cz, w, d, yaw, y, blend=20.0):
    c, s = math.cos(yaw), math.sin(yaw)
    lx = (GX - cx) * c - (GZ - cz) * s
    lz = (GX - cx) * s + (GZ - cz) * c
    out = np.maximum(np.abs(lx) - w / 2, np.abs(lz) - d / 2)
    k = 1 - smoothstep(0, blend, out)
    return h * (1 - k) + (y - 0.12) * k


def tangents(xz, closed):
    if closed:
        t = np.roll(xz, -1, 0) - np.roll(xz, 1, 0)
    else:
        t = np.gradient(xz, axis=0)
    return t / (np.linalg.norm(t, axis=1, keepdims=True) + 1e-9)


def curvature(xz, closed):
    t = tangents(xz, closed)
    ang = np.arctan2(t[:, 1], t[:, 0])
    k = np.roll(ang, -3) - np.roll(ang, 3)
    k = (k + np.pi) % (2 * np.pi) - np.pi
    return k / (STEP * 6)


# ─────────────────────────────── placement ─────────────────────────────────

class Placer:
    def __init__(self, seed, h, road_tree, water=None):
        self.rng = np.random.default_rng(seed)
        self.h = h
        self.road_tree = road_tree
        self.water = water
        gy, gx = np.gradient(h, SPACING)
        self.slope = np.sqrt(gx * gx + gy * gy)
        self.instances = {}
        self.colliders = []
        self.boxes = []
        self.taken = {}  # 16 m cell -> [(x, z, r)] keep-out circles
        self.max_r = 1.0

    def keep_out(self, x, z, r):
        self.taken.setdefault((int(x // 16), int(z // 16)), []).append((x, z, r))
        self.max_r = max(self.max_r, r)

    def free(self, x, z, r):
        reach = int((r + self.max_r) // 16) + 1
        cx, cz = int(x // 16), int(z // 16)
        for i in range(cx - reach, cx + reach + 1):
            for j in range(cz - reach, cz + reach + 1):
                for (ox, oz, orr) in self.taken.get((i, j), ()):
                    if (ox - x) ** 2 + (oz - z) ** 2 < (r + orr) ** 2:
                        return False
        return True

    def scatter(self, name, count, density_fn, scale=(0.8, 1.2), road_min=12.0, slope_max=0.6, tries=20,
                collide=None, near_road_collide=70.0, bounds=HALF - 60, avoid=0.0, sink=0.05, sizes=None):
        placed = []
        attempts = 0
        while len(placed) < count and attempts < count * tries:
            attempts += 1
            x, z = self.rng.uniform(-bounds, bounds, 2)
            fi, fj = (x + HALF) / SPACING, (z + HALF) / SPACING
            ii, jj = int(round(fi)), int(round(fj))
            if self.slope[jj, ii] > slope_max:
                continue
            y = float(sample_h(self.h, x, z))
            if self.water is not None and y < self.water + 0.6:
                continue
            if self.rng.random() > density_fn(x, z, y):
                continue
            d, _ = self.road_tree.query([x, z])
            if d < road_min:
                continue
            if avoid > 0 and not self.free(x, z, avoid):
                continue
            s = self.rng.uniform(*scale)
            yaw = self.rng.uniform(0, 2 * math.pi)
            placed.append([round(x, 2), round(y - sink * s, 2), round(z, 2), round(yaw, 3), round(s, 3)])
            if avoid > 0:
                self.keep_out(x, z, avoid)
            if collide and d < near_road_collide:
                r, hh = collide
                self.colliders.append([round(x, 2), round(y, 2), round(z, 2), round(r * s, 2), round(hh * s, 2)])
        self.instances.setdefault(name, []).extend(placed)
        return placed

    def put(self, name, x, z, yaw, s, y=None, box=None):
        if y is None:
            y = float(sample_h(self.h, x, z))
        self.instances.setdefault(name, []).append([round(x, 2), round(y, 2), round(z, 2), round(yaw, 3), round(s, 3)])
        if box:
            bw, bh, bd = box
            self.boxes.append([round(x, 2), round(y + bh / 2, 2), round(z, 2), bw, bh, bd, round(yaw, 3)])


# ─────────────────────────────── map layouts ───────────────────────────────

def branch_road(ctrl, dead_end=False):
    """An open road whose ends (unless dead_end) join the main loop."""
    return dict(ctrl=ctrl, closed=False, half=6.5, kind="branch", dead_end=dead_end)


def edge_mountains(h, height=140.0, start=760.0):
    """Raise the rim of the world into mountains so it ends naturally."""
    r = np.maximum(np.abs(GX), np.abs(GZ))
    ridge = fbm_grid(99, 180, 5, ridged=True)
    k = smoothstep(start, HALF, r)
    return h + k * (height * (0.6 + 0.8 * ridge))


def spawn_plaza(road, idx, side=1.0, offset=48.0, w=64.0, d=44.0):
    """A flat plaza beside the road at sample `idx` for the portals."""
    xz = road["xz"]
    t = tangents(xz, road["closed"])[idx]
    nrm = np.array([t[1], -t[0]]) * side
    c = xz[idx] + nrm * offset
    yaw = math.atan2(t[0], t[1])
    return {"center": [float(c[0]), float(road["y"][idx]), float(c[1])], "size": [w, d], "yaw": yaw,
            "normal": [float(nrm[0]), float(nrm[1])]}


def hills():
    h = fbm_grid(1, 520, 6) * 110 + fbm_grid(2, 160, 5) * 30 + fbm_grid(3, 60, 4) * 5
    h -= np.percentile(h, 4)
    # A lake basin east of centre.
    lake = np.exp(-(((GX - 160) / 230) ** 2 + ((GZ + 40) / 170) ** 2))
    h = h * (1 - lake * 0.97) - lake * 30
    h = edge_mountains(h, 160)
    ctrl = [(-700, -750), (-200, -830), (300, -700), (650, -790), (850, -500), (740, -160), (860, 200),
            (820, 600), (500, 800), (150, 690), (-120, 820), (-450, 760), (-760, 610), (-860, 250),
            (-600, 40), (-780, -250), (-860, -560)]
    branch = [(-200, -830), (-240, -450), (-120, -200), (-160, 150), (0, 400), (150, 690)]
    return dict(h=h, water=-3.0, roads=[dict(xz=catmull_loop(ctrl), closed=True, half=7.0, kind="highway"), branch_road(branch)])


def canyon():
    base = fbm_grid(11, 400, 5) * 18 + fbm_grid(12, 90, 4) * 4
    dunes = np.sin((GX * 0.7 + GZ * 0.3) / 38 + fbm_grid(13, 200, 3) * 6) * 2.5
    m = fbm_grid(14, 260, 5)
    mesa = smoothstep(0.08, 0.2, m) * 60 + smoothstep(0.35, 0.45, m) * 45
    mesa = np.floor(mesa / 9) * 9 + smoothstep(0, 1, (mesa / 9) % 1) * 9  # terraces
    h = base + dunes + mesa
    h = edge_mountains(h, 180, 700)
    ctrl = [(-820, -820), (-300, -760), (200, -850), (700, -760), (830, -420), (500, -250), (150, -380),
            (-150, -150), (0, 150), (400, 100), (780, 250), (800, 650), (450, 830), (0, 700), (-400, 820),
            (-800, 650), (-650, 300), (-850, 0), (-700, -400)]
    branch = [(-300, -760), (-420, -350), (-300, 0), (-430, 400), (-400, 820)]
    return dict(h=h, water=None, roads=[dict(xz=catmull_loop(ctrl), closed=True, half=7.0, kind="highway"), branch_road(branch)])


def frost():
    peak = np.exp(-(((GX + 40) / 330) ** 2 + ((GZ - 60) / 300) ** 2)) * 230
    ridges = fbm_grid(21, 300, 6, ridged=True) * 110
    h = peak + ridges + fbm_grid(22, 120, 4) * 12 - 40
    lake = np.exp(-(((GX - 560) / 150) ** 2 + ((GZ + 520) / 120) ** 2))
    h = h - lake * 40
    h = edge_mountains(h, 220, 700)
    ctrl = [(-800, -700), (-200, -820), (300, -690), (700, -800), (860, -350), (620, -100), (780, 150),
            (520, 300), (720, 520), (450, 720), (100, 850), (-260, 660), (-110, 420), (-420, 320),
            (-330, 60), (-620, -40), (-860, 150), (-860, -330)]
    branch = [(300, -690), (170, -470), (-20, -330), (40, -120), (-40, 40)]
    return dict(h=h, water=-24.0, roads=[dict(xz=catmull_loop(ctrl), closed=True, half=7.0, kind="highway"), branch_road(branch, dead_end=True)])


CITY = 560.0      # city streets from -CITY to CITY
PITCH = 112.0     # street spacing
STREET_HALF = 8.0


def metro():
    h = fbm_grid(31, 380, 5) * 26 + fbm_grid(32, 120, 4) * 6
    # Flat city pad, sea to the east.
    r = np.maximum(np.abs(GX), np.abs(GZ))
    city_k = 1 - smoothstep(CITY + 30, CITY + 170, r)
    h = h * (1 - city_k)
    h = np.maximum(h, 1.0 * (1 - city_k))
    sea = smoothstep(700, 820, GX)
    h = h * (1 - sea) - sea * 14
    rim = np.maximum(np.abs(GX) * (GX < 0), np.abs(GZ))
    h = h + smoothstep(760, HALF, rim) * (120 * (0.6 + 0.8 * fbm_grid(99, 180, 5, ridged=True)))
    roads = []
    hw = [(-820, -830), (0, -870), (620, -840), (720, -500), (730, 0), (720, 500), (600, 840), (0, 870),
          (-640, 840), (-850, 500), (-870, 0), (-850, -500)]
    roads.append(dict(xz=catmull_loop(hw), closed=True, half=7.0, kind="highway", skip_city=True))
    roads.append(dict(xz=rounded_rect(-CITY, -CITY, CITY, CITY, 14), closed=True, half=STREET_HALF, kind="street"))
    for k in range(1, 10):
        c = -CITY + k * PITCH
        roads.append(dict(xz=polyline([(c, -CITY), (c, CITY)]), closed=False, half=STREET_HALF, kind="street"))
        roads.append(dict(xz=polyline([(-CITY, c), (CITY, c)]), closed=False, half=STREET_HALF, kind="street"))
    # Avenues out to the highway.
    for a, b in (((-CITY, 0), (-880, 0)), ((CITY, 0), (740, 0)), ((0, -CITY), (0, -880)), ((0, CITY), (0, 880))):
        roads.append(dict(xz=polyline([a, b]), closed=False, half=7.0, kind="connector"))
    # Inner traffic loops round 3×3 blocks.
    roads.append(dict(xz=rounded_rect(-CITY + PITCH, -CITY + PITCH, -CITY + 4 * PITCH, -CITY + 4 * PITCH, 12), closed=True, half=STREET_HALF, kind="street", overlay=True))
    roads.append(dict(xz=rounded_rect(CITY - 4 * PITCH, CITY - 4 * PITCH, CITY - PITCH, CITY - PITCH, 12), closed=True, half=STREET_HALF, kind="street", overlay=True))
    return dict(h=h, water=-4.0, roads=roads, city=True)


MAPS = {
    "hills": dict(name="Horizon Hills", biome="hills", time="golden", fn=hills, seed=101),
    "metro": dict(name="Neo Metro", biome="city", time="night", fn=metro, seed=202),
    "canyon": dict(name="Red Canyon", biome="desert", time="golden", fn=canyon, seed=303),
    "frost": dict(name="Frost Peak", biome="snow", time="day", fn=frost, seed=404),
}
ORDER = ["hills", "metro", "canyon", "frost"]


# ─────────────────────────────── bake ──────────────────────────────────────

def bake(map_id):
    spec = MAPS[map_id]
    data = spec["fn"]()
    h = data["h"].astype(np.float64)
    water = data["water"]
    roads = data["roads"]
    city = data.get("city", False)
    rng = np.random.default_rng(spec["seed"])

    # Branch roads start and end exactly on the main loop.
    main_xz = roads[0]["xz"]
    for r in roads:
        if r["kind"] == "branch":
            ctrl = [np.array(p, dtype=float) for p in r["ctrl"]]
            ends = [0] if r["dead_end"] else [0, -1]
            for e in ends:
                ctrl[e] = main_xz[np.argmin(np.linalg.norm(main_xz - ctrl[e], axis=1))]
            r["xz"] = catmull_loop(ctrl, closed=False)

    # Road heights (the city sits at 0).
    for r in roads:
        if city and r["kind"] != "highway":
            r["y"] = np.zeros(len(r["xz"]))
            if r["kind"] == "connector":
                d = np.linalg.norm(r["xz"], axis=1, ord=np.inf)
                hw = roads[0]
                hw_y = sample_h(h, r["xz"][:, 0], r["xz"][:, 1])
                r["y"] = hw_y * smoothstep(CITY + 20, CITY + 150, d)
        else:
            r["y"] = road_profile(h, r["xz"], r["closed"], min_h=(water + 2.5) if water is not None else None)
    # Branch ends meet the loop at the loop's height.
    main_tree = cKDTree(main_xz)
    for r in roads:
        if r["kind"] != "branch":
            continue
        d_main, i_main = main_tree.query(r["xz"])
        join = roads[0]["y"][i_main]
        w = 1 - smoothstep(10, 160, d_main)
        r["y"] = r["y"] * (1 - w) + join * w
        lim = 0.085 * STEP
        for _ in range(2):
            for i in range(1, len(r["y"])):
                r["y"][i] = np.clip(r["y"][i], r["y"][i - 1] - lim, r["y"][i - 1] + lim) if d_main[i] > 12 else r["y"][i]
            for i in range(len(r["y"]) - 2, -1, -1):
                r["y"][i] = np.clip(r["y"][i], r["y"][i + 1] - lim, r["y"][i + 1] + lim) if d_main[i] > 12 else r["y"][i]
        r["join_skip"] = (d_main < roads[0]["half"] + 0.6).tolist()
    if city:
        # The highway eases down to street level where it meets the avenues.
        hw = roads[0]
        d = np.linalg.norm(hw["xz"], axis=1, ord=np.inf)
        hw["y"] = np.maximum(hw["y"], 0.0)
        for r in roads:
            if r["kind"] == "connector":
                r["y"] = np.interp(np.linalg.norm(r["xz"], axis=1, ord=np.inf), [CITY, CITY + 140], [0.0, float(np.median(hw["y"][d < 900]) * 0.0)])
        hw["y"] = gaussian_filter(np.concatenate([hw["y"][-40:], hw["y"], hw["y"][:40]]), 12)[40:-40]

    main = roads[0]
    main_t = tangents(main["xz"], True)
    main_k = curvature(main["xz"], True)

    # Spawn and portal plaza on the longest gentle stretch.
    gentle = np.convolve(np.abs(main_k) < 0.004, np.ones(60), "same")
    spawn_i = int(np.argmax(gentle))
    if city:
        spawn_i = int(np.argmin(np.linalg.norm(main["xz"] - np.array([0, -870]), axis=1)))
    side = 1.0
    plaza = spawn_plaza(main, (spawn_i + 30) % len(main["xz"]), side)
    h, road_tree, road_pts = carve(h, roads)
    if city:
        r = np.maximum(np.abs(GX), np.abs(GZ))
        h = np.where(r < CITY + 12, -0.12, h)
        pc = [0.0, 0.0, CITY - 3.5 * PITCH / 1.0]
        plaza = {"center": [PITCH * 0.5 + 0.0, 0.0, -CITY + PITCH * 0.5], "size": [PITCH - 2 * STREET_HALF - 10, PITCH - 2 * STREET_HALF - 10], "yaw": 0.0, "normal": [0.0, 1.0]}
    else:
        h = flatten_rect(h, plaza["center"][0], plaza["center"][2], plaza["size"][0] + 16, plaza["size"][1] + 16, plaza["yaw"], plaza["center"][1])
        # Re-apply the road carve so the plaza blend never lifts the road.
        h, _, _ = carve(h, roads)

    # Speed trap on the straightest stretch away from spawn; drift zone on
    # the twistiest 400 m.
    n = len(main["xz"])
    straight = np.convolve(np.abs(main_k), np.ones(80), "same")
    far = np.abs(((np.arange(n) - spawn_i + n // 2) % n) - n // 2) > 150
    trap_i = int(np.argmin(np.where(far, straight, 1e9)))
    twist = np.convolve(np.abs(main_k), np.ones(200), "same")
    twist_c = int(np.argmax(np.where(far, twist, -1)))
    drift_zone = [int((twist_c - 100) % n), int((twist_c + 100) % n)]

    placer = Placer(spec["seed"], h, road_tree, water)
    placer.keep_out(plaza["center"][0], plaza["center"][2], max(plaza["size"]) * 0.75)

    buildings, blocks, parks = [], [], []
    if city:
        city_layout(placer, rng, buildings, blocks, parks, plaza)

    biome = spec["biome"]
    # Buildings claim their ground first, so queue the vegetation and
    # scatter it after the props below.
    queued = []
    scatter_now = placer.scatter
    placer.scatter = lambda *a, **k: queued.append((a, k))
    if biome == "hills":
        forest = fbm_grid(41, 220, 4)
        fz = lambda x, z: map_coordinates(forest, [[(z + HALF) / SPACING], [(x + HALF) / SPACING]], order=1)[0]
        woods = lambda x, z, y: float(np.clip((fz(x, z) + 0.05) * 4, 0.03, 1))
        placer.scatter("oak", 2600, woods, (7, 13), collide=(0.45, 5), avoid=3.2)
        placer.scatter("pine", 2200, lambda x, z, y: woods(x, z, y) * (1.0 if y > 40 else 0.35), (10, 18), collide=(0.4, 6), avoid=2.8)
        placer.scatter("birch", 1200, woods, (8, 12), collide=(0.35, 5), avoid=2.8)
        placer.scatter("bush", 4200, lambda x, z, y: 0.3 + woods(x, z, y) * 0.7, (1.2, 2.4), road_min=10, avoid=1.4)
        placer.scatter("boulder", 320, lambda x, z, y: 0.7, (1.5, 4.5), slope_max=1.2, collide=(0.5, 1.0), avoid=4, sink=0.2)
        placer.scatter("haybale", 120, lambda x, z, y: 1.0 if fz(x, z) < -0.25 else 0.0, (1.4, 1.7), slope_max=0.2, collide=(0.9, 1.2), avoid=3, sink=0.0)
        props = [("barn", 7, (13, 16), (0.7, 0.62)), ("windmill", 14, (48, 60), (0.08, 0.08)), ("cabin", 4, (7, 8), (0.5, 0.7))]
    elif biome == "desert":
        placer.scatter("cactus", 2200, lambda x, z, y: 0.8, (3.5, 7.5), slope_max=0.35, collide=(0.25, 3), avoid=3)
        placer.scatter("deadtree", 500, lambda x, z, y: 0.7, (5, 9), slope_max=0.4, collide=(0.3, 3), avoid=4)
        placer.scatter("redrock", 420, lambda x, z, y: 0.8, (4, 18), slope_max=0.9, collide=(0.55, 1.0), avoid=10, sink=0.15)
        placer.scatter("bush", 1800, lambda x, z, y: 0.5, (0.8, 1.6), avoid=1.5)
        placer.scatter("boulder", 200, lambda x, z, y: 0.6, (1.5, 3.5), slope_max=1.2, collide=(0.5, 1.0), avoid=4, sink=0.2)
        props = [("gasstation", 3, (16, 18), (0.72, 0.72)), ("windmill", 6, (40, 50), (0.08, 0.08)), ("barn", 2, (12, 14), (0.7, 0.62))]
    elif biome == "snow":
        placer.scatter("snowpine", 6000, lambda x, z, y: 0.95 if y < 170 else 0.25, (9, 18), slope_max=0.8, collide=(0.4, 6), avoid=2.8)
        placer.scatter("pine", 1600, lambda x, z, y: 0.6 if y < 60 else 0.1, (10, 16), slope_max=0.8, collide=(0.4, 6), avoid=2.8)
        placer.scatter("boulder", 420, lambda x, z, y: 0.7, (1.5, 5), slope_max=1.4, collide=(0.5, 1.0), avoid=4, sink=0.2)
        placer.scatter("deadtree", 160, lambda x, z, y: 0.5, (5, 8), collide=(0.3, 3), avoid=4)
        props = [("cabin", 10, (8, 10), (0.5, 0.7))]
    else:  # city outskirts
        out = lambda x, z, m: max(abs(x), abs(z)) > CITY + m
        placer.scatter("palm", 900, lambda x, z, y: 1.0 if out(x, z, 40) else 0.0, (9, 14), collide=(0.35, 5), avoid=4)
        placer.scatter("oak", 900, lambda x, z, y: 1.0 if out(x, z, 60) else 0.0, (7, 11), collide=(0.45, 5), avoid=4)
        placer.scatter("bush", 1800, lambda x, z, y: 1.0 if out(x, z, 30) else 0.0, (1.2, 2.0), avoid=1.5)
        props = [("gasstation", 2, (16, 18), (0.72, 0.72)), ("windmill", 8, (45, 55), (0.08, 0.08))]
    for name, count, sc, fp in props:
        for _ in range(count):
            for _t in range(600):
                x, z = rng.uniform(-HALF + 150, HALF - 150, 2)
                d, ri = road_tree.query([x, z])
                want = (14, 40) if name == "gasstation" else ((14, 90) if name in ("barn", "cabin") else (60, 400))
                if not (want[0] < d < want[1]):
                    continue
                if city and max(abs(x), abs(z)) < CITY + 40:
                    continue
                s = rng.uniform(*sc)
                foot = s * (0.12 if name == "windmill" else 0.9)
                if not placer.free(x, z, foot):
                    continue
                y = float(sample_h(h, x, z))
                if water is not None and y < water + 1:
                    continue
                rad = 1 if name == "windmill" else 2
                gy, gx = np.gradient(h[max(int((z + HALF) / SPACING) - rad, 0):int((z + HALF) / SPACING) + rad + 1,
                                       max(int((x + HALF) / SPACING) - rad, 0):int((x + HALF) / SPACING) + rad + 1], SPACING)
                if np.max(np.hypot(gx, gy)) > (0.5 if name == "windmill" else 0.42):
                    continue
                # Face the road.
                rp = road_pts[ri]
                yaw = math.atan2(rp[0] - x, rp[1] - z)
                ymin = float(np.min(sample_h(h, x + np.array([-1, 1, -1, 1]) * s * 0.4, z + np.array([-1, -1, 1, 1]) * s * 0.4)))
                placer.put(name, x, z, yaw, s, y=ymin - 0.1, box=(fp[0] * s, s * (0.9 if name != "windmill" else 1.0), fp[1] * s))
                placer.keep_out(x, z, foot)
                break

    placer.scatter = scatter_now
    for a, k in queued:
        placer.scatter(*a, **k)

    # Stunt ramps on straights, alternating sides, with a coin arc over each.
    ramps, coins, nitro, rings = [], [], [], []
    if True:
        cand = [i for i in range(0, n, 7) if np.abs(main_k[max(i - 20, 0):i + 40]).max() < 0.003 and far[i]
                and not (city and max(abs(main["xz"][i][0]), abs(main["xz"][i][1])) < CITY + 60)]
        rng.shuffle(cand)
        for i in cand:
            if len(ramps) >= 10:
                break
            if any(min(abs(i - r), n - abs(i - r)) < 200 for r in [q[5] for q in ramps]) or abs(i - trap_i) < 80:
                continue
            t = main_t[i]
            side = -1.0 if len(ramps) % 2 == 0 else 1.0
            left = np.array([-t[1], t[0]]) * side
            p = main["xz"][i] + left * 3.6
            y = float(main["y"][i])
            ramps.append([round(float(p[0]), 2), round(y, 2), round(float(p[1]), 2), round(math.atan2(t[0], t[1]), 3), round(float(main["y"][(i + 4) % n] - main["y"][i]) / 8.0, 4), i])
            ramp_yaw = math.atan2(t[0], t[1])
            for k in range(9):
                j = (i + 8 + k * 3) % n
                q = main["xz"][j] + left * 3.6
                arc = 3.2 + 5.5 * math.sin(math.pi * (k + 1) / 10)
                coins.append([round(float(q[0]), 2), round(float(main["y"][j]) + arc, 2), round(float(q[1]), 2)])
                if k in (2, 5, 8):
                    rings.append([round(float(q[0]), 2), round(float(main["y"][j]) + arc, 2), round(float(q[1]), 2), round(ramp_yaw, 3)])

    # Nitro pads: a full refill, spaced out along every road with a ribbon,
    # clear of the ramps, the speed trap and each other.
    for r in roads:
        if city and r.get("overlay"):
            continue
        m = len(r["xz"])
        rt = tangents(r["xz"], r["closed"])
        is_main = r is roads[0]
        step = 340 if is_main else 260
        start = 120
        for i in range(start, m - (0 if r["closed"] else 60), step):
            if is_main and (any(abs(i - rp[5]) < 60 for rp in ramps) or abs(i - trap_i) < 60):
                continue
            yaw = math.atan2(rt[i][0], rt[i][1])
            nitro.append([round(float(r["xz"][i][0]), 2), round(float(r["y"][i]) + 0.05, 2), round(float(r["xz"][i][1]), 2), round(yaw, 3)])

    # Coin lines along every road with a ribbon, every ~160 m.
    for r in roads:
        if city and r.get("overlay"):
            continue
        m = len(r["xz"])
        rt = tangents(r["xz"], r["closed"])
        for i in range(40, m - (0 if r["closed"] else 20), 80):
            lane = rng.choice([-3.5, 0.0, 3.5])
            for k in range(6):
                j = (i + k * 3) % m if r["closed"] else min(i + k * 3, m - 1)
                s = np.array([-rt[j][1], rt[j][0]])
                q = r["xz"][j] + s * lane
                coins.append([round(float(q[0]), 2), round(float(r["y"][j]) + 1.1, 2), round(float(q[1]), 2)])

    # Treasure rings on hilltops and hidden spots.
    for _ in range(14):
        for _t in range(100):
            x, z = rng.uniform(-HALF + 180, HALF - 180, 2)
            y = float(sample_h(h, x, z))
            if water is not None and y < water + 1:
                continue
            fi, fj = int((x + HALF) / SPACING), int((z + HALF) / SPACING)
            if placer.slope[fj, fi] > 0.3 or road_tree.query([x, z])[0] < 40:
                continue
            if city and max(abs(x), abs(z)) < CITY:
                continue
            for k in range(10):
                a = k / 10 * 2 * math.pi
                cx, cz = x + math.cos(a) * 7, z + math.sin(a) * 7
                coins.append([round(cx, 2), round(float(sample_h(h, cx, cz)) + 1.1, 2), round(cz, 2)])
            coins.append([round(x, 2), round(y + 1.6, 2), round(z, 2), 1])  # big coin
            break

    # Portals to the other maps on the plaza.
    others = [m for m in ORDER if m != map_id]
    pc = np.array(plaza["center"])
    yaw = plaza["yaw"]
    right = np.array([math.cos(yaw), -math.sin(yaw)])
    portals = []
    for k, other in enumerate(others):
        off = (k - 1) * 20.0
        p = np.array([pc[0], pc[2]]) + right * off
        portals.append({"to": other, "name": MAPS[other]["name"], "pos": [round(float(p[0]), 2), float(pc[1]), round(float(p[1]), 2)], "yaw": yaw})

    lamps = []
    if biome in ("city", "hills", "snow", "desert"):
        stride = 24
        for i in range(0, n, stride):
            if city and max(abs(main["xz"][i][0]), abs(main["xz"][i][1])) < CITY + 20:
                continue
            lamps.append(i)

    out_dir = os.path.join(ROOT, "maps", map_id)
    os.makedirs(out_dir, exist_ok=True)
    h.astype("<f4").tofile(os.path.join(out_dir, "height.f32"))

    def road_json(r):
        k = curvature(r["xz"], r["closed"]) if len(r["xz"]) > 8 else np.zeros(len(r["xz"]))
        ribbon = not (city and r["kind"] == "street")
        skip = r.get("join_skip", [])
        if city and r["kind"] == "highway":
            inside = np.max(np.abs(r["xz"]), axis=1) < CITY + 6
            skip = inside.tolist()
        return {"closed": bool(r["closed"]), "half": r["half"], "kind": r["kind"], "ribbon": ribbon,
                "traffic": bool(r["closed"]),
                "x": np.round(r["xz"][:, 0], 2).tolist(), "y": np.round(r["y"], 3).tolist(), "z": np.round(r["xz"][:, 1], 2).tolist(),
                "k": np.round(k, 5).tolist(), "skip": [i for i, s in enumerate(skip) if s]}

    # Height range of every 128 m terrain chunk (for culling bounds).
    cn = int(SIZE / 128)
    step = int(128 / SPACING)
    chunks = [[round(float(h[j * step:(j + 1) * step + 1, i * step:(i + 1) * step + 1].min()), 2),
               round(float(h[j * step:(j + 1) * step + 1, i * step:(i + 1) * step + 1].max()), 2)]
              for j in range(cn) for i in range(cn)]
    meta = {
        "id": map_id, "chunks": chunks, "name": spec["name"], "biome": biome, "time": spec["time"],
        "size": SIZE, "spacing": SPACING, "n": N, "water": water,
        "height_range": [float(h.min()), float(h.max())],
        "roads": [road_json(r) for r in roads],
        "spawn_index": spawn_i, "speed_trap": trap_i, "drift_zone": drift_zone,
        "plaza": plaza, "portals": portals,
        "instances": placer.instances, "colliders": placer.colliders, "boxes": placer.boxes,
        "buildings": buildings, "blocks": blocks, "parks": parks,
        "ramps": [r[:5] for r in ramps], "coins": coins, "nitro": nitro, "rings": rings, "lamps": lamps,
        "city": {"extent": CITY, "pitch": PITCH, "street_half": STREET_HALF} if city else None,
    }
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    minimap(h, water, roads, biome, buildings, os.path.join(out_dir, "minimap.png"))
    counts = {k: len(v) for k, v in placer.instances.items()}
    total_len = sum(len(r["xz"]) * STEP for r in roads)
    print(f"{map_id}: roads {len(roads)} ({total_len / 1000:.1f} km, main {n * STEP / 1000:.1f} km), "
          f"h {h.min():.0f}..{h.max():.0f}, coins {len(coins)}, ramps {len(ramps)}, nitro {len(nitro)}, rings {len(rings)}, buildings {len(buildings)}, {counts}")


def city_layout(placer, rng, buildings, blocks, parks, plaza):
    """Blocks between the streets: towers, parks and car parks."""
    for bi in range(10):
        for bj in range(10):
            x0 = -CITY + bi * PITCH + STREET_HALF
            z0 = -CITY + bj * PITCH + STREET_HALF
            x1 = x0 + PITCH - 2 * STREET_HALF
            z1 = z0 + PITCH - 2 * STREET_HALF
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            is_plaza = abs(cx - plaza["center"][0]) < 1 and abs(cz - plaza["center"][2]) < 1
            centre = 1 - min(math.hypot(cx, cz) / (CITY * 1.1), 1)
            roll = rng.random()
            kind = "plaza" if is_plaza else ("park" if roll < 0.12 else ("lot" if roll < 0.2 else "towers"))
            blocks.append([round(x0, 1), round(z0, 1), round(x1, 1), round(z1, 1), kind])
            inner = (x0 + 6, z0 + 6, x1 - 6, z1 - 6)
            if kind == "towers":
                # Split the block into 1-4 lots.
                splits = rng.choice([1, 2, 2, 4])
                lots = [inner]
                if splits >= 2:
                    mz = (inner[1] + inner[3]) / 2
                    lots = [(inner[0], inner[1], inner[2], mz - 2), (inner[0], mz + 2, inner[2], inner[3])]
                if splits == 4:
                    lots = [(a, b, (a + c) / 2 - 2, d) for a, b, c, d in lots] + [((a + c) / 2 + 2, b, c, d) for a, b, c, d in lots]
                for (a, b, c, d) in lots:
                    w, dd = c - a, d - b
                    hgt = float(12 + rng.gamma(2.0, 1.0) * 16 * (0.4 + centre * 1.6))
                    hgt = min(hgt, 240)
                    style = int(rng.integers(0, 4))
                    buildings.append([round((a + c) / 2, 2), round((b + d) / 2, 2), round(w, 2), round(dd, 2), round(hgt, 1), style, int(rng.integers(0, 99999))])
                    placer.keep_out((a + c) / 2, (b + d) / 2, max(w, dd) * 0.72)
            elif kind in ("park", "plaza"):
                parks.append([round(x0, 1), round(z0, 1), round(x1, 1), round(z1, 1)])
                if kind == "park":
                    placer.put("fountain", cx, cz, 0.0, 9.0, y=0.05, box=(9 * 1.9, 3.0, 9 * 1.9))
                    for k in range(10):
                        a = k / 10 * 2 * math.pi
                        placer.put("palm" if k % 2 else "oak", cx + math.cos(a) * 30, cz + math.sin(a) * 30, rng.uniform(0, 6.28), rng.uniform(8, 11), y=0.05)
                        placer.colliders.append([round(cx + math.cos(a) * 30, 2), 0.0, round(cz + math.sin(a) * 30, 2), 0.35, 5.0])
                    for k in range(4):
                        a = k / 4 * 2 * math.pi + 0.4
                        placer.put("bench", cx + math.cos(a) * 16, cz + math.sin(a) * 16, a + math.pi / 2, 1.8, y=0.18)
            else:
                # Car park: rows of parked TRELLIS cars with colliders.
                for row in range(3):
                    for col in range(8):
                        if rng.random() < 0.35:
                            continue
                        x = inner[0] + 6 + col * ((inner[2] - inner[0] - 12) / 7)
                        z = inner[1] + 12 + row * ((inner[3] - inner[1] - 24) / 2)
                        car = str(rng.choice(["sedan", "suv", "truck"]))
                        sc = {"sedan": 1.45, "suv": 1.75, "truck": 1.9}[car]
                        fp = {"sedan": (1.35, 3.25), "suv": (1.18, 2.58), "truck": (1.22, 2.25)}[car]
                        yaw = 0.0 if row % 2 == 0 else math.pi
                        placer.put(car, x, z, yaw + rng.uniform(-0.05, 0.05), sc, y=0.05, box=(fp[0] * sc, sc * 0.95, fp[1] * sc))
            # Street furniture along the block edge.
            if kind != "plaza":
                for side in range(4):
                    if rng.random() < 0.45:
                        continue
                    t = rng.uniform(0.2, 0.8)
                    pts = [(x0 + (x1 - x0) * t, z0 + 2.5, 0.0), (x1 - 2.5, z0 + (z1 - z0) * t, -math.pi / 2),
                           (x0 + (x1 - x0) * t, z1 - 2.5, math.pi), (x0 + 2.5, z0 + (z1 - z0) * t, math.pi / 2)]
                    x, z, yaw = pts[side]
                    prop = str(rng.choice(["busstop", "kiosk", "bench", "billboard"]))
                    sc = {"busstop": 3.2, "kiosk": 3.4, "bench": 1.8, "billboard": 9.0}[prop]
                    fp = {"busstop": (1.76, 0.9), "kiosk": (1.0, 1.26), "bench": (1.73, 0.85), "billboard": (0.37, 0.37)}[prop]
                    placer.put(prop, x, z, yaw + math.pi, sc, y=0.18, box=(fp[0] * sc, sc * 0.9, fp[1] * sc) if prop != "bench" else None)


def minimap(h, water, roads, biome, buildings, path):
    size = 512
    idx = np.linspace(0, N - 1, size)
    hh = map_coordinates(h, np.meshgrid(idx, idx, indexing="ij"), order=1)
    gy, gx = np.gradient(hh, SIZE / size)
    shade = np.clip(0.75 + (-gx * 0.7 - gy * 0.7) * 1.2, 0.35, 1.25)
    base = {"hills": (0.24, 0.36, 0.16), "desert": (0.62, 0.42, 0.26), "snow": (0.78, 0.82, 0.88), "city": (0.26, 0.34, 0.2)}[biome]
    img = np.ones((size, size, 3)) * np.array(base)
    hn = (hh - hh.min()) / (hh.max() - hh.min() + 1e-6)
    img *= (0.8 + 0.4 * hn)[..., None]
    img *= shade[..., None]
    if water is not None:
        wmask = hh < water
        img[wmask] = np.array([0.12, 0.3, 0.45])
    img = np.clip(img * 0.8, 0, 1)
    scale = size / SIZE
    im = Image.fromarray((img * 255).astype(np.uint8))
    from PIL import ImageDraw
    dr = ImageDraw.Draw(im)
    for b in buildings:
        x, z, w, d = b[0], b[1], b[2], b[3]
        dr.rectangle([(x - w / 2 + HALF) * scale, (z - d / 2 + HALF) * scale, (x + w / 2 + HALF) * scale, (z + d / 2 + HALF) * scale], fill=(52, 56, 66))
    for r in roads:
        pts = [((p[0] + HALF) * scale, (p[1] + HALF) * scale) for p in r["xz"][::2]]
        if r["closed"]:
            pts.append(pts[0])
        wdt = 5 if r["kind"] == "highway" else 3
        dr.line(pts, fill=(235, 235, 235), width=wdt, joint="curve")
    im.save(path)


if __name__ == "__main__":
    ids = sys.argv[1:] or ORDER
    for m in ids:
        bake(m)
