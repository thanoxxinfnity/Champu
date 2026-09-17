"""Run the notebook's own edits against a real inference.py and check the result.

Every one of these rewrites a line in someone else's repository. A rewrite that
silently misses costs an hour of GPU time and then fails exactly as it did
before the fix, so the notebook raises when an anchor is missing -- but that
only helps if the anchors match what upstream actually ships.

This calls `patch_inference` out of the generated notebook rather than
re-implementing it. The difference is not academic: the re-implementing version
of this script passed twice while the notebook itself would not even parse,
both times because an escape was eaten by the TypeScript template literal that
emits it.

  python3 scripts/check-pixal3d-patches.py <notebook.py> <path/to/inference.py>
"""
import ast
import io
import os
import py_compile
import re
import sys
import tempfile

nb_path, inf_path = sys.argv[1], sys.argv[2]
nb = io.open(nb_path, encoding='utf-8').read()
work = tempfile.mkdtemp()


def shim(name):
    found = re.search(r"%s = '''(.*?)'''" % name, nb, re.S)
    if not found:
        sys.exit('the notebook no longer carries %s' % name)
    return found.group(1)


def compiles(name, source):
    path = os.path.join(work, name)
    io.open(path, 'w', encoding='utf-8').write(source)
    py_compile.compile(path, doraise=True)
    print('compiles              ', name)
    return path


# 1. The background remover, replaced wholesale, and the attention shim.
compiles('rembg.py', shim('SHIM'))
compiles('chomugiri_sdpa.py', shim('SDPA_SHIM'))

# 2. The attention import, in the file the install rewrites.
attn_path = os.path.join(
    os.path.dirname(inf_path), 'pixal3d', 'modules', 'sparse', 'attention', 'full_attn.py')
want = 'from torch.nn.functional import scaled_dot_product_attention as _sdpa'
attn = io.open(attn_path, encoding='utf-8').read()
if attn.count(want) != 1:
    sys.exit('the sdpa import matched %d times in full_attn.py, not once' % attn.count(want))
compiles('full_attn.py', attn.replace(want, 'from chomugiri_sdpa import chunked_sdpa as _sdpa'))

# 3. Everything that edits inference.py -- the notebook's own function, lifted
#    out by name and run here. Its only dependency is MEMO_SHIM.
block = re.search(r'\ndef patch_inference\(inf\):\n(?:.*?\n)*?(?=\ndef \w)', nb)
if not block:
    sys.exit('the notebook no longer defines patch_inference')
scope = {'MEMO_SHIM': shim('MEMO_SHIM')}
exec(compile(block.group(0), 'patch_inference', 'exec'), scope)

inf = scope['patch_inference'](io.open(inf_path, encoding='utf-8').read())
compiles('inference.py', inf)

# The wrappers must exist, the originals must survive under their new names.
tree = ast.parse(inf)
top = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
for needed in ('init_pipeline', '_chomugiri_init_pipeline',
               'load_moge_model', '_chomugiri_load_moge_model'):
    if needed not in top:
        sys.exit('%s is not a module-level function after patching' % needed)
    print('defined               ', needed)


def line_of(name):
    for n in tree.body:
        if isinstance(n, ast.FunctionDef) and n.name == name:
            return n.lineno
        if isinstance(n, ast.Assign) and any(getattr(t, 'id', None) == name for t in n.targets):
            return n.lineno
    return None


# The wrappers' defaults are evaluated at def time, so the constants they name
# have to appear above them.
for const in ('MODEL_PATH', 'MOGE_MODEL_NAME'):
    where = line_of(const)
    if where is None or where > line_of('init_pipeline'):
        sys.exit('%s is not defined before the wrapper that defaults to it' % const)
    print('constant above wrapper', const, 'line', where)

# The originals must still be the real thing rather than an empty stub, and the
# settings the run depends on must be the ones a T4 can finish.
for name in ('_chomugiri_init_pipeline', '_chomugiri_load_moge_model'):
    body = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    if len(body.body) < 3:
        sys.exit('%s lost its body' % name)

for gone, why in [('"naf_target_size": 1024', 'the NAF upsample is still 4.29 GiB'),
                  ('decimation_target=1000000', 'the mesh still comes back at film size'),
                  ('texture_size=4096', 'the texture is still 4096')]:
    if gone in inf:
        sys.exit('%s: %r survived the patch' % (why, gone))
    print('gone                  ', gone)

print('ALL PIXAL3D PATCHES APPLY')
