# 3D landing page — a worked example

The shape the agent is asked to produce for a website request: one HTML entry,
one stylesheet, one ES module, geometry built in code, and nothing that has to
be downloaded at runtime.

Deployed from Chomugiri's own `/api/vercel/deploy` route, so it also exercises
the deploy path end to end.

## Running it

three.js is not checked in — copy the two build files next to the page:

```bash
mkdir -p vendor
cp node_modules/three/build/three.module.min.js vendor/three.module.js
cp node_modules/three/build/three.core.min.js  vendor/three.core.min.js
python3 -m http.server 4310
```

The import map in `index.html` points `three` at `./vendor/three.module.js`.
A CDN URL works there too; a local copy is used here so the page renders with no
network at all.

## What it demonstrates

- Renderer sized from the canvas's own client box, pixel ratio clamped to 2.
- Resize updates `camera.aspect`, `updateProjectionMatrix()` and `setSize()`.
- Real lights — a `MeshStandardMaterial` with none renders pure black.
- `setAnimationLoop`, stopped on `visibilitychange` so a hidden tab costs nothing.
- `prefers-reduced-motion`: one static frame instead of an animation.
- No WebGL context: the canvas is removed and the page reads as ordinary copy.
- The canvas is masked behind the text column, so scenery never beats the words.
