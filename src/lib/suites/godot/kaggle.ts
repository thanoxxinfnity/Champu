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
  utils3d: 'https://github.com/LDYang694/Storages/releases/download/20260430/utils3d-0.0.2-py3-none-any.whl',
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

def install():
    sh("git clone --depth 1 -b ${PIXAL3D.branch} ${PIXAL3D.repo} /kaggle/tmp/pixal3d")
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

for job in JOBS:
    name = job["name"]
    src = os.path.join("/kaggle/tmp", name + ".png")
    with open(src, "wb") as fh:
        fh.write(base64.b64decode(job["b64"]))
    if not ok:
        results["failed"].append({"name": name, "why": "Pixal3D did not install"})
        continue
    try:
        print("generating", name, job.get("prompt", ""), flush=True)
        t0 = time.time()
        glb = os.path.join(OUT, name + ".glb")
        # The documented invocation, not an imagined Python API. ATTN_BACKEND
        # is sdpa because flash_attn is another CUDA build and torch already
        # ships an attention that works.
        run = sh(
            "cd /kaggle/tmp/pixal3d && ATTN_BACKEND=${PIXAL3D.attnBackend} python inference.py"
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

  // The wheel the setup run built, if it is there. Attaching a kernel output is
  // free when it exists and harmless when it does not: the notebook looks for
  // the wheel and compiles if it cannot find one.
  const cached = `${me.user}/${ENV_KERNEL}`;
  const pushed = await pushKernel(token, {
    user: me.user,
    slug,
    title: `Chomugiri — ${options.label ?? 'assets'}`,
    source: pixal3dNotebook(jobs, options.toBase64, { cached: true }),
    inputs: [cached],
    gpu: true,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (pushed.error) return { models: [], log: '', error: pushed.error, seconds: seconds() };
  // Everything after this asks about the slug Kaggle actually made.
  const live = pushed.slug ?? slug;

  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000);
  let wait = 4_000;
  let last = '';
  let unknowns = 0;
  for (;;) {
    if (Date.now() > deadline) {
      return {
        models: [],
        log: '',
        error: `The Kaggle run did not finish within ${Math.round((options.timeoutMs ?? 30 * 60_000) / 60_000)} minutes. It may still be going — ${pushed.url}`,
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
