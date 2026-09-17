/**
 * Kaggle's free GPU, running Pixal3D.
 *
 * NVIDIA's hosted TRELLIS has answered nothing but stalls for the better part
 * of a day, and it was the only free text-to-3D in the chain. Kaggle gives
 * every account a **Tesla T4 with 15.6GB** and thirty hours a week of it, and
 * Pixal3D — TencentARC, SIGGRAPH 2026 — has released inference code and weights
 * that turn an image into a GLB with PBR textures. That is a real generator
 * that costs nobody anything, sitting behind an API this suite can drive.
 *
 * ── Measured, not assumed ───────────────────────────────────────────────────
 *
 * Push to complete for a GPU kernel that does nothing: **34 seconds**, of which
 * 18 was the queue. The image already has torch 2.10 and CUDA. So the fixed
 * cost is the weights and the dependencies, not Kaggle.
 *
 * ── Which is why this batches ───────────────────────────────────────────────
 *
 * The Kernels API is a batch system: you push a notebook, it queues, boots,
 * runs and stops. There is no endpoint to keep warm. Every run pays the setup
 * again, so asking for one model at a time pays it once per model — and a game
 * needs a character, a barrel, a crate, a gun.
 *
 * So the unit of work here is **every model a game needs, in one kernel**. The
 * cost is paid once and the marginal model is seconds. That is not a compromise
 * forced by the platform; for this pipeline it is the right shape anyway.
 *
 * ── Pixal3D takes an image ──────────────────────────────────────────────────
 *
 * It is image-to-3D, not text-to-3D — worth being exact about, because the
 * chain only works if something makes the image first. This suite already does:
 * FLUX on the NVIDIA key, or Pollinations with no key at all. Prompt → image →
 * GLB, out of two halves that each work today.
 */

/**
 * How Pixal3D is actually installed and invoked.
 *
 * Read off the repository rather than guessed — the first version of this file
 * assumed a `Pixal3DPipeline` Python class that does not exist. It is a command
 * line script, and the install has a step that compiles CUDA.
 */
export const PIXAL3D = {
  repo: 'https://github.com/TencentARC/Pixal3D',
  /** `master`, not `main`. `main` is a 404. */
  branch: 'master',
  /** Low-VRAM mode: 1024 rather than 1536, models loaded on demand. A T4 is 15.6GB. */
  resolution: 1024,
  /**
   * Kaggle's GPU is a Tesla T4, which is compute capability 7.5.
   *
   * `natten` compiles CUDA kernels at install time and needs to be told which
   * architecture for. Left unset it builds for everything, which on a shared
   * two-core builder is the difference between ten minutes and an hour.
   */
  cudaArch: '7.5',
  /** The `flash_attn` build is worse than the compile it replaces. SDPA is in torch. */
  attnBackend: 'sdpa',
  /**
   * How far NAF upsamples the DINOv3 feature map before it is point-sampled.
   *
   * The texture stage asks for 1024, and DINOv3 ViT-L has 1024 channels, so the
   * output tensor is 1024 x 1024 x 1024 floats -- 4.29 GiB, which is the 4.00 GiB
   * allocation that killed a run 71 minutes in.
   *
   * Dropping it to 512 is safe in a way that is worth stating: the map is
   * consumed immediately by `proj_grid`, which samples it with `grid_sample` at
   * normalised coordinates, so the result is [B, grid_res^3, D] whatever the map's
   * resolution. Nothing downstream changes shape. Pixal3D's own shape stage
   * already runs at 512; only the texture stage asks for 1024.
   */
  nafTargetSize: 512,
  /**
   * What Pixal3D is asked to hand back, rather than what it would hand back.
   *
   * Left alone it decimates to a million triangles and bakes a 4096 texture,
   * which is a film asset: the first barrel that came out was 943,904 triangles
   * and 37 MB. Twenty props like that is a 700 MB game, and the APK already
   * carries a 27 MB engine. It also spent nearly five minutes parameterising a
   * mesh that dense.
   *
   * These are game numbers. A prop seen from a few metres away does not need
   * more than this, and the mesh arrives usable instead of needing a pass
   * nothing in the pipeline does.
   */
  decimationTarget: 8000,
  textureSize: 1024,
  utils3d: 'https://github.com/LDYang694/Storages/releases/download/20260430/utils3d-0.0.2-py3-none-any.whl',
  /**
   * Microsoft MoGe, for the monocular depth pass.
   *
   * `inference.py` imports `moge.model.v2` and `requirements.txt` never mentions
   * it — so a setup that follows the documented steps exactly still stops here.
   */
  moge: 'git+https://github.com/microsoft/MoGe.git',
} as const;

/**
 * The one thing worth caching between runs.
 *
 * Everything in the install is a download except `natten`, which compiles CUDA
 * kernels — and that is most of the setup. Building it once into a wheel and
 * attaching that wheel to later runs turns a fifteen-minute compile into a
 * ten-second `pip install`.
 *
 * Cached as a *kernel output* rather than a dataset: the Kernels API can attach
 * another kernel's output directly, so it needs no second API surface, no
 * upload, and leaves one thing on the account instead of two.
 */
export const ENV_KERNEL = 'chomugiri-pixal3d-env';

/** What the setup run leaves behind for every later run to unpack. */
export const ENV_ARCHIVE = 'pixal3d-env.tar.gz';

export interface KaggleJob {
  /** The file this becomes, without an extension: `zombie` → `zombie.glb`. */
  name: string;
  /** The image Pixal3D lifts into 3D, as raw bytes. */
  image: Uint8Array;
  /** Shown in the log so a failed job is identifiable. */
  prompt?: string;
}

export interface KaggleResult {
  models: Array<{ name: string; bytes: Uint8Array }>;
  /** Everything the kernel printed, for when the reason is not a known one. */
  log: string;
  error?: string;
  /** Where to look at the run, which is the fastest way to see what happened. */
  url?: string;
  seconds: number;
}

const API = 'https://www.kaggle.com/api/v1';

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' };
}

/**
 * Whether a token is one of Kaggle's, before it is spent finding out.
 *
 * Two shapes are in circulation: the newer `KGAT_…` API tokens, and the legacy
 * `kaggle.json` key, which is 32 hex characters. Both go in the same field, so
 * neither is rejected — but something that is obviously neither is worth
 * catching in the settings pane rather than as a 401 ten minutes into a build.
 */
export function looksLikeToken(token: string): boolean {
  const t = token.trim();
  if (t.startsWith('KGAT_')) return t.length > 20;
  return /^[0-9a-f]{32}$/i.test(t);
}

/** Who the token belongs to. The username is half of every other call's path. */
export async function whoAmI(token: string, signal?: AbortSignal): Promise<{ user?: string; error?: string }> {
  try {
    const res = await fetch(`${API}/hello`, { headers: headers(token), ...(signal ? { signal } : {}) });
    if (res.status === 401 || res.status === 403) {
      return { error: 'Kaggle rejected that token. Generate a new one at kaggle.com/settings → API Tokens.' };
    }
    if (!res.ok) return { error: `Kaggle answered ${res.status}.` };
    const json = (await res.json()) as { userName?: string };
    if (!json.userName) return { error: 'Kaggle accepted the token but did not say who it belongs to.' };
    return { user: json.userName };
  } catch (err) {
    return { error: `Could not reach Kaggle: ${(err as Error).message}` };
  }
}

/**
 * The install.
 *
 * Pixal3D is built on TRELLIS.2 and its README's step one is "follow the
 * TRELLIS.2 installation" — which is not a `pip install`. It is a `setup.sh`
 * that compiles five CUDA extensions: cumesh, o-voxel, flexgemm, nvdiffrast and
 * nvdiffrec. Skipping it gets you all the way to `import cumesh` and then a
 * `ModuleNotFoundError`, which is exactly how far the first attempt got.
 *
 * `--new-env` is dropped because Kaggle already is the environment, and
 * `--flash-attn` because it is another long CUDA build and torch's own SDPA
 * does the same job.
 */
function installScript(withCache: boolean): string {
  return `
CACHE = "/kaggle/input"

MEMO_SHIM = '''_CHOMUGIRI_CACHE = {}


def init_pipeline(model_path=MODEL_PATH, device="cuda", low_vram=False):
    """Build the pipeline once per process instead of once per call.

    Measured on a real run: 230 minutes end to end, of which 28 were the four
    sampling stages and the GLB extraction. The rest went into this function --
    the Pixal3D checkpoints, four DINOv3 ViT-L feature extractors, the NAF
    upsampler and MoGe, downloaded and constructed from nothing.

    Nothing upstream caches it, so a server that answers two requests pays that
    twice and is no faster than two separate runs. This is what makes holding
    the process open worth anything.
    """
    key = ("pipeline", model_path, device, low_vram)
    if key not in _CHOMUGIRI_CACHE:
        _CHOMUGIRI_CACHE[key] = _chomugiri_init_pipeline(model_path, device, low_vram)
    return _CHOMUGIRI_CACHE[key]


def load_moge_model(device="cuda", model_name=MOGE_MODEL_NAME):
    """Same, for the depth pass.

    run_inference moves MoGe to the CPU and drops its reference once the camera
    is estimated. That frees the VRAM, which is the point, and it does not
    destroy the weights -- the cache still holds them, and the original moves
    them back to the GPU on the next call.
    """
    key = ("moge", model_name)
    if key not in _CHOMUGIRI_CACHE:
        _CHOMUGIRI_CACHE[key] = _chomugiri_load_moge_model(device, model_name)
        return _CHOMUGIRI_CACHE[key]
    return _CHOMUGIRI_CACHE[key].to(device)
'''

SHIM = '''from PIL import Image


class BiRefNet:
    """Chomugiri stand-in for Pixal3D background remover.

    The real one loads briaai/RMBG-2.0, which is gated on HuggingFace, and it
    is constructed *eagerly* in Pipeline.from_pretrained, before any image is
    looked at. So cutting the image out beforehand is not enough on its own:
    the run dies loading a model it was never going to need.

    This satisfies the construction and nothing else. Every image that reaches
    the pipeline already has an alpha channel, so preprocess_image takes the
    has_alpha branch and never calls this.
    """

    def __init__(self, model_name: str = ""):
        self.model = None
        self.model_name = model_name

    def to(self, *args, **kwargs):
        # The pipeline moves it to the GPU whether or not it is ever used.
        return self

    def __call__(self, image):
        raise RuntimeError(
            "The background remover was called, which means an image arrived "
            "without an alpha channel. Chomugiri cuts them out before sending."
        )
'''


SDPA_SHIM = '''import torch
from torch.nn.functional import scaled_dot_product_attention as _torch_sdpa

try:
    from torch.nn.attention import SDPBackend, sdpa_kernel
except ImportError:  # pragma: no cover - older torch
    SDPBackend = sdpa_kernel = None

# Biggest score matrix the math backend may hold at once, in bytes.
BUDGET = 1 << 30


def chunked_sdpa(q, k, v):
    """Torch SDPA that cannot allocate an L-by-L score matrix on a T4.

    Pixal3D asks for full attention over every sparse token. At resolution
    1024 the HR shape stage reaches roughly twenty-two thousand of them, and
    torch's *math* backend materialises the whole [1, H, Lq, Lkv] matrix:
    7.17 GiB in a single allocation, on a card with 14.56 GiB and the model
    already resident. That is the out-of-memory error, and it arrives an hour
    in, after the weights have downloaded and three stages have run.

    The memory-efficient CUTLASS kernel never builds that matrix and it does
    support sm_75, so ask for it by name instead of hoping torch picks it.

    When it is unavailable for these shapes torch raises rather than quietly
    falling back, so the query is split instead. Attention over a slice of Q
    equals attention over the whole of Q for those rows -- softmax is taken
    across the key axis, independently per query row -- so the slices are
    concatenated, not combined. Same numbers, bounded peak.
    """
    if sdpa_kernel is not None:
        try:
            with sdpa_kernel(SDPBackend.EFFICIENT_ATTENTION):
                return _torch_sdpa(q, k, v)
        except (RuntimeError, torch.cuda.OutOfMemoryError):
            pass

    heads, lq, lkv = q.shape[1], q.shape[-2], k.shape[-2]
    per_row = max(1, heads * lkv * q.element_size())
    rows = max(1, min(lq, BUDGET // per_row))
    if rows >= lq:
        return _torch_sdpa(q, k, v)
    return torch.cat(
        [_torch_sdpa(q[:, :, i:i + rows], k, v) for i in range(0, lq, rows)],
        dim=-2,
    )
'''


def patch_inference(inf):
    """Every edit Chomugiri makes to Pixal3D's inference.py.

    A function taking and returning a string, rather than something that reads
    and writes the file in place, so it can be run against a real checkout
    without booking a GPU. That matters more than it sounds: a check that
    re-implements these edits instead of calling this passes happily while the
    real thing is broken, which is exactly what happened -- twice, both times
    an escape eaten by the TypeScript template literal that emits this file.
    """
    # The NAF upsample that ran the card out of memory a stage after the
    # attention did.
    big = '"naf_target_size": 1024,'
    if inf.count(big) != 1:
        raise SystemExit(
            "PIXAL3D_UNAVAILABLE: the NAF target size moved, so the memory fix "
            "would not have applied (found %d matches)" % inf.count(big)
        )
    inf = inf.replace(big, '"naf_target_size": ${PIXAL3D.nafTargetSize},')
    # And the film-sized mesh it would otherwise hand back.
    heavy = "decimation_target=1000000, texture_size=4096,"
    if inf.count(heavy) != 1:
        raise SystemExit(
            "PIXAL3D_UNAVAILABLE: the GLB extraction settings moved, so the mesh "
            "would have come back at film size (found %d matches)" % inf.count(heavy)
        )
    inf = inf.replace(
        heavy,
        "decimation_target=${PIXAL3D.decimationTarget}, texture_size=${PIXAL3D.textureSize},",
    )
    # And the two loaders that rebuild every weight on every call.
    # Single-quoted on purpose: these carry double quotes of their own, and a
    # backslash escape here is eaten by the TypeScript template literal that
    # emits this file long before Python ever sees it.
    for name in ('init_pipeline(model_path=MODEL_PATH, device="cuda", low_vram=False)',
                 'load_moge_model(device="cuda", model_name=MOGE_MODEL_NAME)'):
        head = "def " + name + ":"
        if inf.count(head) != 1:
            raise SystemExit(
                "PIXAL3D_UNAVAILABLE: %s moved, so every request would have "
                "rebuilt the weights (found %d matches)" % (name.split("(")[0], inf.count(head))
            )
        inf = inf.replace(head, "def _chomugiri_" + name + ":")
    # The wrappers go in after the constants they close over and before the
    # first caller; module scope is fine because Python binds names at call time.
    inf = inf.replace("def _chomugiri_load_moge_model", MEMO_SHIM + "\\n\\ndef _chomugiri_load_moge_model", 1)
    return inf


def install():
    sh("git clone --depth 1 -b ${PIXAL3D.branch} ${PIXAL3D.repo} /kaggle/tmp/pixal3d")
    # Replaced before anything imports it.
    with open("/kaggle/tmp/pixal3d/pixal3d/pipelines/rembg/__init__.py", "w") as fh:
        fh.write(SHIM)
    # And the attention call that ran the T4 out of memory an hour in.
    with open("/kaggle/tmp/pixal3d/chomugiri_sdpa.py", "w") as fh:
        fh.write(SDPA_SHIM)
    attn = "/kaggle/tmp/pixal3d/pixal3d/modules/sparse/attention/full_attn.py"
    with open(attn) as fh:
        body = fh.read()
    want = "from torch.nn.functional import scaled_dot_product_attention as _sdpa"
    if body.count(want) != 1:
        # Loud, because a silent no-op here costs an hour of GPU time and then
        # fails with the same out-of-memory error as before the fix.
        raise SystemExit(
            "PIXAL3D_UNAVAILABLE: the sdpa import moved, so the memory fix "
            "would not have applied (found %d matches)" % body.count(want)
        )
    with open(attn, "w") as fh:
        fh.write(body.replace(want, "from chomugiri_sdpa import chunked_sdpa as _sdpa"))
    # And the edits to inference.py, all of them.
    with open("/kaggle/tmp/pixal3d/inference.py") as fh:
        inf = fh.read()
    with open("/kaggle/tmp/pixal3d/inference.py", "w") as fh:
        fh.write(patch_inference(inf))
${
    withCache
      ? `    # The environment a previous run compiled, attached as an input. Everything
    # below it is a CUDA build measured in tens of minutes.
    packed = glob.glob(CACHE + "/**/${ENV_ARCHIVE}", recursive=True)
    if packed:
        print("restoring the compiled environment from", packed[0], flush=True)
        restored = sh("tar -xzf " + packed[0] + " -C /usr/local/lib/python3.12/dist-packages").returncode
        if restored != 0:
            # A restore that failed and was not noticed is the worst case: the
            # run carries on, imports the extension that was supposed to be in
            # there, and reports a ModuleNotFoundError from somewhere that looks
            # nothing like a broken cache. Which is exactly what happened.
            print("the cached environment would not unpack — compiling instead", flush=True)
            _compile()
    else:
        print("no cached environment — compiling, which takes the better part of an hour", flush=True)
        _compile()`
      : `    _compile()`
  }
    sh("pip install -q -r /kaggle/tmp/pixal3d/requirements.txt")
    sh("pip install -q ${PIXAL3D.utils3d}")
    # MoGe, which inference.py imports for the depth pass and requirements.txt
    # does not mention. Pure Python, so it is a download rather than a build and
    # belongs here with the other seconds-long steps rather than in the cache.
    sh("pip install -q ${PIXAL3D.moge}")


def _compile():
    sh("git clone --depth 1 -b main --recursive https://github.com/microsoft/TRELLIS.2.git /kaggle/tmp/trellis2")
    # No --new-env: Kaggle already is the environment. No --flash-attn: it is
    # another long CUDA build and torch's own SDPA does the same job.
    # nvdiffrec is left out on purpose. It is a differentiable renderer used for
    # texture baking, its wheel does not build on Kaggle's image — "Failed
    # building wheel for nvdiffrec_render" — and inference does not import it.
    # Asking for it means the whole setup.sh returns non-zero and every other
    # extension's success is hidden behind one failure that does not matter.
    sh("cd /kaggle/tmp/trellis2 && . ./setup.sh --basic --nvdiffrast --cumesh --o-voxel --flexgemm",
       executable="/bin/bash")
    wheels = glob.glob(CACHE + "/**/natten-*.whl", recursive=True)
    if wheels:
        sh("pip install -q --no-deps " + wheels[0])
    else:
        sh("NATTEN_CUDA_ARCH='${PIXAL3D.cudaArch}' NATTEN_N_WORKERS=2 pip install -q natten==0.21.0 --no-build-isolation")
`;
}

const PREAMBLE = `import base64, glob, json, os, subprocess, sys, time, traceback

START = time.time()
OUT = "/kaggle/working"
os.makedirs(OUT, exist_ok=True)
os.makedirs("/kaggle/tmp", exist_ok=True)

def sh(cmd, **kw):
    print("$", cmd, flush=True)
    return subprocess.run(cmd, shell=True, check=False, **kw)

print("python", sys.version, flush=True)
sh("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader")
`;

/**
 * The setup run: compile `natten` once and keep the wheel.
 *
 * Run on its own, before any generation, because it is the only slow part and
 * there is no reason for a user waiting on a game to also wait on a compiler.
 */
export function setupNotebook(): string {
  return `# Generated by Chomugiri. Compiles everything that has to be compiled, once.
${PREAMBLE}
SITE = "/usr/local/lib/python3.12/dist-packages"

def listing():
    return set(os.listdir(SITE))

before = listing()
${installScript(false).replace('def install():', 'def _unused():')}
_compile()
after = listing()

# Whatever the compile added, packed up. Naming the packages by hand would go
# stale the moment TRELLIS.2 adds a sixth extension; a diff cannot.
added = sorted(after - before)
print("compiled:", added, flush=True)
# gzip, not zstd. **zstd is not installed on Kaggle's image** — tar -I zstd
# answers "Cannot exec: No such file or directory" and writes nothing, on both
# ends. The first attempt read that as a compression-level problem and tuned the
# level, which was a confident fix to a diagnosis that was simply wrong: the
# archive had never been written at all.
#
# gzip is bigger and slower and is on every machine that has tar.
packed = 1
if added:
    packed = sh("tar -czf /kaggle/working/${ENV_ARCHIVE} -C " + SITE + " " + " ".join("'" + a + "'" for a in added)).returncode

# The exit code *is* checked here, unlike Godot's: tar means it. An archive that
# was half written is worse than none, because every later run would restore it
# and fail somewhere unrelated.
failed = []
if packed != 0:
    failed.append({"name": "archive", "why": "tar exited %s — the cache is incomplete" % packed})
if not glob.glob("/kaggle/working/${ENV_ARCHIVE}"):
    failed.append({"name": "environment", "why": "nothing was written"})

print("CHOMUGIRI_RESULT", json.dumps({
    "models": [],
    "failed": failed,
    "packed": added,
    "seconds": round(time.time() - START, 1),
}), flush=True)
`;
}

/**
 * The server run.
 *
 * Same install, same patches, same weights — but the process stays open and
 * answers requests instead of doing one job and dying. That is worth doing
 * because of where the time goes: on the run that produced a mesh, 28 minutes
 * of the 230 were the sampling stages. The other 200 were `init_pipeline`, and
 * a batch run pays them again for every model.
 *
 * Two things are not obvious and both are load-bearing.
 *
 * Kaggle does not publish a running kernel's log. Checked twice: `kernelOutput`
 * on a running kernel answers with no files and an empty log. So the share URL
 * cannot be read out of the log the way a finished run's result is — the
 * notebook has to push it out itself, which is what `register` is for. The
 * nonce is generated per push and is good for one registration, so nothing
 * reusable travels inside a notebook.
 *
 * And the GPU quota is thirty hours a week, which an idle server spends as
 * happily as a busy one. `idleMinutes` is not a nicety; without it one session
 * is a third of the week.
 */
export function gradioNotebook(
  options: {
    nonce: string;
    register: string;
    cached?: boolean;
    idleMinutes?: number;
  },
): string {
  const idle = options.idleMinutes ?? 25;
  return `# Generated by Chomugiri. Holds Pixal3D open and answers requests.
${PREAMBLE}
NONCE = ${JSON.stringify(options.nonce)}
REGISTER = ${JSON.stringify(options.register)}
IDLE_SECONDS = ${idle * 60}
${installScript(options.cached ?? false)}
install()

sh("pip install -q gradio")

sys.path.insert(0, "/kaggle/tmp/pixal3d")
os.chdir("/kaggle/tmp/pixal3d")
import inference

import gradio as gr
import torch
from PIL import Image

LAST_USED = [time.time()]


def warm():
    """Pay the 200 minutes once, before anyone is waiting on a request.

    Without this the first caller waits for the whole download and concludes the
    server is broken. It also proves the memoising wrappers took: if they did
    not, this costs the same time again on the first real request.
    """
    print("warming: building the pipeline and MoGe", flush=True)
    began = time.time()
    inference.init_pipeline(low_vram=True)
    inference.load_moge_model(device="cuda")
    print("warm in %.0f seconds" % (time.time() - began), flush=True)


def to_glb(image, seed):
    """One request: an image in, a path to a .glb out."""
    if image is None:
        raise gr.Error("Send an image.")
    LAST_USED[0] = time.time()
    began = time.time()
    stamp = str(int(began * 1000))
    src = os.path.join("/kaggle/tmp", "in_" + stamp + ".png")
    dst = os.path.join(OUT, "out_" + stamp + ".glb")

    # Alpha here for the same reason the batch run cuts it out: without it the
    # pipeline reaches for the gated background remover.
    img = Image.open(image) if isinstance(image, str) else image
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    img.save(src)

    try:
        inference.run_inference(
            image_path=src, output_path=dst, seed=int(seed),
            low_vram=True, resolution=${PIXAL3D.resolution},
        )
    except torch.cuda.OutOfMemoryError as exc:
        torch.cuda.empty_cache()
        raise gr.Error("The GPU ran out of memory: %s" % exc)
    finally:
        if os.path.exists(src):
            os.remove(src)
        LAST_USED[0] = time.time()

    if not os.path.exists(dst):
        raise gr.Error("The run finished and wrote no mesh.")
    print("served %s in %.0f seconds" % (dst, time.time() - began), flush=True)
    return dst


def tell_chomugiri(url):
    """Hand the share URL back, because the log will not.

    Kaggle publishes a kernel's log when the kernel finishes, and this one does
    not finish — so printing the URL puts it somewhere nobody can read until it
    has stopped being useful.
    """
    import urllib.error
    import urllib.request
    body = json.dumps({"nonce": NONCE, "url": url}).encode("utf-8")
    for attempt in range(5):
        try:
            request = urllib.request.Request(
                REGISTER, data=body, method="POST",
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=30) as answer:
                print("registered:", answer.status, flush=True)
                return True
        except Exception as exc:
            print("register attempt %d failed: %s" % (attempt + 1, exc), flush=True)
            time.sleep(5 * (attempt + 1))
    # Not fatal: the URL is still printed, and a user watching an interactive
    # session can copy it even when the registration never lands.
    print("could not register; the URL above is the only copy", flush=True)
    return False


warm()

with gr.Blocks(title="Chomugiri 3D") as app:
    gr.Markdown("### Chomugiri — image to 3D\\nPixal3D on a Kaggle T4. One image in, a .glb out.")
    with gr.Row():
        picture = gr.Image(type="pil", label="Image")
        mesh = gr.Model3D(label="Mesh")
    seed = gr.Number(value=42, precision=0, label="Seed")
    gr.Button("Generate", variant="primary").click(to_glb, [picture, seed], mesh)

app.queue(max_size=8)
_, _, share = app.launch(share=True, prevent_thread_lock=True, quiet=False)
print("CHOMUGIRI_GRADIO", share, flush=True)
tell_chomugiri(share)

# Kaggle kills the session at its own limit; this is about the quota, not the
# limit. Thirty hours a week goes just as fast idle as busy.
while time.time() - LAST_USED[0] < IDLE_SECONDS:
    time.sleep(20)
print("CHOMUGIRI_RESULT " + json.dumps({
    "models": [], "failed": [],
    "why": "shut down after %d idle minutes" % (IDLE_SECONDS // 60),
    "seconds": round(time.time() - START, 1),
}), flush=True)
app.close()
`;
}

/**
 * The generate run.
 *
 * Every image is inlined as base64 rather than uploaded as a dataset. A dataset
 * is another API surface, another thing to clean up, and another thing left
 * behind on someone's account; a 768px image is a couple of hundred kilobytes
 * and the source field takes it.
 *
 * Written to fail *loudly and individually*: one model that will not generate
 * should not lose the other five, so each is tried in turn and the failures are
 * reported at the end rather than raised.
 */
export function pixal3dNotebook(
  jobs: KaggleJob[],
  toBase64: (bytes: Uint8Array) => string,
  options: { cached?: boolean } = {},
): string {
  const inputs = jobs.map((job) => ({ name: job.name, b64: toBase64(job.image), prompt: job.prompt ?? '' }));

  return `# Generated by Chomugiri. Runs Pixal3D on this kernel's GPU.
${PREAMBLE}
JOBS = json.loads(${JSON.stringify(JSON.stringify(inputs))})
${installScript(options.cached ?? false)}
install()

results = {"models": [], "failed": [], "seconds": 0}
ok = os.path.exists("/kaggle/tmp/pixal3d/inference.py")
if not ok:
    print("PIXAL3D_UNAVAILABLE: inference.py is not where the repository says it is", flush=True)

def cut_out(path):
    """Give the image an alpha channel, so Pixal3D never reaches for RMBG.

    Its preprocess step reads:

        if input.mode == 'RGBA' and not np.all(alpha == 255): use it as-is
        else:                                                  self.rembg_model(input)

    and that rembg model is briaai/RMBG-2.0, which is **gated on HuggingFace**:
    without a token whose account has accepted the licence, the run dies with
    "You are trying to access a gated repo" after five minutes of setup.

    An alpha channel sidesteps it entirely, and the images this suite sends are
    generated to order with "plain white background" in the prompt — so the
    background is knowable. Flood-filled from the four corners rather than
    thresholded on brightness: a threshold also erases every white part *of the
    object*, and a white barrel would come back as a hoop.
    """
    from PIL import Image, ImageDraw
    import numpy as np

    img = Image.open(path).convert("RGBA")
    pixels = np.array(img)
    if not np.all(pixels[:, :, 3] == 255):
        return  # Already cut out. Leave it alone.

    # A scratch layer to flood: black where the background reaches, white else.
    mask = Image.new("L", img.size, 255)
    flat = img.convert("RGB")
    for corner in [(0, 0), (img.width - 1, 0), (0, img.height - 1), (img.width - 1, img.height - 1)]:
        work = flat.copy()
        ImageDraw.floodfill(work, corner, (255, 0, 255), thresh=42)
        hit = np.all(np.array(work) == (255, 0, 255), axis=-1)
        m = np.array(mask)
        m[hit] = 0
        mask = Image.fromarray(m)

    reached = np.array(mask)
    # A flood that swallowed nearly everything found an object the same colour
    # as its background. Better to hand over the original and let the run fail
    # honestly than to hand over an empty image and get an empty mesh.
    if (reached == 0).mean() > 0.92:
        print("  background fill took the whole image — leaving", path, "as it is", flush=True)
        return
    pixels[:, :, 3] = reached
    Image.fromarray(pixels).save(path)
    print("  cut out %s (%.0f%% background)" % (path, (reached == 0).mean() * 100), flush=True)


for job in JOBS:
    name = job["name"]
    src = os.path.join("/kaggle/tmp", name + ".png")
    with open(src, "wb") as fh:
        fh.write(base64.b64decode(job["b64"]))
    try:
        cut_out(src)
    except Exception as exc:
        # Not fatal: without an alpha channel the run reaches for the gated
        # model and fails there, which is a clearer error than this one.
        print("  could not cut out", name, "-", exc, flush=True)
    if not ok:
        results["failed"].append({"name": name, "why": "Pixal3D did not install"})
        continue
    try:
        print("generating", name, job.get("prompt", ""), flush=True)
        t0 = time.time()
        glb = os.path.join(OUT, name + ".glb")
        # The documented invocation, not an imagined Python API. ATTN_BACKEND
        # is sdpa because flash_attn is another CUDA build and torch already
        # ships an attention that works — through chomugiri_sdpa, which keeps
        # it from materialising a score matrix the T4 cannot hold.
        # expandable_segments is what the out-of-memory error itself asks for:
        # the stages free tensors of very different sizes, and without it the
        # card runs out of contiguous block long before it runs out of memory.
        run = sh(
            "cd /kaggle/tmp/pixal3d && PYTORCH_ALLOC_CONF=expandable_segments:True"
            " ATTN_BACKEND=${PIXAL3D.attnBackend} python inference.py"
            " --image " + src + " --output " + glb +
            " --low_vram --resolution ${PIXAL3D.resolution}"
        )
        if os.path.exists(glb) and os.path.getsize(glb) > 0:
            results["models"].append({"name": name, "bytes": os.path.getsize(glb), "seconds": round(time.time() - t0, 1)})
            print("  ->", name + ".glb", os.path.getsize(glb), "bytes", flush=True)
        else:
            results["failed"].append({"name": name, "why": "the run exited %s and wrote no mesh" % run.returncode})
    except Exception as exc:
        results["failed"].append({"name": name, "why": str(exc)})
        traceback.print_exc()

results["seconds"] = round(time.time() - START, 1)
with open(os.path.join(OUT, "chomugiri.json"), "w") as fh:
    json.dump(results, fh)
print("CHOMUGIRI_RESULT", json.dumps(results), flush=True)
`;
}

/** Push a notebook. Returns the slug it now lives at. */
export async function pushKernel(
  token: string,
  options: {
    user: string;
    slug: string;
    title: string;
    source: string;
    gpu?: boolean;
    /**
     * Other kernels' outputs to mount under `/kaggle/input`, as `user/slug`.
     *
     * This is how the compiled `natten` wheel reaches a generate run without a
     * dataset: the Kernels API attaches another kernel's output directly.
     */
    inputs?: string[];
    signal?: AbortSignal;
  },
): Promise<{ url?: string; slug?: string; error?: string }> {
  const body = {
    id: null,
    slug: `${options.user}/${options.slug}`,
    newTitle: options.title,
    text: options.source,
    language: 'python',
    kernelType: 'script',
    // Private, always. Someone's game assets are not a public notebook.
    isPrivate: true,
    enableGpu: options.gpu ?? true,
    // Needed: the weights are downloaded at run time.
    enableInternet: true,
    datasetDataSources: [],
    competitionDataSources: [],
    kernelDataSources: options.inputs ?? [],
    modelDataSources: [],
    categoryIds: [],
  };

  try {
    const res = await fetch(`${API}/kernels/push`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!res.ok) return { error: `Kaggle refused the notebook (${res.status}).` };
    const json = (await res.json()) as { url?: string; ref?: string; error?: string };
    // The API answers 200 with an `error` string rather than a status code, so
    // the status is not the check. It never is.
    if (json.error) return { error: json.error };

    // **The slug Kaggle used, not the one that was asked for.** It derives the
    // slug from `newTitle`, so `chomugiri-glb-run-m2x8q4k1` went up as plain
    // `chomugiri-glb-run` — and every status poll afterwards asked about a
    // notebook that does not exist, got `unknown`, and waited the full forty
    // minutes for a run that had finished in one.
    //
    // `url` is already absolute, which is the other half of the same lesson:
    // prefixing it produced `https://www.kaggle.comhttps://www.kaggle.com/…`.
    const ref = json.ref ?? (json.url ? new URL(json.url).pathname : '');
    const slug = ref.split('/').filter(Boolean).pop();
    return {
      ...(json.url ? { url: json.url } : {}),
      ...(slug ? { slug } : {}),
    };
  } catch (err) {
    return { error: `Could not reach Kaggle: ${(err as Error).message}` };
  }
}

export type KernelStatus = 'queued' | 'running' | 'complete' | 'error' | 'cancelled' | 'unknown';

export async function kernelStatus(
  token: string,
  user: string,
  slug: string,
  signal?: AbortSignal,
): Promise<{ status: KernelStatus; message?: string }> {
  try {
    const res = await fetch(`${API}/kernels/status?userName=${encodeURIComponent(user)}&kernelSlug=${encodeURIComponent(slug)}`, {
      headers: headers(token),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return { status: 'unknown', message: `Kaggle answered ${res.status}.` };
    const json = (await res.json()) as { status?: string; failureMessage?: string };
    const status = (json.status ?? '').toLowerCase();
    const known: KernelStatus[] = ['queued', 'running', 'complete', 'error', 'cancelled'];
    return {
      status: (known.includes(status as KernelStatus) ? status : 'unknown') as KernelStatus,
      ...(json.failureMessage ? { message: json.failureMessage } : {}),
    };
  } catch (err) {
    return { status: 'unknown', message: (err as Error).message };
  }
}

export interface KernelOutput {
  files: Array<{ name: string; url?: string; text?: string }>;
  log: string;
}

/** What the run printed, and what it left in `/kaggle/working`. */
export async function kernelOutput(
  token: string,
  user: string,
  slug: string,
  signal?: AbortSignal,
): Promise<KernelOutput> {
  const res = await fetch(`${API}/kernels/output?userName=${encodeURIComponent(user)}&kernelSlug=${encodeURIComponent(slug)}`, {
    headers: headers(token),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) return { files: [], log: `Kaggle answered ${res.status} for the output.` };
  const json = (await res.json()) as {
    files?: Array<{ fileName?: string; fileNameNullable?: string; url?: string; urlNullable?: string }>;
    logNullable?: string;
    log?: string;
  };
  // `urlNullable`, not `url` — Kaggle suffixes the nullable fields and leaves
  // the plain ones empty, so reading the obvious name gets an empty string and
  // a download of nothing. The URL is pre-signed: it carries its own
  // credentials and must *not* be sent the Authorization header.
  return {
    files: (json.files ?? []).map((f) => {
      const name = f.fileNameNullable ?? f.fileName ?? '';
      const url = f.urlNullable ?? f.url ?? '';
      return { name, ...(url ? { url } : {}) };
    }),
    log: readLog(json.logNullable ?? json.log ?? ''),
  };
}

/**
 * Kaggle's log is JSON inside a JSON string.
 *
 * Each entry is `{stream_name, time, data}`. Flattened here so what reaches a
 * user is what the kernel printed, not a transport format.
 */
export function readLog(raw: string): string {
  if (!raw.trim()) return '';
  try {
    const entries = JSON.parse(raw) as Array<{ stream_name?: string; data?: string }>;
    return entries.map((e) => e.data ?? '').join('');
  } catch {
    return raw;
  }
}

/** The result line the notebook prints, pulled back out of the log. */
export function resultFromLog(log: string): { models: Array<{ name: string; bytes: number }>; failed: Array<{ name: string; why: string }> } | null {
  const match = /CHOMUGIRI_RESULT (\{.*\})/.exec(log);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as { models: Array<{ name: string; bytes: number }>; failed: Array<{ name: string; why: string }> };
  } catch {
    return null;
  }
}

/**
 * A slug that is unique per run and legal for Kaggle.
 *
 * Time *and* a random tail. A timestamp alone collides for two runs started in
 * the same millisecond, and a collision does not error — it silently pushes a
 * new version over the other run's notebook, so one of the two builds quietly
 * gets the other's models.
 */
export function slugFor(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const tail = Math.random().toString(36).slice(2, 7);
  return `chomugiri-${base || 'assets'}-${Date.now().toString(36)}${tail}`;
}

/**
 * Why a run is not going to happen, in words worth showing someone who asked.
 */
export function unavailable(token: string | undefined): string | null {
  if (!token?.trim()) {
    return 'Kaggle needs an API token. Generate one at kaggle.com/settings → API Tokens and paste it into Settings → API Keys.';
  }
  if (!looksLikeToken(token)) {
    return 'That does not look like a Kaggle token — they start with `KGAT_`, or are 32 hex characters for the older kind.';
  }
  return null;
}

/**
 * The whole run: push, wait, bring the meshes home.
 *
 * Polling rather than a webhook, because there is nothing to call back to —
 * this runs in a browser tab and in a WebView. The interval starts tight and
 * loosens: the queue is usually seconds, the weights are usually minutes, and
 * asking every two seconds for twenty minutes is rude to a free service.
 */
export async function generateOnKaggle(
  token: string,
  jobs: KaggleJob[],
  options: {
    toBase64: (bytes: Uint8Array) => string;
    /** Names the run on their account, so it is identifiable later. */
    label?: string;
    onStage?: (message: string) => void;
    /** Long, because the first run downloads several gigabytes of weights. */
    timeoutMs?: number;
    /**
     * Compile the environment inside this run when it has not been cached yet.
     *
     * Off by default, and the default is the honest one: it is half an hour of
     * CUDA builds, and a caller who did not ask for that should be told rather
     * than made to wait through it.
     */
    compileIfMissing?: boolean;
    signal?: AbortSignal;
  },
): Promise<KaggleResult> {
  const began = Date.now();
  const seconds = (): number => Math.round((Date.now() - began) / 1000);

  const blocked = unavailable(token);
  if (blocked) return { models: [], log: '', error: blocked, seconds: 0 };
  if (!jobs.length) return { models: [], log: '', error: 'Nothing to generate.', seconds: 0 };

  const me = await whoAmI(token, options.signal);
  if (!me.user) return { models: [], log: '', error: me.error ?? 'Kaggle did not say who the token belongs to.', seconds: seconds() };

  const slug = slugFor(options.label ?? 'assets');
  options.onStage?.(`Sending ${jobs.length} model${jobs.length === 1 ? '' : 's'} to a Kaggle GPU.`);

  // Has the environment ever been built on this account?
  //
  // Attaching a kernel that does not exist is not harmless: the notebook falls
  // through to compiling, which its own log calls "the better part of an hour",
  // against a thirty-minute deadline. Every run would time out, every time, and
  // the error would be about the clock rather than about the missing cache.
  //
  // So it is checked, and when it is absent the caller is told what to do about
  // it rather than left to wait.
  const cachedState = await kernelStatus(token, me.user, ENV_KERNEL, options.signal);
  const cached = `${me.user}/${ENV_KERNEL}`;
  const haveCache = cachedState.status === 'complete';
  if (!haveCache && !options.compileIfMissing) {
    return {
      models: [],
      log: '',
      error:
        `The Pixal3D environment has not been built on this Kaggle account yet. ` +
        `It compiles five CUDA extensions and takes about half an hour, once. ` +
        `Run the setup first — \`setupNotebook()\` as the kernel "${ENV_KERNEL}" — ` +
        `or pass compileIfMissing to build it inside this run and wait.`,
      seconds: seconds(),
    };
  }
  const pushed = await pushKernel(token, {
    user: me.user,
    slug,
    // **The title is what Kaggle slugifies**, so the unique part has to be in
    // it. Passing a unique slug under a reused title asks for a notebook that
    // does not exist while the title points at one that does, and the push
    // comes back 409 — after the setup has already been paid for.
    title: slug.replace(/-/g, ' '),
    source: pixal3dNotebook(jobs, options.toBase64, { cached: haveCache }),
    ...(haveCache ? { inputs: [cached] } : {}),
    gpu: true,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (pushed.error) return { models: [], log: '', error: pushed.error, seconds: seconds() };
  // Everything after this asks about the slug Kaggle actually made.
  const live = pushed.slug ?? slug;

  // The cached run got thirty minutes on the assumption that the cache is what
  // makes a run slow. It is not. The cache holds compiled CUDA extensions, so
  // restoring it skips the build — and nothing else. The weights still download
  // and the three sampling stages still run: a *cached* run reached the
  // attention stage at 57 minutes. Thirty was cutting off runs that were
  // working and calling them timeouts.
  //
  // So the cache buys the compile back and that is all it is credited with.
  const budgetMs = options.timeoutMs ?? (haveCache ? 90 : 150) * 60_000;
  const deadline = Date.now() + budgetMs;
  let wait = 4_000;
  let last = '';
  let unknowns = 0;
  for (;;) {
    if (Date.now() > deadline) {
      return {
        models: [],
        log: '',
        error: `The Kaggle run did not finish within ${Math.round(budgetMs / 60_000)} minutes. It may still be going — ${pushed.url}`,
        ...(pushed.url ? { url: pushed.url } : {}),
        seconds: seconds(),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    // 4s, then 8, then 15 and stay there. The queue is seconds and the weights
    // are minutes; polling at the queue's pace for the weights' duration is
    // hundreds of pointless requests.
    wait = Math.min(15_000, Math.round(wait * 1.6));

    const state = await kernelStatus(token, me.user, live, options.signal);
    if (state.status !== last) {
      last = state.status;
      options.onStage?.(
        state.status === 'queued'
          ? 'Queued for a GPU.'
          : state.status === 'running'
            ? 'Running on a Tesla T4 — the first run downloads the weights, which is the slow part.'
            : `Kaggle says: ${state.status}.`,
      );
    }
    if (state.status === 'complete' || state.status === 'error' || state.status === 'cancelled') break;
    // `unknown` twice running means the poll is asking about something that is
    // not there — a wrong slug, a deleted notebook — and no amount of further
    // waiting will change the answer.
    unknowns = state.status === 'unknown' ? unknowns + 1 : 0;
    if (unknowns >= 3) {
      return {
        models: [],
        log: '',
        error: `Kaggle does not recognise the run "${live}" — ${state.message ?? 'no status came back'}.`,
        ...(pushed.url ? { url: pushed.url } : {}),
        seconds: seconds(),
      };
    }
  }

  const out = await kernelOutput(token, me.user, live, options.signal);
  const summary = resultFromLog(out.log);

  const models: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const file of out.files) {
    if (!file.name.endsWith('.glb') || !file.url) continue;
    try {
      // No Authorization header: the URL is already signed, and sending one
      // makes Kaggle's CDN reject it.
      const res = await fetch(file.url, options.signal ? { signal: options.signal } : {});
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      // glTF binary starts "glTF". Anything else is an error page with a .glb
      // name on it, and handing that to Godot is a scene with a hole in it.
      if (bytes.byteLength < 20 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'glTF') continue;
      models.push({ name: file.name.replace(/\.glb$/, ''), bytes });
    } catch {
      // One that will not come down should not lose the others.
    }
  }

  if (!models.length) {
    const why =
      summary?.failed?.length
        ? summary.failed.map((f) => `${f.name}: ${f.why}`).join('; ')
        : /PIXAL3D_UNAVAILABLE: (.*)/.exec(out.log)?.[1]
          ? `Pixal3D would not load — ${/PIXAL3D_UNAVAILABLE: (.*)/.exec(out.log)?.[1]}`
          : 'The run produced no mesh.';
    return { models: [], log: out.log, error: why, ...(pushed.url ? { url: pushed.url } : {}), seconds: seconds() };
  }

  options.onStage?.(`${models.length} model${models.length === 1 ? '' : 's'} back from Kaggle in ${seconds()}s.`);
  return { models, log: out.log, ...(pushed.url ? { url: pushed.url } : {}), seconds: seconds() };
}
