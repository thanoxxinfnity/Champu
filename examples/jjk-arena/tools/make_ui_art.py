"""Compose the game's 2D art from the generated paintings: logo, app icon, splash/title, loading posters, character cards and
technique badges. Text is laid out here (Anton / Rajdhani / a brush kanji face) with gradient fills, strokes, shadow and glow.

    python3 tools/make_ui_art.py <paintings_dir> <brush_font.ttf> <out_dir>"""
import sys, os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops, ImageEnhance

src, brush_font, out = sys.argv[1], sys.argv[2], sys.argv[3]
F = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'fonts')
ANTON = os.path.join(F, 'Anton-Regular.ttf')
RAJ = os.path.join(F, 'Rajdhani-Bold.ttf')
os.makedirs(out, exist_ok=True)

def font(path, size):
    return ImageFont.truetype(path, size)

def gradient(w, h, stops, horizontal=True):
    g = Image.new('RGB', (w, h))
    px = g.load()
    n = w if horizontal else h
    for i in range(n):
        t = i / max(1, n - 1)
        for k in range(len(stops) - 1):
            if stops[k][0] <= t <= stops[k + 1][0]:
                a, b = stops[k], stops[k + 1]
                u = (t - a[0]) / max(1e-6, b[0] - a[0])
                c = tuple(int(a[1][j] + (b[1][j] - a[1][j]) * u) for j in range(3))
                break
        if horizontal:
            for y in range(h): px[i, y] = c
        else:
            for x in range(w): px[x, i] = c
    return g

def fancy_text(text, fnt, stops, stroke=10, inner=3, glow=None, shadow=8, spacing=0, horizontal=True):
    """Gradient-filled text with a white inner rim, a thick black outline, a drop shadow and an optional coloured glow."""
    tmp = Image.new('L', (10, 10))
    d = ImageDraw.Draw(tmp)
    bbox = d.textbbox((0, 0), text, font=fnt, stroke_width=stroke)
    w, h = bbox[2] - bbox[0] + stroke * 4 + 40, bbox[3] - bbox[1] + stroke * 4 + 40
    off = (stroke * 2 + 20 - bbox[0], stroke * 2 + 20 - bbox[1])
    def mask(sw):
        m = Image.new('L', (w, h), 0)
        ImageDraw.Draw(m).text(off, text, font=fnt, fill=255, stroke_width=sw, stroke_fill=255)
        return m
    m_out, m_in, m_fill = mask(stroke), mask(inner), mask(0)
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    if glow:
        g = Image.new('RGBA', (w, h), glow + (0,))
        g.putalpha(m_out.filter(ImageFilter.GaussianBlur(stroke * 1.6)))
        layer = Image.alpha_composite(layer, g)
    if shadow:
        sh = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        sm = ImageChops.offset(m_out, shadow, shadow).filter(ImageFilter.GaussianBlur(3))
        sh.putalpha(sm.point(lambda v: int(v * 0.8)))
        layer = Image.alpha_composite(layer, sh)
    black = Image.new('RGBA', (w, h), (8, 6, 10, 255)); black.putalpha(m_out)
    white = Image.new('RGBA', (w, h), (255, 255, 255, 255)); white.putalpha(m_in)
    fill = gradient(w, h, stops, horizontal).convert('RGBA'); fill.putalpha(m_fill)
    # light sheen across the top half of the letters
    sheen = Image.new('L', (w, h), 0)
    ImageDraw.Draw(sheen).rectangle([0, 0, w, int(off[1] + (bbox[3] - bbox[1]) * 0.45)], fill=70)
    sheen = ImageChops.multiply(sheen, m_fill)
    wl = Image.new('RGBA', (w, h), (255, 255, 255, 0)); wl.putalpha(sheen)
    for l in (black, white, fill, wl):
        layer = Image.alpha_composite(layer, l)
    return layer.crop(layer.getbbox())

def paste_c(base, im, cx, cy):
    base.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))

def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * s + 0.5), int(im.height * s + 0.5)), Image.LANCZOS)
    l, t = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((l, t, l + w, t + h))

def vignette(im, strength=0.6):
    w, h = im.size
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).ellipse([-w * 0.25, -h * 0.35, w * 1.25, h * 1.35], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(min(w, h) * 0.12))
    dark = Image.new('RGBA', (w, h), (0, 0, 0, 255))
    dark.putalpha(m.point(lambda v: int((255 - v) * strength)))
    return Image.alpha_composite(im.convert('RGBA'), dark)

BLUE_RED = [(0.0, (90, 190, 255)), (0.45, (170, 120, 255)), (0.55, (220, 90, 220)), (1.0, (255, 60, 70))]
GOLD = [(0.0, (255, 245, 200)), (1.0, (255, 170, 60))]

# ---- 1. logo (transparent) ------------------------------------------------------------------------------------------
def logo(scale=1.0):
    title = fancy_text('CURSED CLASH', font(ANTON, int(210 * scale)), BLUE_RED, stroke=int(14 * scale), inner=int(4 * scale),
                       glow=(150, 90, 255), shadow=int(10 * scale))
    kanji = fancy_text('呪術激突', font(brush_font, int(150 * scale)), [(0, (255, 70, 70)), (1, (170, 0, 20))], stroke=int(8 * scale),
                       inner=0, glow=(255, 30, 30), shadow=int(6 * scale))
    kanji = kanji.rotate(-6, expand=True, resample=Image.BICUBIC)
    sub = fancy_text('S H I B U Y A   S H O W D O W N', font(RAJ, int(54 * scale)), GOLD, stroke=int(5 * scale), inner=0, shadow=int(4 * scale))
    W = max(title.width, sub.width) + int(80 * scale)
    H = int(title.height + sub.height + kanji.height * 0.55 + 60 * scale)
    L = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    paste_c(L, kanji, W * 0.72, kanji.height * 0.5)                        # brush kanji behind, upper right
    ty = kanji.height * 0.55 + title.height / 2
    paste_c(L, title, W / 2, ty)
    # slash bar between title and subtitle
    bar = Image.new('RGBA', (int(title.width * 0.86), int(10 * scale)), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bar)
    for x in range(bar.width):
        t = x / bar.width
        a = int(255 * math.sin(math.pi * t))
        bd.line([(x, 0), (x, bar.height)], fill=(255, 255, 255, a))
    paste_c(L, bar, W / 2, ty + title.height / 2 + 6 * scale)
    paste_c(L, sub, W / 2, ty + title.height / 2 + sub.height / 2 + 22 * scale)
    return L.crop(L.getbbox())

LOGO = logo()
LOGO.save(os.path.join(out, 'logo.png'))

# ---- 2. app icon ------------------------------------------------------------------------------------------------------
ic = cover(Image.open(os.path.join(src, 'icon.jpg')).convert('RGB'), 1024, 1024)
ic = ImageEnhance.Contrast(ic).enhance(1.12).convert('RGBA')
icon = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
mask = Image.new('L', (1024, 1024), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, 1023, 1023], radius=200, fill=255)
icon.paste(ic, (0, 0), mask)
mono = fancy_text('CC', font(ANTON, 230), BLUE_RED, stroke=16, inner=5, glow=(150, 90, 255), shadow=10)
paste_c(icon, mono, 512, 820)
ring = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
ImageDraw.Draw(ring).rounded_rectangle([8, 8, 1015, 1015], radius=196, outline=(255, 255, 255, 120), width=10)
icon = Image.alpha_composite(icon, ring)
for s in (512, 192, 432):
    icon.resize((s, s), Image.LANCZOS).save(os.path.join(out, f'icon_{s}.png'))
bg = Image.new('RGB', (432, 432), (10, 6, 20)); bg.save(os.path.join(out, 'icon_bg_432.png'))

# ---- 3. splash + title background ------------------------------------------------------------------------------------
title_bg = vignette(ImageEnhance.Brightness(cover(Image.open(os.path.join(src, 'title.jpg')).convert('RGB'), 1920, 1080)).enhance(0.8), 0.7)
title_bg.convert('RGB').save(os.path.join(out, 'title_bg.jpg'), quality=88)
splash = title_bg.copy()
lg = LOGO.copy(); lg.thumbnail((1250, 700), Image.LANCZOS)
paste_c(splash, lg, 960, 470)
tap = fancy_text('FAN GAME  ·  GOJO  VS  SUKUNA', font(RAJ, 40), [(0, (230, 230, 240)), (1, (200, 200, 215))], stroke=4, inner=0, shadow=3)
paste_c(splash, tap, 960, 900)
splash.convert('RGB').save(os.path.join(out, 'splash.jpg'), quality=90)
boot = Image.new('RGB', (1280, 720), (6, 4, 12)).convert('RGBA')
lg2 = LOGO.copy(); lg2.thumbnail((900, 500), Image.LANCZOS)
paste_c(boot, lg2, 640, 360)
boot.convert('RGB').save(os.path.join(out, 'boot_splash.png'))

# ---- 4. loading posters ------------------------------------------------------------------------------------------------
POSTERS = [('load1.jpg', 'THE STRONGEST', 'Lapse: Blue pulls everything in. Reversal: Red throws it all back.'),
           ('load2.jpg', 'KING OF CURSES', 'Inside Malevolent Shrine the cuts never stop. Keep moving.'),
           ('load3.jpg', 'CLASH', 'Block halves the damage, but a domain or a super breaks straight through.'),
           ('load4.jpg', 'HOLLOW PURPLE', 'Below half health your ultimate becomes a 200% super.'),
           ('title.jpg', 'SHIBUYA, 31 OCTOBER', 'Ultimates bring down whole buildings. Fight on the rubble.')]
for i, (f, head, tip) in enumerate(POSTERS):
    p = vignette(cover(Image.open(os.path.join(src, f)).convert('RGB'), 1600, 900), 0.55)
    band = Image.new('RGBA', (1600, 900), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    for y in range(560, 900):
        bd.line([(0, y), (1600, y)], fill=(0, 0, 0, int(220 * ((y - 560) / 340) ** 1.2)))
    p = Image.alpha_composite(p, band)
    h = fancy_text(head, font(ANTON, 96), BLUE_RED if i % 2 == 0 else [(0, (255, 120, 110)), (1, (200, 20, 40))], stroke=8, inner=3, shadow=6)
    p.alpha_composite(h, (70, 900 - 70 - h.height - 54))
    td = ImageDraw.Draw(p)
    td.text((76, 900 - 92), tip, font=font(RAJ, 38), fill=(235, 235, 240), stroke_width=3, stroke_fill=(0, 0, 0))
    lg3 = LOGO.copy(); lg3.thumbnail((360, 200), Image.LANCZOS)
    p.alpha_composite(lg3, (1600 - lg3.width - 40, 30))
    p.convert('RGB').save(os.path.join(out, f'poster_{i + 1}.jpg'), quality=86)

# ---- 5. character cards ------------------------------------------------------------------------------------------------
CARDS = [('portrait_gojo.jpg', 'GOJO', 'SATORU', 'THE STRONGEST', '五条悟', (90, 180, 255)),
         ('portrait_sukuna.jpg', 'SUKUNA', 'RYOMEN', 'KING OF CURSES', '両面宿儺', (255, 60, 70))]
for f, name, first, tag, kanji, col in CARDS:
    W, H = 600, 1000
    c = cover(Image.open(os.path.join(src, f)).convert('RGB'), W, H).convert('RGBA')
    shade = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for y in range(600, H):
        sd.line([(0, y), (W, y)], fill=(0, 0, 0, int(230 * ((y - 600) / 400) ** 1.1)))
    c = Image.alpha_composite(c, shade)
    k = fancy_text(kanji, font(brush_font, 120), [(0, col), (1, tuple(int(v * 0.6) for v in col))], stroke=6, inner=0, shadow=4, horizontal=False)
    kv = Image.new('RGBA', (k.width, k.height), (0, 0, 0, 0))
    # vertical kanji down the left edge
    chars = [fancy_text(ch, font(brush_font, 110), [(0, (255, 255, 255)), (1, col)], stroke=6, inner=0, shadow=4) for ch in kanji]
    y = 40
    for ch in chars:
        c.alpha_composite(ch, (24, y)); y += ch.height - 6
    nm = fancy_text(name, font(ANTON, 150), [(0, (255, 255, 255)), (1, col)], stroke=10, inner=3, shadow=6, horizontal=False)
    fn = fancy_text(first, font(RAJ, 56), [(0, (230, 230, 240)), (1, (180, 180, 200))], stroke=4, inner=0, shadow=3)
    tg = fancy_text(tag, font(RAJ, 44), GOLD, stroke=4, inner=0, shadow=3)
    c.alpha_composite(fn, (36, H - 70 - tg.height - nm.height - fn.height + 20))
    c.alpha_composite(nm, (30, H - 60 - tg.height - nm.height))
    c.alpha_composite(tg, (40, H - 50 - tg.height))
    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    fd.rectangle([4, 4, W - 5, H - 5], outline=col + (255,), width=8)
    fd.rectangle([16, 16, W - 17, H - 17], outline=(255, 255, 255, 90), width=2)
    c = Image.alpha_composite(c, frame)
    c.convert('RGB').save(os.path.join(out, f'card_{name.lower()}.jpg'), quality=90)

# ---- 6. technique badges -----------------------------------------------------------------------------------------------
BADGES = [('void', 'INFINITE VOID', (90, 170, 255)), ('shrine', 'MALEVOLENT SHRINE', (255, 50, 60)), ('purple', 'HOLLOW PURPLE', (190, 110, 255)),
          ('red', 'REVERSAL RED', (255, 70, 70)), ('fuga', 'FUGA', (255, 150, 50)), ('slash', 'WORLD SLASH', (220, 230, 255))]
for key, label, col in BADGES:
    S = 512
    art = cover(Image.open(os.path.join(src, f'badge_{key}.jpg')).convert('RGB'), S, S).convert('RGBA')
    b = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).ellipse([20, 20, S - 21, S - 21], fill=255)
    b.paste(art, (0, 0), m)
    rd = ImageDraw.Draw(b)
    rd.ellipse([14, 14, S - 15, S - 15], outline=(10, 8, 14, 255), width=14)
    rd.ellipse([22, 22, S - 23, S - 23], outline=col + (255,), width=8)
    rd.ellipse([36, 36, S - 37, S - 37], outline=(255, 255, 255, 110), width=2)
    lab = fancy_text(label, font(RAJ, 64 if len(label) < 14 else 50), [(0, (255, 255, 255)), (1, col)], stroke=6, inner=0, shadow=3)
    plate = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle([40, S - 120, S - 40, S - 40], radius=24, fill=(0, 0, 0, 170), outline=col + (200,), width=3)
    b = Image.alpha_composite(b, plate)
    lab.thumbnail((S - 110, 70), Image.LANCZOS)
    paste_c(b, lab, S / 2, S - 80)
    b.save(os.path.join(out, f'badge_{key}.png'))
print('UI ART done ->', out)
