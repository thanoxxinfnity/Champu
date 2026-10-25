"""Draws every HUD drawable (white, frosted-glass, translucent) into assets/ui/*.png. Pure Pillow, no downloads.
    python3 tools/make_ui.py
Style: soft white glyphs with a faint dark shadow for contrast on bright fog, glass discs/panels (white 14 % fill, bright rim, top sheen)."""
import math, os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'ui')
os.makedirs(OUT, exist_ok=True)
S = 4                   # supersample
W = (255, 255, 255)


def layer(size):
    return Image.new('RGBA', (size * S, size * S), (0, 0, 0, 0))


def finish(im, size, name, shadow=True):
    """Downsample, add a soft shadow under the white shape, save."""
    im = im.resize((size, size), Image.LANCZOS)
    if shadow:
        a = im.split()[3]
        sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
        sh.putalpha(a.point(lambda v: int(v * 0.45)))
        sh = sh.filter(ImageFilter.GaussianBlur(size / 64))
        sh = ImageChops.offset(sh, 0, max(1, size // 96))
        base = Image.new('RGBA', im.size, (0, 0, 0, 0))
        base.alpha_composite(sh)
        base.alpha_composite(im)
        im = base
    im.save(os.path.join(OUT, name))


def white(alpha=240):
    return W + (alpha,)


# ── glass shapes ─────────────────────────────────────────────────────────────

def glass_disc(size, name, fill=0.16, rim=0.85, glow=False):
    im = layer(size)
    d = ImageDraw.Draw(im)
    r = size * S // 2
    c = (r, r)
    d.ellipse([c[0] - r + 6 * S, c[1] - r + 6 * S, c[0] + r - 6 * S, c[1] + r - 6 * S], fill=W + (int(255 * fill),))
    # top sheen: a lighter crescent in the upper half
    sheen = layer(size)
    sd = ImageDraw.Draw(sheen)
    sd.ellipse([c[0] - r * 0.78, c[1] - r * 0.92, c[0] + r * 0.78, c[1] + r * 0.12], fill=W + (int(255 * (fill * 0.9)),))
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse([c[0] - r + 6 * S, c[1] - r + 6 * S, c[0] + r - 6 * S, c[1] + r - 6 * S], fill=255)
    sheen.putalpha(ImageChops.multiply(sheen.split()[3], mask))
    im.alpha_composite(sheen)
    d = ImageDraw.Draw(im)
    d.ellipse([c[0] - r + 6 * S, c[1] - r + 6 * S, c[0] + r - 6 * S, c[1] + r - 6 * S], outline=W + (int(255 * rim),), width=int(size * S * 0.035))
    if glow:
        g = im.filter(ImageFilter.GaussianBlur(size * S / 30))
        g.alpha_composite(im)
        im = g
    finish(im, size, name, shadow=False)


def glass_panel(size, name, radius=0.22, fill=0.14, rim=0.8):
    im = layer(size)
    d = ImageDraw.Draw(im)
    m = 5 * S
    box = [m, m, size * S - m, size * S - m]
    rr = int(size * S * radius)
    d.rounded_rectangle(box, rr, fill=W + (int(255 * fill),), outline=W + (int(255 * rim),), width=int(size * S * 0.028))
    sheen = layer(size)
    ImageDraw.Draw(sheen).rounded_rectangle([m * 2, m * 2, size * S - m * 2, size * S * 0.5], rr, fill=W + (int(255 * fill * 0.7),))
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, rr, fill=255)
    sheen.putalpha(ImageChops.multiply(sheen.split()[3], mask))
    im.alpha_composite(sheen)
    finish(im, size, name, shadow=False)


def pill(size_w, size_h, name, fill_alpha, rim_alpha, solid=False):
    im = Image.new('RGBA', (size_w * S, size_h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([3 * S, 3 * S, size_w * S - 3 * S, size_h * S - 3 * S], size_h * S // 2, fill=W + (int(255 * fill_alpha),), outline=(W + (int(255 * rim_alpha),)) if rim_alpha else None, width=2 * S)
    im = im.resize((size_w, size_h), Image.LANCZOS)
    im.save(os.path.join(OUT, name))


# ── glyphs (drawn on a 512 grid, white) ──────────────────────────────────────

def glyph(name, draw_fn, size=128):
    im = layer(512)
    d = ImageDraw.Draw(im)
    draw_fn(im, d)
    # draw_fn works on a 512 grid; scale up by S
    finish(im, size, name)


def rr(d, box, r, fill=None):
    d.rounded_rectangle([v * S for v in box], r * S, fill=fill or white())


def arc_arrow(d, cx, cy, rad, a0, a1, width, head=70):
    box = [(cx - rad) * S, (cy - rad) * S, (cx + rad) * S, (cy + rad) * S]
    d.arc(box, a0, a1, fill=white(), width=width * S)
    t = math.radians(a1)
    px, py = cx + rad * math.cos(t), cy + rad * math.sin(t)
    tx, ty = -math.sin(t), math.cos(t)       # tangent (direction of travel)
    nx, ny = math.cos(t), math.sin(t)
    pts = [(px + tx * head, py + ty * head), (px - nx * head * 0.8 - tx * 8, py - ny * head * 0.8 - ty * 8), (px + nx * head * 0.8 - tx * 8, py + ny * head * 0.8 - ty * 8)]
    d.polygon([(x * S, y * S) for x, y in pts], fill=white())


def ic_attack(im, d):
    tmp = layer(512)
    td = ImageDraw.Draw(tmp)
    td.polygon([(256 * S, 40 * S), (292 * S, 100 * S), (292 * S, 300 * S), (220 * S, 300 * S), (220 * S, 100 * S)], fill=white())
    rr(td, (170, 300, 342, 336), 16)
    rr(td, (238, 336, 274, 420), 12)
    td.ellipse([(256 - 24) * S, (428 - 6) * S, (256 + 24) * S, (428 + 42) * S], fill=white())
    tmp = tmp.rotate(40, resample=Image.BICUBIC, center=(256 * S, 256 * S))
    im.alpha_composite(tmp)


def ic_dodge(im, d):
    arc_arrow(d, 256, 256, 150, 40, 300, 54, 96)


def ic_run(im, d):
    for k, x in enumerate((120, 214, 308)):
        a = 255 - k * 45
        pts = [(x, 110), (x + 120, 256), (x, 402)]
        d.line([(px * S, py * S) for px, py in pts], fill=W + (a,), width=58 * S, joint='curve')
        for px, py in (pts[0], pts[2]):
            d.ellipse([(px - 29) * S, (py - 29) * S, (px + 29) * S, (py + 29) * S], fill=W + (a,))


def ic_use(im, d):
    for i, (x, top) in enumerate(((176, 150), (232, 112), (288, 124), (344, 170))):
        rr(d, (x, top, x + 44, 320), 22)
    rr(d, (160, 260, 388, 420), 56)
    tmp = layer(512)
    rr(ImageDraw.Draw(tmp), (96, 250, 160, 360), 30)
    tmp = tmp.rotate(-35, resample=Image.BICUBIC, center=(150 * S, 300 * S))
    im.alpha_composite(tmp)


def ic_heal(im, d):
    rr(d, (96, 196, 416, 316), 40)
    rr(d, (196, 96, 316, 416), 40)


def ic_flare(im, d):
    d.polygon([(x * S, y * S) for x, y in ((256, 40), (336, 170), (372, 290), (322, 396), (256, 430), (190, 396), (140, 290), (176, 170))], fill=white())
    d.polygon([(x * S, y * S) for x, y in ((256, 190), (302, 280), (286, 352), (256, 376), (226, 352), (210, 280))], fill=(0, 0, 0, 0))


def ic_bag(im, d):
    d.arc([180 * S, 70 * S, 332 * S, 230 * S], 180, 360, fill=white(), width=34 * S)
    rr(d, (140, 150, 372, 440), 72)
    d.rounded_rectangle([190 * S, 300 * S, 322 * S, 380 * S], 22 * S, fill=(0, 0, 0, 0))
    d.rounded_rectangle([190 * S, 300 * S, 322 * S, 380 * S], 22 * S, outline=white(), width=14 * S)
    rr(d, (196, 205, 316, 225), 8, fill=(0, 0, 0, 0))


def ic_lamp(im, d):
    tmp = layer(512)
    td = ImageDraw.Draw(tmp)
    td.polygon([(x * S, y * S) for x, y in ((176, 70), (336, 70), (372, 190), (140, 190))], fill=white())
    rr(td, (170, 190, 342, 440), 36)
    td.rectangle([(220 * S), (260 * S), (292 * S), (300 * S)], fill=(0, 0, 0, 0))
    tmp = tmp.rotate(-25, resample=Image.BICUBIC, center=(256 * S, 256 * S))
    im.alpha_composite(tmp)


def ic_pause(im, d):
    rr(d, (150, 100, 226, 412), 22)
    rr(d, (286, 100, 362, 412), 22)


def ic_shoot(im, d):
    d.ellipse([110 * S, 110 * S, 402 * S, 402 * S], outline=white(), width=34 * S)
    for a in (0, 90, 180, 270):
        t = math.radians(a)
        d.line([((256 + math.cos(t) * 90) * S, (256 + math.sin(t) * 90) * S), ((256 + math.cos(t) * 200) * S, (256 + math.sin(t) * 200) * S)], fill=white(), width=34 * S)
    d.ellipse([(256 - 22) * S, (256 - 22) * S, (256 + 22) * S, (256 + 22) * S], fill=white())


def ic_reload(im, d):
    arc_arrow(d, 256, 256, 140, 25, 150, 48, 84)
    arc_arrow(d, 256, 256, 140, 205, 330, 48, 84)


def ic_heart(im, d):
    d.ellipse([60 * S, 80 * S, 270 * S, 290 * S], fill=white())
    d.ellipse([242 * S, 80 * S, 452 * S, 290 * S], fill=white())
    d.polygon([(70 * S, 220 * S), (442 * S, 220 * S), (256 * S, 450 * S)], fill=white())


def ic_bolt(im, d):
    d.polygon([(x * S, y * S) for x, y in ((290, 40), (130, 280), (240, 280), (206, 470), (390, 210), (276, 210))], fill=white())


def ic_marker(im, d):
    d.polygon([(x * S, y * S) for x, y in ((256, 40), (440, 256), (256, 472), (72, 256))], fill=white())
    d.polygon([(x * S, y * S) for x, y in ((256, 130), (356, 256), (256, 382), (156, 256))], fill=(0, 0, 0, 0))


def ic_arrow(im, d):
    d.polygon([(x * S, y * S) for x, y in ((256, 50), (430, 400), (256, 330), (82, 400))], fill=white())


def ic_left(im, d):
    d.line([(330 * S, 90 * S), (170 * S, 256 * S), (330 * S, 422 * S)], fill=white(), width=64 * S, joint='curve')


def ic_right(im, d):
    d.line([(182 * S, 90 * S), (342 * S, 256 * S), (182 * S, 422 * S)], fill=white(), width=64 * S, joint='curve')


def main():
    glass_disc(192, 'btn_round.png', 0.14, 0.8)
    glass_disc(192, 'btn_round_down.png', 0.42, 1.0, glow=True)
    glass_disc(256, 'stick_base.png', 0.1, 0.7)
    glass_disc(128, 'stick_knob.png', 0.34, 0.95, glow=True)
    glass_panel(96, 'panel.png')
    glass_panel(96, 'panel_dark.png', fill=0.07, rim=0.55)
    glass_panel(96, 'btn_wide.png', radius=0.3, fill=0.16, rim=0.85)
    glass_panel(96, 'btn_wide_down.png', radius=0.3, fill=0.4, rim=1.0)
    pill(64, 24, 'bar_bg.png', 0.14, 0.7)
    pill(64, 24, 'bar_fill.png', 0.92, 0.0)
    for nm, fn in (('attack', ic_attack), ('dodge', ic_dodge), ('run', ic_run), ('use', ic_use), ('heal', ic_heal), ('flare', ic_flare), ('bag', ic_bag), ('lamp', ic_lamp),
                   ('pause', ic_pause), ('shoot', ic_shoot), ('reload', ic_reload), ('heart', ic_heart), ('bolt', ic_bolt), ('marker', ic_marker), ('arrow', ic_arrow),
                   ('left', ic_left), ('right', ic_right)):
        glyph(f'ic_{nm}.png', fn)
    print('wrote', len(os.listdir(OUT)), 'drawables to', OUT)


if __name__ == '__main__':
    main()


def make_icon():
    """Launcher icon (512) + adaptive layers (432) + boot splash (1280x720): crimson mist gradient, white glass bell."""
    from PIL import ImageFont
    def bg(w, h):
        im = Image.new('RGBA', (w, h))
        px = im.load()
        for y in range(h):
            for x in range(w):
                t = y / h
                d = math.hypot(x - w * 0.5, y - h * 0.62) / (max(w, h) * 0.7)
                r = int(26 + 110 * max(0, 1 - d) ** 1.6 - 8 * t)
                g = int(14 + 10 * max(0, 1 - d))
                b = int(26 + 26 * max(0, 1 - d))
                px[x, y] = (r, g, b, 255)
        return im
    def bell(size):
        im = layer(size)
        d = ImageDraw.Draw(im)
        k = size * S / 512
        def P(pts):
            return [(x * k, y * k) for x, y in pts]
        d.ellipse([(256 - 34) * k, 70 * k, (256 + 34) * k, 138 * k], fill=white())
        d.polygon(P([(256, 110), (330, 190), (352, 330), (396, 380), (396, 400), (116, 400), (116, 380), (160, 330), (182, 190)]), fill=white())
        d.rounded_rectangle([100 * k, 384 * k, 412 * k, 418 * k], 17 * k, fill=white())
        d.ellipse([(256 - 36) * k, 408 * k, (256 + 36) * k, 470 * k], fill=white())
        d.ellipse([(256 - 20) * k, 190 * k, (256 + 20) * k, 230 * k], fill=(0, 0, 0, 0))
        out = im.resize((size, size), Image.LANCZOS)
        return out
    icon = bg(512, 512)
    b = bell(400)
    sh = Image.new('RGBA', b.size, (0, 0, 0, 0))
    sh.putalpha(b.split()[3].point(lambda v: int(v * 0.5)))
    sh = sh.filter(ImageFilter.GaussianBlur(10))
    icon.alpha_composite(sh, (56, 66))
    icon.alpha_composite(b, (56, 56))
    icon.save(os.path.join(OUT, '..', '..', 'icon.png'))
    fg = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
    fg.alpha_composite(bell(260), (86, 86))
    fg.save(os.path.join(OUT, 'icon_fg.png'))
    bg(432, 432).save(os.path.join(OUT, 'icon_bg.png'))
    sp = bg(1280, 720)
    sp.alpha_composite(bell(260), (510, 120))
    d = ImageDraw.Draw(sp)
    try:
        f1 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 84)
        f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 30)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    for text, f, y, a in (('CRIMSON MIST', f1, 410, 255), ('Chapter 1  -  The Red Bell', f2, 520, 190)):
        w = d.textlength(text, font=f)
        d.text(((1280 - w) / 2, y), text, font=f, fill=(255, 255, 255, a))
    sp.convert('RGB').save(os.path.join(OUT, 'splash.png'))


if __name__ == '__main__':
    make_icon()
