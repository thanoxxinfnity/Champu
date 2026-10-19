"""Compose the loading-screen art: NIM background plate + Blender character render (RGBA) + GTA poster grade.
    python3 tools/poster_compose.py renders_dir backgrounds_dir out_dir     (Pillow + numpy)"""
import os, sys
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageDraw
rd, bd, od = sys.argv[1:4]
os.makedirs(od, exist_ok=True)
PLAN = [('01_gojo_hero', 'rooftop', (50, 110, 255)), ('02_sukuna_hero', 'shrine', (255, 60, 40)), ('03_faceoff', 'shibuya', (150, 70, 230)),
        ('04_gojo_face', 'alley', (40, 150, 255)), ('05_sukuna_face', 'crater', (255, 90, 40)), ('06_clash', 'shibuya', (255, 160, 40))]
W, H = 1600, 900
for name, bgname, wash in PLAN:
    bg = Image.open(os.path.join(bd, bgname + '.jpg')).convert('RGB')
    bg = ImageOps.fit(bg, (W, H), Image.LANCZOS)
    bg = bg.filter(ImageFilter.GaussianBlur(2.0))
    ch = Image.open(os.path.join(rd, name + '.png')).convert('RGBA')
    bb = ch.getbbox()
    if bb and (bb[3] - bb[1]) < H * 0.9:       # full-body shot: stand the feet on the ground (lower third of the frame)
        ch = ch.transform(ch.size, Image.AFFINE, (1, 0, 0, 0, 1, -(int(H * 0.93) - bb[3])), resample=Image.BICUBIC)
    # a soft dark shadow behind the character so it separates from the plate
    a = ch.split()[3].filter(ImageFilter.GaussianBlur(18))
    shadow = Image.new('RGB', (W, H), (0, 0, 0))
    bg.paste(shadow, (0, 0), a.point(lambda v: int(v * 0.55)))
    bg.paste(ch, (0, 0), ch)
    base = ImageEnhance.Contrast(bg).enhance(1.30)
    base = ImageEnhance.Color(base).enhance(1.35)
    post = ImageOps.posterize(base, 4)
    g = ImageOps.autocontrast(bg.convert('L')).filter(ImageFilter.GaussianBlur(1.0)).filter(ImageFilter.FIND_EDGES)
    ink = (np.array(g, dtype=np.float32) > 30).astype(np.float32)
    lum = np.array(ImageOps.grayscale(post), dtype=np.float32) / 255.0
    yy, xx = np.mgrid[0:H, 0:W]
    step = 8
    cell = np.hypot((xx % step) - step / 2, (yy % step) - step / 2)
    dots = (cell < (1 - lum) * step * 0.55).astype(np.float32)
    out = np.array(post, dtype=np.float32) * 0.9 + np.array(wash, dtype=np.float32) * 0.12
    out *= (1 - 0.22 * dots[..., None])
    out *= (1 - 0.7 * ink[..., None])
    vx = np.linspace(-1, 1, W)[None, :]
    vy = np.linspace(-1, 1, H)[:, None]
    out *= (1 - 0.40 * np.clip(vx ** 2 + vy ** 2, 0, 1.5))[..., None]
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    d.rectangle([14, 14, W - 15, H - 15], outline=(248, 248, 240), width=10)
    d.rectangle([34, 34, W - 35, H - 35], outline=wash, width=4)
    img.save(os.path.join(od, name + '.jpg'), quality=92)
    print('COMPOSED', name)
