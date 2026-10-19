"""GTA-loading-screen grade: python3 tools/poster_grade.py in_dir out_dir   (needs Pillow + numpy)
Posterise to few tones, boost contrast, add a halftone dot layer in the shadows, a hand-drawn-looking ink edge, a colour wash and a border."""
import sys, os
import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageEnhance, ImageDraw

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
WASH = {'01': (40, 90, 220), '02': (230, 60, 50), '03': (140, 60, 200), '04': (40, 130, 255), '05': (240, 70, 30), '06': (250, 150, 40)}
for f in sorted(os.listdir(src)):
    if not f.endswith('.png'):
        continue
    im = Image.open(os.path.join(src, f)).convert('RGB')
    base = ImageEnhance.Contrast(im).enhance(1.35)
    base = ImageEnhance.Color(base).enhance(1.4)
    post = ImageOps.posterize(base, 3)
    # ink edges
    g = ImageOps.autocontrast(im.convert('L')).filter(ImageFilter.GaussianBlur(1.2))
    edges = g.filter(ImageFilter.FIND_EDGES)
    e = np.array(edges, dtype=np.float32)
    ink = (e > 22).astype(np.float32)
    # halftone: dots whose size follows the darkness
    a = np.array(post, dtype=np.float32)
    lum = np.array(ImageOps.grayscale(post), dtype=np.float32) / 255.0
    H, W = lum.shape
    yy, xx = np.mgrid[0:H, 0:W]
    step = 9
    cell = (np.hypot((xx % step) - step / 2, (yy % step) - step / 2))
    dots = (cell < (1 - lum) * step * 0.6).astype(np.float32)
    wash = np.array(WASH.get(f[:2], (120, 120, 120)), dtype=np.float32)
    out = a * 0.92 + wash * 0.10
    out = out * (1 - 0.30 * dots[..., None]) 
    out = out * (1 - 0.85 * ink[..., None])
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for i, w in enumerate((18, 6)):
        d.rectangle([i * 24, i * 24, W - 1 - i * 24, H - 1 - i * 24], outline=(250, 250, 245) if i == 0 else tuple(int(c) for c in wash), width=w)
    # vignette
    vx = np.linspace(-1, 1, W)[None, :]
    vy = np.linspace(-1, 1, H)[:, None]
    vig = 1 - 0.35 * np.clip(vx ** 2 + vy ** 2, 0, 1.5)
    arr = np.array(img, dtype=np.float32) * vig[..., None]
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(os.path.join(dst, f.replace('.png', '.jpg')), quality=92)
    print('GRADED', f)
