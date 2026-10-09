**Plugin installs:** Before setup or freshness commands, follow [plugin execution rules](../hyperframes/references/plugin-installation.md) when this skill is inside a HyperFrames plugin. Standalone installs keep the update instructions below.

> **First, keep this skill fresh — confirm with the user before running:** `npx hyperframes skills update slideshow`. A fast no-op when everything is current; otherwise it refreshes this skill plus the core domain skills it depends on before you rely on them.

> **figma source**: If the deck's content or storyboard comes from a figma.com URL, run `/figma` first — asset export, brand tokens, and storyboard reconstruction if the source is a strip of scene frames — then build from its output. Don't drive Figma via raw MCP tools directly: that skips SVG sanitization, `.media/manifest.jsonl` provenance, and brand-token `var()` binding, so a later brand change can't propagate without a full re-import.

# Slideshow authoring contract

A HyperFrames slideshow is a normal HyperFrames composition — scenes, clips, GSAP timelines — with one extra ingredient: a **JSON island** that declares which scenes are slides and how they connect. The player's `SlideshowController` reads the island and turns the continuous GSAP timeline into a discrete, navigable deck.

**Read `/hyperframes-core` first** for the base composition contract (clips, tracks, `data-*` attributes, determinism rules). This skill covers only what is new: the island schema, slide writing rules, fragments, branching, validation, and the wrapping component.

## Output — a navigable deck, not a linear MP4

A slideshow's output is the **running deck**: serve it with `hyperframes present <project-dir>` (or Studio present mode) — the player's `SlideshowController` reads the island and drives navigation, fragments, branching, and presenter mode. See **Presenting and handoff** below.

**Do not `hyperframes render` a slideshow into a single MP4.** A deck is authored as several top-level scene compositions (one `data-composition-id` per slide) with **no master-root composition** wrapping them, so `render` resolves only the **first** composition and emits a **silently truncated** MP4 (e.g. 6s of a 40-second deck). A linear main-line export (main slides only, branch sequences excluded) is **deferred** — until it ships, the supported outputs are the live `present` deck and per-slide `snapshot` stills. If a user needs a linear MP4 today, surface this limitation rather than pointing `render` at the deck.

## Intent confirmation

If the user explicitly asks for a slideshow, slide show, or HyperFrames slideshow, proceed with this skill. When the request arrived through `/hyperframes`, the intent layer's triage owns this confirmation — routed here means already confirmed, so don't re-ask; the layer's run-shape questions don't apply (the deliverable is a deck, not a rendered video). A `BRIEF.md`, when present, carries the confirmed intent — read it.

If the skill triggered from an adjacent request such as "presentation", "pitch deck", "deck", "interactive deck", or "convert this page", pause before authoring and frame the choice before asking for confirmation. Briefly explain that a HyperFrames slideshow means a runnable deck with discrete slides, built-in navigation and presenter mode, editable speaker notes, shared media handling, and validation before handoff. For source-page conversions, also mention that the goal is to preserve the original page's visual design, interactions, motion, and media behavior while translating page movement into slide-to-slide transitions.

Then ask a short confirmation question:

> Do you want this as a HyperFrames slideshow?

Use a yes/no choice UI when the environment provides one; otherwise ask the question in plain text.

Do not implement the slideshow until the user says yes. If they say no, stop using this skill — read `/hyperframes` and let the intent layer re-route. This confirmation is a **routing decision**, not a preference gate — per `../hyperframes/references/brief-contract.md` § 1 it survives autonomous mode ("surprise me" does not skip it): building the wrong deliverable type is a quality failure, not a creative call.

---

## The two pieces

### 1. Scenes — declared the normal way

Every slide is backed by a scene. Declare scenes with `data-composition-id`, `data-start`, `data-duration`, and `data-label`:

```html
<div
  data-composition-id="problem"
  data-start="0"
  data-duration="8"
  data-label="The problem"
  data-width="1920"
  data-height="1080"
>
  <!-- clips go here -->
</div>
```

Branch slides (reachable only via a hotspot, excluded from the main line) are declared exactly the same way — they just appear only in a `slideSequences` entry in the island, not in the main `slides` array.

### 2. The JSON island — one script block per composition

Add exactly one `<script type="application/hyperframes-slideshow+json">` block to the composition HTML. It holds all slideshow metadata:

```html
<script type="application/hyperframes-slideshow+json">
  {
    "slides": [...],
    "slideSequences": [...]
  }
</script>
```

The island is the single source of truth for slide order, notes, fragment hold-points, hotspots, and branch sequences. Keep it near the top of the `<body>`, before the scene divs, so it is easy to find.

Do not hide the slideshow manifest behind an alternate `<script type="application/json">` block plus runtime code that creates the island. The `present` command reads the composition HTML statically and expects the real `application/hyperframes-slideshow+json` island to already be present.

---

## Schema

### `SlideshowManifest` (the top-level island object)

```json
{
  "slides": [
    /* SlideRef[] — the main line, in order */
  ],
  "slideSequences": [
    /* SlideSequence[] — off-line branch sequences */
  ]
}
```

### `SlideRef`

```json
{
  "sceneId": "problem",
  "notes": "Lead with the pain, not the company.",
  "fragments": [3.5, 5.2, 7.0],
  "hotspots": [
    /* SlideHotspot[] */
  ],

  "ttsScript": null,
  "ttsAudioUrl": null,
  "ttsDurationMs": null
}
```

| Field                                       | Required | Notes                                                                                                                                                   |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sceneId`                                   | yes      | Must match a scene's `data-composition-id` exactly (or provide explicit `startTime`/`endTime`). The lint rule resolves scenes by `data-composition-id`. |
| `notes`                                     | no       | Presenter-only text. Never shown to the audience.                                                                                                       |
| `fragments`                                 | no       | Array of times (seconds) within the slide's `[start, end]` range — see Fragments below.                                                                 |
| `hotspots`                                  | no       | Interactive overlays that trigger a branch — see Branching below.                                                                                       |
| `startTime`                                 | no       | Optional. Override the matched scene's time bounds; defaults to the scene's start/end.                                                                  |
| `endTime`                                   | no       | Optional. Override the matched scene's time bounds; defaults to the scene's start/end.                                                                  |
| `ttsScript`, `ttsAudioUrl`, `ttsDurationMs` | no       | **Reserved.** Schema fields exist but TTS playback is not yet wired. Omit unless you are pre-populating for a future build.                             |

### `SlideHotspot`

```json
{
  "id": "h1",
  "label": "How did we calculate this?",
  "target": "market-deep-dive",
  "region": { "x": 60, "y": 10, "w": 35, "h": 20 }
}
```

| Field    | Required | Notes                                                                                                                           |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | yes      | Unique within the slide.                                                                                                        |
| `label`  | yes      | Tooltip / button text shown to the audience.                                                                                    |
| `target` | yes      | Must match a `SlideSequence.id` in `slideSequences`.                                                                            |
| `region` | no       | Percentage-of-slide bounding box: `{x, y, w, h}` in `0–100`. Omit to render the hotspot as a full-slide labeled button instead. |

### `SlideSequence`

```json
{
  "id": "market-deep-dive",
  "label": "Market sizing methodology",
  "slides": [{ "sceneId": "mkt-1" }, { "sceneId": "mkt-2" }]
}
```

`slides` inside a sequence uses the same `SlideRef` shape as the main line. Fragments and nested hotspots are allowed.

---

## Slide writing rules

These are hard constraints, not suggestions. A slide that violates them will be outright replaced when a reviewer sees it.

- **Headline is a complete-sentence claim, not a label.** Write "SMBs spend 14 hours/week on manual scheduling" not "Scheduling problem". The sentence should stand alone if the visual is ignored.
- **One idea + one visual per slide.** If you are tempted to add a second bullet cluster or a second chart, split the slide.
- **Lead with the punchline.** The strongest point goes first — on the slide and in the deck order. Investors read left-to-right, top-to-bottom, and they stop.
- **Bottom-up market sizing only.** Never write "$50B TAM" without showing the math. Build from unit economics up: accounts × ACV, or transactions × take-rate.
- **Font minimum 30pt equivalent.** At 1920×1080, a headline is 72–96px; body copy is 48px. Never go below 40px for any text the audience must read.
- **Search the live catalog before hand-building any named visual.** For every look, effect, chart, treatment or transition a slide needs — "CRT scanlines", "glitch", "bar chart race", "shimmer sweep", "terminal window" — run `npx hyperframes catalog --query "<the visual, in plain English>" --json` and read the top results before you author the slide's clips. The search needs **nothing installed**: no project, no prior `add`, no account. It ranks the whole hosted registry (~400 blocks and components) from any directory. `npx hyperframes add <name>` drops the block's source into the deck, where you customize it in place. This applies with extra force when porting a source page: a real block beats the simplified approximation the porting rules below forbid.

## Porting source pages

When converting an existing page into a slideshow, source fidelity is part of the contract. Do not replace source-specific widgets with simplified approximations unless the user explicitly asks for a redesign.

- Preserve the original page's visual design, motion language, interactive behavior, media behavior, and presentation affordances as closely as practical. When the slideshow system supports presenter mode, include speaker notes using the shared editable-notes behavior rather than a deck-specific implementation.
- Port mechanical visuals from the source DOM/CSS/JS as exactly as practical: custom players, canvas visualizers, timelines, playheads, stems, expanding circles, hover states, and other interactive details should survive the conversion.
- Treat native `<video>` / `<audio>` elements as the source of truth for any custom media chrome, canvas visualizer, waveform, beat grid, or playhead. Wire the source's media events (`play`, `pause`, `timeupdate`, `seeking`, `seeked`, `ended`, `ratechange`, `volumechange`) and derive visual state from `media.currentTime`; do not run a separate timer that can drift away from actual playback.
- Every copied `<video>` or `<audio>` with `src` must have HyperFrames timing attributes before lint: `data-start` and `data-duration`, plus `data-has-audio="true"` when audible native audio should be preserved. Use the scene's time range for slide-specific media; for user-controlled evidence videos that may be played from multiple focused slides, use a deck-wide range. Do not leave `preload="none"` on media; use `metadata` or `auto`.
- Resolve source font tokens before validation. If preserving custom source fonts, add `@font-face` rules for local/captured font files. If using system fallbacks, replace tokenized declarations such as `font-family: var(--f-body)` with concrete render-safe stacks such as `system-ui, sans-serif` or `ui-monospace, monospace`; do not leave `var(...)` as the font family value.
- Audit the source for atypical page movement, especially behavior driven by scroll, wheel, touch, hash state, resize, or a requestAnimationFrame loop. Treat fixed viewports with translated/scaled "world" layers, parallax, pinned panels, horizontal scrollers, scroll-scrubbed timelines, section snapping, and zoom-to-element cameras as source behavior. Scroll is often the source's transition trigger, so preserve the transition by extracting its progress stops, easing, and camera/focus states, then re-host that motion on slideshow navigation through timeline positions, fragments, or a reusable player/harness hook. Standalone wrappers that jump to slide hold-points still need an explicit navigation-camera transition hook; computing per-slide camera transforms is not enough. Do not simulate a literal page-scroll-down transition inside the slide; the viewer should feel camera travel/zoom from one focal point to another, not see a webpage being scrolled. Keep each slide-to-slide camera move continuous: avoid intermediate route stops that reverse x/y direction or zoom unless the source visibly does that at the same boundary. A transition that darts around before landing is worse than a simpler direct focal move.
- Preserve the source's media crop semantics. Treat screenshots, tweets/social posts, product UI captures, charts, docs, code, leaderboards, and any image with readable text as content evidence, not decorative media: use the source aspect ratio (`height: auto`) or `object-fit: contain` inside a stable frame. Use `object-fit: cover` only when the source did, or for intentionally decorative/background/cinematic thumbnails. After fitting these captures into a slide, inspect all four edges for truncated text, logos, controls, or captions; a visible crop on meaningful content is a bug unless the source itself cropped it.
- If a behavior is generic to slideshows, put it in the player/controller or in a reusable skill snippet. Do not solve it with one-off deck scripts.
- Stacked scene frames must never block interaction on the active slide. Hidden frames need both visual hiding and event gating:

```css
.scene-frame {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.scene-frame.is-active {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
```

If visibility is driven imperatively, set all three properties (`opacity`, `visibility`, and `pointerEvents`) in the visibility controller. `opacity: 0` alone still leaves an invisible layer that can swallow clicks.

---

## Fragments: reveal hold-points within a slide

A fragment is an absolute composition-timeline time (seconds) within a slide's `[start, end]` range where the controller should hold a reveal state.

**How it works:**

1. Player enters a fragmented slide — seeks directly to `fragments[0]` and holds there.
2. User presses Next (or →) — contro

…(trimmed)