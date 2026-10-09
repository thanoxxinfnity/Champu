# Gradio LoRA Space Builder
## When to Use

Use this skill when you need build and publish a Gradio demo on Hugging Face Spaces for a user-provided LoRA. Use when someone asks to create, generate, ship, or publish a Space, demo, Gradio app, or playground for a LoRA — including LoRAs for Qwen-Image, Qwen-Image-Edit, LTX-Video, Wan, FLUX, SDXL, or other...


Build and publish a Gradio demo on Hugging Face Spaces that runs inference with a user-provided LoRA. Use whenever someone asks to create, generate, ship, or publish "a Space", "a demo", "a Gradio app", or "a playground" for a LoRA — whether the base model is Qwen-Image, Qwen-Image-Edit, LTX, or another diffusion model. Also use when someone describes a LoRA they trained or hosts on the Hub and wants to share it. The default target is ZeroGPU hardware and the default inference library is `diffusers` when the base model supports it.

The output is a real, published Space (private by default) that the user can try in the browser, not a local script.

## What "good" looks like for these demos

The demo should feel handcrafted for this specific LoRA, not a generic template with the LoRA bolted on. Two LoRAs that share a task can still need different demos: a pose-control video LoRA and an outpainting video LoRA both take video in and produce video out, but the inputs the user provides, the preprocessing, and the controls are completely different. Recognizing that is the central job here.

Concretely, a good demo:

- Loads fast and runs fast — minimal model loading, sensible step count, no wasted computation per call.
- Has a UI with exactly the controls this LoRA needs and nothing else. Excess sliders are a cost, not a feature.
- Shows the user what's happening — progress, intermediate outputs where useful, the seed used, a clear error when input is missing.
- Honors the LoRA's own recommendations from its model card: trigger words, recommended step count, recommended guidance scale, recommended LoRA scale, example inputs.
- Is creative where creativity helps — interactive canvases, before/after sliders, side-by-side previews of intermediate processing — and plain where plainness is right.

## Workflow

Work through these phases in order. Information gathered in one phase decides the next.

1. Gather the LoRA info needed to pick a pipeline and design a UI.
2. Pick the base pipeline and inference recipe.
3. Design the UI for this specific LoRA's task and inputs.
4. Write `app.py`, `requirements.txt`, and `README.md` together; show all three to the user for one batched approval.
5. Publish the Space (private).

Don't drip-feed questions across multiple turns. Batch them.

---

## Phase 1 — Gather LoRA info

Required: a LoRA repo on the Hub (e.g. `username/my-lora`).

**First, try to read the repo without a token.** If it succeeds, the repo is public — proceed. If it fails with 401/403, the repo is private/gated and you need an authenticated session to read it. **Don't immediately ask for a token.** Check first whether the user is already authenticated.

```python
from huggingface_hub import HfApi, get_token

cached_token = get_token()  # picks up HF_TOKEN env var or cached CLI login
if cached_token:
    try:
        info = HfApi().whoami(token=cached_token)
        username = info["name"]
        # info also has fine-grained token scope info if applicable
    except Exception:
        cached_token = None  # token exists but is invalid/expired
```

Then:

- If a valid cached token exists *and* it can read the repo, use it. No prompt needed.
- If no cached token, or the cached token can't read this private repo, ask the user for a token — once, with the explanation below.

When asking for a token (and only when you actually need to ask):

> I need a Hugging Face access token with **write** scope (to read the LoRA if it's private/gated, and to publish the Space). Create one at https://huggingface.co/settings/tokens. Paste it here.

The same token will be reused for publishing in the final phase, so this is a one-time ask.

**Then read what's in the repo:**

- List the repo files (`huggingface_hub.HfApi().list_repo_files(repo_id)`). Look for `.safetensors`, `README.md`, example images/videos, multiple checkpoints.
- Fetch the model card (`huggingface_hub.ModelCard.load(repo_id)`). The `data` dict has structured fields; the `text` has the README body.
- If multiple `.safetensors` files exist, pick the right one — see "Picking the LoRA weights file" in `references/zerogpu-and-publishing.md`. Briefly: README-recommended file wins, then `pytorch_lora_weights.safetensors`, then latest training checkpoint, otherwise ask.

**From the model card, try to determine:**

- **Base model** — the `base_model` field, or text mentions in the README. Usually present. Use it to pick the pipeline reference file (see Phase 2).
- **Task** — `pipeline_tag` if set, otherwise inferred from the base model and README text. The five tasks this skill handles: `text-to-image`, `image-to-image`, `text-to-video`, `image-to-video`, `video-to-video`.
- **Trigger words** — often called "trigger word", "instance prompt", "activation word"; sometimes embedded in example prompts.
- **Recommended inference recipe** — step count, guidance scale, true CFG scale, LoRA scale, resolution. Many LoRA cards include a Python snippet; trust its *parameters* (steps, guidance, CFG, LoRA scale, dtype). For *loading mechanics*, see `adapting-to-the-lora.md` — prefer `pipe.load_lora_weights(...)` over whatever loading approach the snippet uses.
- **Example prompts and example media** — use these as Gradio examples in the UI.
- **Sub-task / specific use case** — for image edits and video LoRAs, "what does this LoRA actually do" matters as much as the task category. A relighting LoRA, a face-swap LoRA, and a style LoRA all might be image-to-image, but the UI for each is different.

**When something can't be inferred, ask the user — once, in a single batched message.** Format the question to make answering trivial. For task category, list the five options as a numbered choice. For sub-task, give a one-line description ("what does this LoRA do? e.g. 'relight portraits', 'apply manga style', 'extend videos to wider aspect ratios'"). Don't ask if you can already infer it confidently from the base model or README.

If the model card has nothing helpful at all — no base model, no task, no example — surface that clearly: "The model card has no usable info. I'll need you to tell me: (1) base model, (2) what this LoRA does, (3) recommended step count and guidance scale if you know them."

---

## Phase 2 — Pick the base pipeline

Two things to decide here: which reference file to load, and which pipeline class to use. They're not the same question — a base-model family file (e.g. `qwen-image.md`) covers multiple variants, and variants in the same family don't always share a pipeline class. Get this wrong and the Space loads but produces wrong output, or fails at startup.

**Step 1 — Load the reference file for this base model family.**

- `references/base-models/qwen-image.md` — covers Qwen-Image and Qwen-Image-Edit family (text-to-image and image-to-image).
- `references/base-models/ltx.md` — covers LTX family (text-to-video, image-to-video, video-to-video, including IC-LoRAs).
- `references/base-models/krea-2.md` — covers Krea 2 (K2), text-to-image (train on RAW, run inference/LoRAs on the Turbo distilled checkpoint).

If the base model isn't in one of these files, this skill doesn't have first-class support yet. Tell the user, and ask whether they want to proceed by analogy (use the closest model's recipe and adjust) or stop. Don't guess silently.

**Step 2 — Verify the pipeline class against the base model's own card. This step is mandatory, not optional.**

A new base model variant might use the same pipeline class with a different repo path, or a new pipeline class entirely. Don't trust the reference file's table alone — it's best-effort and can lag a recent release. Verify before committing:

```python
from huggingface_hub import ModelCard
base_card = ModelCard.load(base_model_id)
# Read base_card.text — find the diffusers inference snippet, note the pipeline class it imports.
```

The class imported in the base model card's diffusers snippet is the source of truth. Real examples where this matters:

- `Qwen-Image-Edit` uses `QwenImageEditPipeline`. `Qwen-Image-Edit-2509` and `Qwen-Image-Edit-2511` use `QwenImageEditPlusPipeline` — different class, different default parameters, takes a list of images instead of one. A LoRA targeting 2511 loaded onto `QwenImageEditPipeline` produces broken output.
- LTX-Video uses `LTXPipeline`/`LTXImageToVideoPipeline`/`LTXConditionPipeline`. LTX-2 uses `LTX2Pipeline` from a different module path. LTX-2.3 sometimes needs a native pipeline outside diffusers.

If the base model card has no diffusers snippet at all, fall back to the reference file's table — and tell the user you're falling back, in case they know something the table doesn't.

The cost of this verification is one Hub fetch and a few seconds of reading. The cost of skipping it is the failure mode the previous bullet describes — a "working" Space that's quietly using the wrong class.

**Step 3 — Diffusers vs native pipeline.** Default to `diffusers` when the base model has a diffusers pipeline class. That's the case for Qwen-Image and Qwen-Image-Edit and most of LTX. Some LTX variants (notably LTX-2.3 with certain IC-LoRAs) need a native pipeline; the LTX reference says when. Diffusers gives standard `load_lora_weights` / `set_adapters` semantics; the native path needs LoRA-specific glue.

---

## Phase 3 — Design the UI for this LoRA

Don't reach for a template. Reason from the LoRA's task and inputs to a UI.

Read `references/tasks.md` for the per-task baseline UI patterns (what the standard inputs/outputs look like for T2I, I2I, T2V, I2V, V2V).

Then read `references/adapting-to-the-lora.md`, which is about *thinking through what this specific LoRA needs* — beyond the task category. That file is the most important one in this skill. The same task can need very different UIs: a pose-control LTX LoRA needs a video input and a pose-extraction preview; an outpaint LTX LoRA needs an aspect-ratio picker and a black-margin preview; a relighting Flux LoRA needs an image and a brush canvas for indicating where to add light. None of those reduce to "the V2V template" or "the I2I template".

**Self-check before writing the UI.** Write one sentence describing what a user does with this Space in 10 seconds. If that sentence doesn't distinguish this LoRA from any other LoRA of the same task, the UI isn't shaped enough yet.

Examples that pass the self-check:

- "Upload a video, pick a target aspect ratio, click Generate; the model fills the empty margins."
- "Draw colored brush strokes where you want light, pick an illumination style, click Generate; the model relights the photo."
- "Upload a video of someone moving and an image of a different character; the model produces a video of the character doing the motion."

Examples that fail:

- "Type a prompt and click generate." (Generic T2I — say more.)
- "Upload an image and an instruction." (Generic edit — what kind of edit?)

**Gradio component freshness.** Gradio's component set evolves. Before defaulting to plain components, consider whether something newer fits better — for example `gr.ImageSlider` for before/after on edit LoRAs, `gr.BrowserState` for persistent prefs, `@gr.render` for UIs that change based on input. If you're unsure whether a component exists or what its signature is, web-fetch the current Gradio docs at https://www.gradio.app/docs rather than guessing.

**When stock and Hub custom components aren't enough — creative mode.** If the LoRA's natural input is a shape no Gradio component (built-in or on the Hub) expresses well — point sets, strokes, trajectories, multi-region annotations with metadata, 3D rotation gizmos, timeline scru

…(the rest of this skill is left out)