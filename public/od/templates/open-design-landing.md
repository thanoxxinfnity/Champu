# open-design-landing

Build a single-page editorial landing site (or a slide deck — see the
sibling [`open-design-landing-deck`](../open-design-landing-deck/) skill)
in the **Atelier Zero** design system: warm-paper background, Inter
Tight + Playfair Display, italic serif emphasis spans, dotted hairline
rules, coral terminating dots, scroll-reveal motion, and 16 surreal
collage plates.

This is the canonical OpenDesign marketing-page recipe — the example
output is the very page you see at [open-design](https://github.com/nexu-io/open-design).

The skill is fully **parameterized**. The agent fills one typed
`inputs.json` from the user's brief; the composer turns that JSON +
the canonical [`styles.css`](./styles.css) into a deployable artifact.

```text
inputs.json + styles.css                       16 image slots
        │                                            │
        └──────────► scripts/compose.ts ◄────────────┘
                            │
                            ▼
              <out>/index.html  (self-contained)
              <out>/assets/      (PNG or SVG)
```

---

## What you get

A single HTML file with **all** of:

- Editorial topbar (volume / issue / language strip), Headroom-style
  sticky nav with live GitHub star count.
- 8 numbered Roman-numeral sections with paper-textured background:
  hero (with 3 stat rings + 4-step index), about, capabilities (4 cards),
  labs (5 cards + filter pills + progress bar), method (4 steps with
  thumbnails), selected work (dark slab + 2 tilted cards), testimonial
  (pull quote + 5 partner glyphs), CTA (ribbon + email pill).
- Footer with 4 link columns + huge italic-serif kicker word.
- Scroll-reveal motion on every section (IntersectionObserver, respects
  `prefers-reduced-motion`).
- Fully responsive at 1280 / 1080 / 880 / 560 breakpoints.

---

## Workflow contract

Run these four steps in order. The agent should **complete** each step
before moving on, and prefer asking the user a focused question over
inventing copy.

### 1. Gather brand inputs

Use `AskQuestion` (or the equivalent in your UI) to collect the brand
brief in chunks; do **not** dump the entire `schema.ts` on the user.
Map their answers into `inputs.json` matching the typed shape.

The eight question groups, in order:

| Group | Schema fields                                           | Min answers | Notes                                    |
| :---- | :------------------------------------------------------ | :---------- | :--------------------------------------- |
| 1     | `brand.{name,mark,tagline,description,location}`        | 5           | Mark = single glyph (Ø, ▲, ★…)           |
| 2     | `brand.{license,version,year,primary_url,contact_email}`| 4           | URL is required; license defaults Apache-2.0 |
| 3     | `nav[]` (up to 5)                                       | 3           | Optional count badges                     |
| 4     | `hero.{label,headline,lead,primary,secondary,stats}`    | All         | Headline as `MixedText` (sans+em+dot)     |
| 5     | `about` + `capabilities.cards[4]`                       | All         | 4 cards × {num,tag,title,body}            |
| 6     | `labs.cards[5]` + `method.steps[4]`                     | All         | Both grids fixed-arity                    |
| 7     | `work.cards[2]` + `testimonial`                         | All         | 5 partner glyphs as inline SVG path data |
| 8     | `cta` + `footer.{columns[4],mega}`                      | All         | Mega kicker is a `MixedText` like the headlines |

Open [`inputs.example.json`](./inputs.example.json) for a complete
worked example (OpenDesign itself).

### 2. Decide the image strategy

| Strategy          | When to choose                                          | Cost / latency        |
| :---------------- | :------------------------------------------------------ | :-------------------- |
| `placeholder`     | First pass. Demo. Slide internal. No image budget yet.  | $0, <1s               |
| `generate`        | Final delivery. Brand wants original collages.          | ~$0.40, ~6 min        |
| `bring-your-own`  | User has art direction PNGs. Drop them at `assets_path`.| $0, 0s                |

Set `inputs.imagery.strategy` accordingly.

#### `placeholder` — frame mode

```bash
npx tsx scripts/placeholder.ts <out>/assets/
```

Writes 16 `.svg` files (with `.png` aliases for compatibility) into
`<out>/assets/`. Each placeholder shows the slot id, ratio, pixel
dimensions, and the prompt hint from `image-manifest.json`. The
composer's `<img src='./assets/hero.png'>` etc. just work.

#### `generate` — gpt-image-2 mode

```bash
FAL_KEY=... npx tsx scripts/imagegen.ts <inputs.json> --out=<out>/assets/
```

Calls fal.ai's `openai/gpt-image-2` synchronous endpoint per slot.
Composes prompts as: **style anchor** (paper-collage editorial system)
+ **brand variables** (name / nav / headline / italic emphasis pulled
from `inputs.json`) + **per-slot composition** (e.g. cropped plaster
head + tree growing through arch). Skips slots whose target file
already exists; pass `--force` to re-render.

Without `FAL_KEY`, the script prints the prompts so the operator can
route them through the `/gpt-image-fal` slash-command skill manually.

#### `bring-your-own`

Drop 16 PNGs matching `assets/image-manifest.json` filenames at
`inputs.imagery.assets_path`. Done.

### 3. Compose the artifact

```bash
npx tsx scripts/compose.ts <inputs.json> <out>/index.html
```

The composer reads `inputs.json` and `../styles.css`, then writes one
self-contained HTML file. The page includes:

- The full Atelier Zero stylesheet, inlined.
- All section markup with `data-reveal` attributes for staggered
  scroll motion.
- Inline IntersectionObserver script for `[data-reveal]`.
- Inline Headroom nav script (mirrors `header.tsx`).
- Inline GitHub star-count fetcher (auto-detects from `brand.primary_url`).

---

## Self-check before delivering

Before marking done, the agent **must** verify:

- [ ] `<out>/index.html` opens in a browser without console errors.
- [ ] All 16 image slots load (no 404s in DevTools network tab).
- [ ] Headline italic emphasis spans render in Playfair (not sans).
- [ ] Coral terminating dots appear at every `display` h1/h2 end.
- [ ] Scroll from top to bottom; every section animates in once.
- [ ] Resize to 880px and 560px; no horizontal scroll, no overlap.
- [ ] `prefers-reduced-motion: reduce` (DevTools → Rendering) disables
      transitions cleanly.
- [ ] Lighthouse: contrast AA, font-display swap, no layout shift on the
      hero (CLS < 0.05).

---

## Files in this skill

```text
design-templates/open-design-landing/
├── SKILL.md                 # this contract
├── README.md                # quick-start
├── schema.ts                # typed inputs (single source of truth)
├── styles.css               # Atelier Zero stylesheet (single source of truth)
├── inputs.example.json      # OpenDesign as the worked example
├── example.html             # canonical rendering (regenerated from inputs.example.json)
├── scripts/
│   ├── compose.ts           # inputs.json + styles.css → index.html
│   ├── imagegen.ts          # gpt-image-2 wrapper (fal.ai)
│   └── placeholder.ts       # SVG paper-textured frames
└── assets/
    ├── *.png                # 16 collage plates (OpenDesign instance)
    ├── image-manifest.json  # slot → file/dimensions/prompt mapping
    └── imagegen-prompts.md  # human-readable prompt pack
```

---

## Boundaries

- **Do not** invent new colors or typefaces. Tokens live in
  `design-systems/atelier-zero/DESIGN.md`; extend the design system
  before adding a new ramp here.
- **Do not** drop `data-reveal` attributes from generated markup.
  Without them the page goes static and feels dead.
- **Do not** wrap the composed HTML in a framework that injects its
  own stylesheet ordering — Atelier Zero relies on stylesheet-order
  cascade for paper texture and z-index of side rails.
- **Do not** add a separate stylesheet file that reorders Atelier Zero
  cascade; keep `styles.css` as the single visual source.

## See also

- [`design-systems/atelier-zero/DESIGN.md`](../../design-systems/atelier-zero/DESIGN.md) — token spec.
- [`design-templates/open-design-landing-deck/`](../open-design-landing-deck/) — sibling slides skill that reuses this design system.