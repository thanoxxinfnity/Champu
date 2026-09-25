#!/usr/bin/env python3
"""Procedural, seamlessly tiling ground textures (albedo + normal map).

Noise is shaped in the frequency domain, so every texture tiles perfectly.
    python3 tools/gen_textures.py textures/ground
"""
import os
import sys

import numpy as np
from PIL import Image

N = 2048


def fbm(beta, seed, n=N, lo=1.0, hi=None):
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((n, n)))
    fx = np.fft.fftfreq(n) * n
    r = np.sqrt(fx[None, :] ** 2 + fx[:, None] ** 2)
    r[0, 0] = 1.0
    amp = 1.0 / r ** (beta / 2.0)
    amp[r < lo] = 0.0
    if hi:
        amp *= np.exp(-(r / hi) ** 2)
    x = np.real(np.fft.ifft2(f * amp))
    return (x - x.mean()) / (x.std() + 1e-9)


def unit(x):
    return (x - x.min()) / (x.max() - x.min() + 1e-9)


def ramp(t, stops):
    """Colour ramp: stops = [(pos, (r,g,b)), ...] with t in 0..1."""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,))
    pos = [s[0] for s in stops]
    for c in range(3):
        out[..., c] = np.interp(t, pos, [s[1][c] for s in stops])
    return out


def pebbles(seed, count, rmin, rmax, n=N):
    """Height bumps of round stones, wrapped at the edges."""
    rng = np.random.default_rng(seed)
    h = np.zeros((n, n))
    yy, xx = np.mgrid[0:n, 0:n]
    for _ in range(count):
        cx, cy = rng.uniform(0, n, 2)
        r = rng.uniform(rmin, rmax)
        x0, x1 = int(cx - r - 1), int(cx + r + 2)
        y0, y1 = int(cy - r - 1), int(cy + r + 2)
        ys = np.arange(y0, y1) % n
        xs = np.arange(x0, x1) % n
        dy = (np.arange(y0, y1) - cy)[:, None]
        dx = (np.arange(x0, x1) - cx)[None, :]
        d = np.sqrt(dx * dx + dy * dy) / r
        bump = np.sqrt(np.clip(1 - d * d, 0, 1))
        h[np.ix_(ys, xs)] = np.maximum(h[np.ix_(ys, xs)], bump * rng.uniform(0.5, 1.0))
    return h


def normal_map(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.dstack([-dx, dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def save(out, name, albedo, height, strength):
    Image.fromarray((np.clip(albedo, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(os.path.join(out, name + "_a.jpg"), quality=92)
    Image.fromarray((normal_map(height, strength) * 255).astype(np.uint8)).save(os.path.join(out, name + "_n.jpg"), quality=92)
    print(name)


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)

    # Grass: clumps of lush and dry grass, fine blade speckle.
    clump = unit(fbm(2.4, 1))
    blades = fbm(0.6, 2, lo=40)
    dry = unit(fbm(3.0, 3))
    t = np.clip(clump * 0.7 + blades * 0.08 + 0.15, 0, 1)
    alb = ramp(t, [(0, (0.035, 0.07, 0.02)), (0.5, (0.07, 0.13, 0.03)), (1, (0.14, 0.2, 0.05))])
    alb = alb * (1 - 0.35 * np.clip(dry - 0.55, 0, 1)[..., None] * 2) + np.clip(dry - 0.6, 0, 1)[..., None] * np.array([0.35, 0.28, 0.1])
    alb *= (0.85 + 0.3 * unit(blades))[..., None]
    grit = fbm(0.22, 101, lo=180)
    alb *= (0.88 + 0.22 * unit(grit))[..., None]
    save(out, "grass", alb, blades * 0.6 + clump * 2, 3.2)

    # Rock: ridged layers and cracks.
    ridge = 1 - np.abs(fbm(2.2, 4))
    layers = np.sin(np.linspace(0, 40 * np.pi, N))[:, None] * 0.15 + fbm(2.6, 5) * 0.5
    fine = fbm(1.0, 6, lo=30)
    h = unit(ridge) * 1.5 + layers + fine * 0.25
    t = unit(h + fbm(2.0, 7) * 0.3)
    alb = ramp(t, [(0, (0.12, 0.115, 0.11)), (0.5, (0.27, 0.26, 0.24)), (1, (0.45, 0.43, 0.4))])
    alb *= (0.9 + 0.2 * unit(fine))[..., None]
    grit = fbm(0.22, 102, lo=180)
    alb *= (0.88 + 0.22 * unit(grit))[..., None]
    save(out, "rock", alb, h * 6, 2.6)

    # Red sandstone: horizontal strata.
    y = np.linspace(0, 1, N)[:, None]
    strata = np.sin((y * 18 + fbm(2.8, 8) * 0.08) * 2 * np.pi) * 0.5 + 0.5
    warp = unit(fbm(2.4, 9))
    t = np.clip(strata * 0.55 + warp * 0.45, 0, 1)
    alb = ramp(t, [(0, (0.28, 0.1, 0.05)), (0.45, (0.5, 0.2, 0.09)), (0.8, (0.62, 0.32, 0.16)), (1, (0.7, 0.45, 0.28))])
    alb *= (0.88 + 0.24 * unit(fbm(1.0, 10, lo=30)))[..., None]
    grit = fbm(0.22, 103, lo=180)
    alb *= (0.88 + 0.22 * unit(grit))[..., None]
    save(out, "redrock", alb, strata * 3 + warp * 4 + fine * 0.3, 2.6)

    # Dirt with pebbles.
    peb = pebbles(11, 900, 2, 7)
    base = unit(fbm(2.2, 12))
    t = np.clip(base * 0.8 + peb * 0.35, 0, 1)
    alb = ramp(t, [(0, (0.1, 0.07, 0.045)), (0.6, (0.2, 0.15, 0.1)), (1, (0.33, 0.29, 0.24))])
    alb *= (0.85 + 0.3 * unit(fbm(0.8, 13, lo=40)))[..., None]
    grit = fbm(0.22, 104, lo=180)
    alb *= (0.88 + 0.22 * unit(grit))[..., None]
    save(out, "dirt", alb, peb * 3 + base * 2, 3.0)

    # Sand: soft ripples.
    x = np.linspace(0, 1, N)[None, :]
    ripple = np.sin((x * 28 + y * 6 + fbm(2.6, 14) * 0.12) * 2 * np.pi)
    grain = fbm(0.4, 15, lo=60)
    t = unit(fbm(2.4, 16)) * 0.85 + 0.15 * (ripple * 0.5 + 0.5)
    alb = ramp(t, [(0, (0.46, 0.3, 0.17)), (1, (0.66, 0.47, 0.3))])
    alb *= (0.93 + 0.14 * unit(grain))[..., None]
    grit = fbm(0.22, 105, lo=180)
    alb *= (0.88 + 0.22 * unit(grit))[..., None]
    save(out, "sand", alb, ripple * 0.6 + grain * 0.2, 1.9)

    # Snow: bright, blue in the hollows, sparkle.
    drift = unit(fbm(2.6, 17))
    sparkle = (fbm(0.2, 18, lo=100) > 2.6).astype(float)
    alb = ramp(drift, [(0, (0.6, 0.66, 0.75)), (1, (0.86, 0.88, 0.92))]) + sparkle[..., None] * 0.08
    grit = fbm(0.22, 106, lo=180)
    alb *= (0.88 + 0.22 * unit(grit))[..., None]
    save(out, "snow", alb, drift * 3 + fbm(1.2, 19, lo=20) * 0.2, 1.9)

    # Asphalt: fine aggregate, a few darker patches and tar lines.
    agg = fbm(0.3, 20, lo=80)
    patch = unit(fbm(2.8, 21))
    stones = (fbm(0.2, 22, lo=150) > 1.9).astype(float)
    t = np.clip(0.45 + agg * 0.12 + stones * 0.25 - (patch > 0.7) * 0.12, 0, 1)
    alb = ramp(t, [(0, (0.025, 0.025, 0.027)), (0.5, (0.075, 0.075, 0.08)), (1, (0.2, 0.2, 0.2))])
    grit = fbm(0.22, 107, lo=180)
    alb *= (0.88 + 0.22 * unit(grit))[..., None]
    save(out, "asphalt", alb, agg * 0.5 + stones * 0.8, 2.8)

    # City pavement tiles.
    yy, xx = np.mgrid[0:N, 0:N]
    tile = ((xx % 128 < 4) | (yy % 128 < 4)).astype(float)
    t = 0.55 + fbm(1.2, 23, lo=20) * 0.06 + unit(fbm(2.6, 24)) * 0.15 - tile * 0.3
    alb = ramp(t, [(0, (0.15, 0.15, 0.15)), (1, (0.5, 0.49, 0.47))])
    grit = fbm(0.22, 108, lo=180)
    alb *= (0.88 + 0.22 * unit(grit))[..., None]
    save(out, "pavement", alb, -tile * 2 + fbm(0.8, 25, lo=40) * 0.2, 2.4)


if __name__ == "__main__":
    main()
