"""raw/ph/tex/<name>/{diff,nor}.jpg -> assets/tex/<id>_d.jpg / <id>_n.jpg (hero surfaces keep 2048 px, the rest 1024).
    python3 tools/prep_tex.py"""
import os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import polyhaven as ph

HERO = {'brick_red', 'plaster_beige', 'asphalt', 'pavement', 'forest_floor', 'roof_tiles', 'concrete', 'planks_brown', 'grass', 'cobble'}
out = os.path.join(HERE, '..', 'assets', 'tex')
os.makedirs(out, exist_ok=True)
for name, (gid, res) in ph.TEX.items():
    for tag, suf in (('diff', 'd'), ('nor', 'n')):
        src = os.path.join(ph.ROOT, 'tex', name, tag + '.jpg')
        if not os.path.exists(src):
            print('missing', src)
            continue
        im = Image.open(src).convert('RGB')
        size = 2048 if gid in HERO else 1024
        if max(im.size) > size:
            im = im.resize((size, size), Image.LANCZOS)
        im.save(os.path.join(out, f'{gid}_{suf}.jpg'), quality=86, optimize=True)
    print('tex', gid)
