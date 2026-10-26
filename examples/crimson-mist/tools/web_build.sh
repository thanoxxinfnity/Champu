#!/bin/bash
# Phone-browser build of Chapter 1 -> build/web (index.html + .pck + .wasm), small enough for static hosting (<100 MB per file).
# Works on a copy of the project: licensed hero models (private/) are NOT included, textures are shrunk, only desktop (s3tc) texture formats are kept.
#   tools/web_build.sh
set -e
cd "$(dirname "$0")/.."
SRC=$PWD
W=${WEBPROJ:-/tmp/cm/webproj}
rm -rf "$W"; mkdir -p "$W"
(cd "$SRC" && tar cf - --exclude=./.godot --exclude=./private --exclude=./raw --exclude=./build --exclude=./tests --exclude=./tools --exclude='*.apk' .) | (cd "$W" && tar xf -)
python3 - "$W" <<'PY'
import os, sys
from PIL import Image
W = sys.argv[1]
HERO = ('brick_red', 'plaster_beige', 'asphalt', 'pavement', 'forest_floor', 'roof_tiles')
d = os.path.join(W, 'assets', 'tex')
for f in os.listdir(d):
    if f.endswith('.jpg'):
        im = Image.open(os.path.join(d, f))
        size = 1024 if f.startswith(HERO) and f.endswith('_d.jpg') else 512
        if max(im.size) > size:
            im.resize((size, size), Image.LANCZOS).save(os.path.join(d, f), quality=84)
for sub in ('world', 'cast', 'ph'):
    d = os.path.join(W, 'assets', sub)
    for f in os.listdir(d):
        if f.endswith(('.jpg', '.png')) and not f.endswith('.import'):
            p = os.path.join(d, f)
            im = Image.open(p)
            if max(im.size) > 512:
                k = 512 / max(im.size)
                im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
                im.save(p, quality=84) if f.endswith('.jpg') else im.save(p)
for root, _, files in os.walk(W):
    for f in files:
        if f.endswith('.import'):
            os.remove(os.path.join(root, f))
s = open(os.path.join(W, 'project.godot')).read()
s = s.replace('import_etc2_astc=true', 'import_etc2_astc=false')
open(os.path.join(W, 'project.godot'), 'w').write(s)
e = open(os.path.join(W, 'export_presets.cfg')).read().replace('vram_texture_compression/for_mobile=true', 'vram_texture_compression/for_mobile=false')
open(os.path.join(W, 'export_presets.cfg'), 'w').write(e)
PY
cd "$W"
godot --headless --import >/dev/null 2>&1 || true
for f in assets/tex/*.import; do sed -i 's/^compress\/mode=0/compress\/mode=2/; s/^mipmaps\/generate=false/mipmaps\/generate=true/' "$f"; done
godot --headless --import >/dev/null 2>&1 || true
mkdir -p "$SRC/build/web"; rm -rf "$SRC"/build/web/*
godot --headless --export-release "Web" "$SRC/build/web/index.html" 2>&1 | grep -E "ERROR" | head -5 || true
ls -la "$SRC/build/web"
