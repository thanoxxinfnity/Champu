#!/usr/bin/env python3
"""Mark the 3D textures for VRAM compression (ETC2/ASTC on phones) with mipmaps.

Godot's headless import cannot tell a 3D texture from a UI image, so after
the first `godot --import`, run this and import again.
    python3 tools/fix_imports.py && godot --headless --path . --import
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATTERNS = ["textures/ground/*.jpg.import", "assets/trellis/*.jpg.import", "assets/trellis/*.png.import"]

changed = 0
for pat in PATTERNS:
    for path in glob.glob(os.path.join(ROOT, pat)):
        s = open(path).read()
        t = re.sub(r"compress/mode=\d", "compress/mode=2", s)
        t = re.sub(r"mipmaps/generate=\w+", "mipmaps/generate=true", t)
        if t != s:
            open(path, "w").write(t)
            changed += 1
print(f"updated {changed} import files")
