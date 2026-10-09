# Hugging Face ZeroGPU
## When to Use

Use this skill when you need aI demos and GPU compute with Gradio Spaces and Hugging Face Spaces ZeroGPU. Use when writing or reviewing code that uses `@spaces.GPU`, configuring `python_version` or `requirements.txt` for a ZeroGPU Space, or handling ZeroGPU-specific code constraints — pickle-based process...


Rules and patterns for ML demos on Hugging Face Spaces with **ZeroGPU** hardware. Covers `@spaces.GPU`, duration and quota tuning, process isolation, the CUDA availability model, concurrency safety, and CUDA build constraints.

## Scope

This skill is for **Gradio SDK Spaces using ZeroGPU hardware**. Docker and Static Spaces cannot schedule onto ZeroGPU, and Streamlit apps now run as Docker Spaces — so this skill applies only to Gradio. For general Gradio coding (components, layouts, event listeners), see the `huggingface-gradio` skill in this repo. The authoritative ZeroGPU docs live at https://huggingface.co/docs/hub/spaces-zerogpu — refer to them for the current backing GPU, runtime version lists, and tier thresholds, all of which change over time.

## Reference Files

| Reference | When to read |
|-----------|--------------|
| `references/concurrency.md` | Always read alongside SKILL.md when writing ZeroGPU code — handlers run in parallel by default |
| `references/how-zerogpu-works.md` | When reasoning about cold-starts, worker reuse, why module-scope warmup does not carry to requests, or why returning CUDA tensors hangs |
| `references/how-quota-works.md` | When choosing `duration` values, debugging `illegal duration` vs `quota exceeded` errors, or explaining why default 60s blocks short tasks |
| `references/cuda-and-deps.md` | When installing CUDA-dependent packages (e.g. `flash-attn`), pinning torch side-cars, or reading wheel filename tags |

## Hardware

ZeroGPU exposes two GPU sizes that map to a fraction of the backing card:

| `size` | Slice of backing GPU | Quota cost |
|--------|----------------------|------------|
| `large` *(default)* | Half | 1x |
| `xlarge` | Full | 2x |

Default `large` gives half a physical GPU, so memory bandwidth and compute are significantly lower than the full card's specs. Use `xlarge` only when the workload genuinely needs the extra memory or compute.

> **Backing GPU changes without notice.** ZeroGPU has already migrated across GPU generations several times; older write-ups may name A100 or H200, but those are outdated. For the current backing GPU and exact per-size VRAM, always check the [ZeroGPU docs](https://huggingface.co/docs/hub/spaces-zerogpu) before sizing workloads.

## Basic Pattern

```python
import spaces
import torch
from transformers import pipeline

pipe = pipeline("text-generation", model="...", device="cuda")

@spaces.GPU
def generate(prompt: str) -> str:
    return pipe(prompt, max_new_tokens=100)[0]["generated_text"]
```

Key rules:

1. **Instantiate models at module scope** and call `.to("cuda")` eagerly. ZeroGPU handles the actual device mapping transparently (see CUDA availability model below).
2. **Decorate GPU functions with `@spaces.GPU`**. The decorator is a no-op outside ZeroGPU, so it is safe to keep in all environments.
3. **Set `duration` to match the realistic worst-case workload** (default 60s). The platform pre-checks `requested duration` against the user's `remaining quota` — not against the actual run time — so a 10-second task left at the 60s default fails with `quota exceeded` as soon as the user's remaining quota drops below 60s. Smaller declared `duration` also ranks higher in the node-level queue. See "Duration and Quota" below.
4. **`torch.compile` is NOT supported.** Use PyTorch [ahead-of-time compilation (AoTI)](https://huggingface.co/blog/zerogpu-aoti) (torch 2.8+) instead.
5. **Use `size="xlarge"` sparingly.** It allocates the full backing GPU, but costs 2x quota and tends to queue longer.

```python
@spaces.GPU(duration=120)
def generate_image(prompt: str):
    return pipe(prompt).images[0]
```

## CUDA Availability Model

Real GPU access is **only** available inside `@spaces.GPU`-decorated functions. Outside those functions, the GPU is not attached to the process.

However, `import spaces` **monkey-patches `torch`** so that:

- `torch.cuda.is_available()` returns `True` globally.
- `.to("cuda")` / `device="cuda"` calls at module scope succeed without error.

This is intentional. Module-scope `model.to("cuda")` calls register tensors with the ZeroGPU backend, which writes them to a disk offload directory at a startup "pack" step and frees the corresponding RAM. When a `@spaces.GPU` call lands, a forked GPU worker process streams those weights from disk into VRAM via a pinned-memory pipeline. Warm workers (reused across requests on the same GPU slot) keep weights resident on the GPU and skip the disk → VRAM step. The user-facing rule: write `device="cuda"` at module scope and it works — see `references/how-zerogpu-works.md` for the full lifecycle.

| Action | Where | Why |
|--------|-------|-----|
| `model.to("cuda")` / `pipe(..., device="cuda")` | **Module scope** | ZeroGPU registers the tensor and manages device migration |
| Actual CUDA computation (inference, etc.) | **Inside `@spaces.GPU`** | Real GPU is only attached during the decorated call |
| Branching on `torch.cuda.is_available()` | Avoid relying on it | Always returns `True` due to the monkey-patch |

Do not run inference or CUDA kernels at module scope — the real GPU is not attached, so operations either silently run on CPU or fail.

### Device selection idiom still works

The standard idiom remains correct under ZeroGPU:

```python
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = AutoModel.from_pretrained("...").to(device)
```

- **ZeroGPU** — `is_available()` is `True` (monkey-patched), so the model is registered for automatic device migration.
- **Dedicated GPU Spaces / local GPU** — `is_available()` is genuinely `True`.
- **CPU Spaces / local CPU** — resolves to `"cpu"`.

Do not hardcode `device="cuda"` — it breaks on CPU-only environments.

### Eager loading is the right default

Load models at module scope, not lazily on first request. The Space process starts before any user arrives, so cold-start cost is paid once. Lazy loading (`global model; if model is None: ...`, `@lru_cache` wrappers, factory functions instantiating on first call) just pushes that cost onto the first user.

## Local Development: Just Install `spaces`

Do **not** wrap `import spaces` in `try/except` and redefine `spaces.GPU` as a no-op fallback for local runs. Off-ZeroGPU, the `spaces` package is already a true no-op:

- Heavyweight behavior (CUDA monkey-patching, client init, startup hooks) is gated on the `SPACES_ZERO_GPU` env var, set only on ZeroGPU.
- `@spaces.GPU` returns the undecorated function unchanged off-ZeroGPU.
- Top-level `import spaces` performs only lightweight imports.

The Gradio SDK base image installs `spaces` on every hardware tier. So even after duplicating a Space onto a dedicated GPU (T4, L4, A10G, etc.) or CPU basic, no code changes are needed — `import spaces` still succeeds and `@spaces.GPU` becomes a transparent passthrough.

### Anti-pattern

```python
try:
    import spaces
except ImportError:
    class spaces:  # type: ignore
        @staticmethod
        def GPU(func=None, **kwargs):
            return func if func else (lambda f: f)
```

Problems:

1. The fallback must mimic every `@spaces.GPU` call shape — bare decorator, `duration=...`, `size=...`, generators, `aoti_*` helpers — and drifts as the `spaces` API grows.
2. It hides `spaces` from `requirements.txt`, even though the Space needs it at deploy time.
3. It solves a non-problem: the real package is already a no-op locally.

### Do this instead

Add `spaces` to dependencies and import it unconditionally:

```python
import spaces

@spaces.GPU
def generate(prompt: str) -> str:
    ...
```

## Duration and Quota

Three things happen when you declare `@spaces.GPU(duration=N)`:

1. **Tier-max check** — each visitor tier has a per-call `duration` cap. Declaring `duration` larger than the cap fails immediately with `ZeroGPU illegal duration`, regardless of remaining quota. (Tier numbers change over time — see the [ZeroGPU docs](https://huggingface.co/docs/hub/spaces-zerogpu).)
2. **Quota pre-check** — the platform compares `requested duration` against the user's `remaining quota`. If `remaining < requested`, the call fails with `ZeroGPU quota exceeded` — even if the actual work would have fit. The error message shows the explicit numbers, e.g. `"60s requested vs. 30s left"`. A 10-second task left at the default 60s therefore blocks the user once their remaining quota drops below 60s.
3. **Queue priority** — the queue is node-level (requests from all Spaces on the same node compete for GPU slots), and shorter declared `duration` ranks higher.

All three favor declaring the smallest realistic `duration` — including for short tasks. Explicit `@spaces.GPU(duration=15)` on a 10-second task avoids premature `quota exceeded` rejections and ranks higher in the queue.

> **`xlarge` doubles the request.** `requested = N * 2` when `size="xlarge"`, both for the tier-max check and the quota pre-check. So `@spaces.GPU(duration=60, size="xlarge")` is internally a 120s request.

### Dynamic duration for variable workloads

For workloads whose runtime depends on inputs, pass a callable that estimates per request. A static high `duration` locks out low-tier users (whose tier cap may be smaller than the static value) and unnecessarily reserves quota for light inputs.

```python
def estimate_duration(prompt, steps):
    return int(steps * 3.5)

@spaces.GPU(duration=estimate_duration)
def generate(prompt, steps):
    return pipe(prompt, num_inference_steps=steps).images[0]
```

For the full distinction between `illegal duration` vs `quota exceeded`, runs-per-day limits, the 24h quota window, and pay-as-you-go billing, see `references/how-quota-works.md`.

## Process Isolation and Pickle

`@spaces.GPU`-decorated functions run in a **separate process** managed by the ZeroGPU scheduler. Arguments and return values cross the process boundary via **pickle serialization**.

Consequences:

- **Only picklable objects** can be passed in or returned. Open file handles, database connections, locks, lambdas, and closures over unpicklable state will raise `PicklingError`.
- **Do NOT return CUDA tensors directly.** Unpickling a CUDA tensor in the main process triggers `torch.cuda._lazy_init()`, which ZeroGPU blocks. Convert to CPU first: return `tensor.cpu()` or `tensor.cpu().numpy()`.
- CPU tensors, numpy arrays, PIL Images, and plain Python objects work fine.
- Large objects incur serialization overhead. Prefer lightweight returns (tensors, arrays, file paths, base64 strings) over complex object graphs.

### `gr.State` semantics across the boundary

Because handlers run in a separate process, `gr.State` values are **pickled on every yield** — they are NOT shared by reference.

- The generator receives a **copy** of the state (`id()` differs from the caller's).
- In-place mutations inside the generator are **invisible** to other handlers until the mutated state is explicitly yielded back.
- Yielding `gr.update()` for a `gr.State` slot **skips the update** — other handlers continue to see the pre-yield value.
- Each yield that returns the state object creates a **new copy** via pickle.

Practical guidance:

- **Do NOT assume reference semantics for `gr.State`** on ZeroGPU. Code that mutates state in a generator and expects another handler to see those mutations will silently use stale data.
- **Every yield including a `gr.State` value triggers a full pickle round-trip.** For large state (model sessions, frame buffers), minimize how often you yield it — ideally once at the end. Use `gr.update()` for the state slot on intermediate yields.
- **CUDA tensors inside state must be moved to CPU before yielding** — same `torc

…(the rest of this skill is left out)