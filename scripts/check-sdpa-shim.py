"""Prove the chunked-SDPA shim is real Python and returns torch's own numbers.

The shim exists because Pixal3D's full attention made torch's *math* backend
materialise a [1, H, 22k, 22k] score matrix -- 7.17 GiB in one allocation on a
Tesla T4 that has 14.56 GiB and the model already resident. It arrives an hour
into the run, after the weights have downloaded.

Splitting the query is only safe if it is exact, so this checks that rather
than assuming it: softmax is taken across the key axis independently per query
row, so attention over a slice of Q is attention over all of Q for those rows.

Reads the shim out of the notebook the TypeScript actually emits, so a shim
that stops being emitted fails here instead of an hour into a GPU run.
"""
import io
import py_compile
import re
import sys
import tempfile
import os

nb = io.open(sys.argv[1], encoding='utf-8').read()

found = re.search(r"SDPA_SHIM = '''(.*?)'''", nb, re.S)
if not found:
    sys.exit('the notebook no longer carries SDPA_SHIM')

work = tempfile.mkdtemp()
path = os.path.join(work, 'chomugiri_sdpa.py')
io.open(path, 'w', encoding='utf-8').write(found.group(1))
py_compile.compile(path, doraise=True)
print('shim compiles')

try:
    import torch
    from torch.nn.functional import scaled_dot_product_attention as ref
except ImportError:
    sys.exit('torch is not installed, so the numbers were not checked')

sys.path.insert(0, work)
import chomugiri_sdpa as shim

torch.manual_seed(0)
# Shapes in the spirit of the failure, plus the awkward ones: a query length
# that does not divide by the chunk, a single query row, a wide head.
for heads, lq, lkv, dim in [(8, 4096, 4096, 64), (8, 1000, 733, 64),
                            (4, 17, 17, 128), (8, 1, 900, 64)]:
    q = torch.randn(1, heads, lq, dim)
    k = torch.randn(1, heads, lkv, dim)
    v = torch.randn(1, heads, lkv, dim)
    want = ref(q, k, v)

    # Shrink the budget so the chunked path is the one under test; left alone
    # on CPU it would take the single-shot path and prove nothing.
    keep, shim.BUDGET = shim.BUDGET, heads * lkv * q.element_size() * 7
    got = shim.chunked_sdpa(q, k, v)
    shim.BUDGET = keep

    if got.shape != want.shape:
        sys.exit('shape changed: %s vs %s' % (tuple(got.shape), tuple(want.shape)))
    err = (got - want).abs().max().item()
    if err > 1e-5:
        sys.exit('chunking changed the answer by %g' % err)
    print('H=%d Lq=%d Lkv=%d C=%d  max abs diff %.3e' % (heads, lq, lkv, dim, err))

print('chunked SDPA matches torch')
