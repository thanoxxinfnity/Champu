"""Procedural textures (PIL + numpy) so the models carry real image textures without any image-generation credits."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import os

rng = np.random.default_rng(7)


def _save(arr, path):
    Image.fromarray(np.clip(arr, 0, 255).astype('uint8')).save(path)


def noise(n, scale, seed=0):
    r = np.random.default_rng(seed)
    small = r.random((max(2, n // scale), max(2, n // scale)))
    im = Image.fromarray((small * 255).astype('uint8')).resize((n, n), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def skin(path, base=(236, 196, 172), n=512, blush=0.0):
    a = np.zeros((n, n, 3), np.float32)
    f = 0.55 * noise(n, 64, 1) + 0.3 * noise(n, 16, 2) + 0.15 * noise(n, 4, 3)
    for c in range(3):
        a[..., c] = base[c] * (0.93 + 0.12 * f)
    a[..., 0] += 6 * f
    _save(a, path)


def fabric(path, base, weave=2.0, n=512, sheen=0.06, twill=True):
    """Woven cloth: a diagonal twill plus slow fold shading."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    t = np.sin((x + (y if twill else 0)) * np.pi / 4.0 * weave) * 0.5 + 0.5
    folds = 0.6 * noise(n, 96, 5) + 0.4 * noise(n, 24, 6)
    shade = 0.82 + 0.22 * folds + 0.06 * t
    a = np.zeros((n, n, 3), np.float32)
    for c in range(3):
        a[..., c] = base[c] * shade + 255 * sheen * (t - 0.5) * 0.4
    _save(a, path)


def fabric_normal(path, n=512):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    h = np.sin((x + y) * np.pi / 4.0 * 2.0) * 0.5 + 0.5
    gx = np.gradient(h, axis=1)
    gy = np.gradient(h, axis=0)
    nx, ny, nz = -gx * 2.0, -gy * 2.0, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    a = np.stack([(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (nz / l * 0.5 + 0.5) * 255], -1)
    _save(a, path)


def hair(path, root, tip, n=512):
    """Vertical strand streaks, darker at the root (v=0) and lighter toward the tip (v=1)."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    streak = noise(n, 3, 11)[:, ::1]
    streak = np.repeat(np.asarray(Image.fromarray((np.random.default_rng(3).random((8, n // 3)) * 255).astype('uint8')).resize((n, n), Image.BICUBIC), dtype=np.float32)[..., None] / 255.0, 3, axis=2)
    g = (y / n)[..., None]
    a = np.zeros((n, n, 3), np.float32)
    for c in range(3):
        a[..., c] = (root[c] * (1 - g[..., 0]) + tip[c] * g[..., 0]) * (0.85 + 0.3 * streak[..., c])
    _save(a, path)


def iris(path, ring=(90, 170, 255), n=256, glow=True, pupil=(5, 8, 20)):
    img = Image.new('RGB', (n, n), (245, 245, 250))
    d = ImageDraw.Draw(img)
    c = n // 2
    d.ellipse([c - 100, c - 100, c + 100, c + 100], fill=tuple(int(v * 0.55) for v in ring))
    d.ellipse([c - 88, c - 88, c + 88, c + 88], fill=ring)
    d.ellipse([c - 44, c - 44, c + 44, c + 44], fill=pupil)
    d.ellipse([c - 38, c - 70, c - 6, c - 40], fill=(255, 255, 255))
    for i in range(36):
        import math
        a = i / 36 * math.tau
        d.line([c + 46 * math.cos(a), c + 46 * math.sin(a), c + 86 * math.cos(a), c + 86 * math.sin(a)], fill=tuple(min(255, int(v * 1.25)) for v in ring), width=2)
    img.filter(ImageFilter.GaussianBlur(0.8)).save(path)


def kimono(path, n=512):
    """Pale cloth with a faint woven pattern and a purple-grey border band at the bottom."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    base = np.array([232, 228, 224], np.float32)
    f = 0.7 * noise(n, 64, 8) + 0.3 * noise(n, 16, 9)
    t = np.sin((x + y) * np.pi / 4.0 * 2.0) * 0.5 + 0.5
    a = base[None, None, :] * (0.9 + 0.12 * f[..., None]) + (t[..., None] - 0.5) * 6
    band = (y > n * 0.86)
    a[band] = np.array([92, 70, 118], np.float32) * (0.9 + 0.2 * f[band][..., None])
    edge = (abs(y - n * 0.86) < 3)
    a[edge] = np.array([200, 170, 90], np.float32)
    _save(a, path)


def tattoo(path, n=1024):
    """Transparent-background black stripes for Sukuna's face/body markings (RGBA)."""
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(5):
        y = 120 + i * 40
        d.line([60, y, n - 60, y + (i - 2) * 8], fill=(15, 10, 12, 255), width=14)
    img.save(path)


def all(out):
    os.makedirs(out, exist_ok=True)
    skin(f'{out}/skin.png', (240, 202, 178))
    skin(f'{out}/skin_sukuna.png', (226, 184, 160))
    fabric(f'{out}/uniform_navy.png', (22, 26, 46), 2.0, sheen=0.08)
    fabric(f'{out}/pants_black.png', (16, 16, 20), 2.0, sheen=0.05)
    fabric(f'{out}/blindfold.png', (10, 10, 12), 3.0, sheen=0.1)
    fabric_normal(f'{out}/fabric_n.png')
    kimono(f'{out}/kimono.png')
    fabric(f'{out}/sash_black.png', (24, 22, 28), 2.0)
    hair(f'{out}/hair_white.png', (170, 178, 196), (255, 255, 255))
    hair(f'{out}/hair_pink.png', (190, 70, 105), (255, 150, 175))
    iris(f'{out}/iris_blue.png', (90, 175, 255))
    iris(f'{out}/iris_red.png', (210, 25, 40), pupil=(20, 0, 0))
    tattoo(f'{out}/tattoo.png')


if __name__ == '__main__':
    import sys
    all(sys.argv[1] if len(sys.argv) > 1 else 'textures')
