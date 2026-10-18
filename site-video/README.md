# The site's hero video

Renders `site/video/hero.{mp4,webm}` — a real, rigged, skinned-mesh character (not a live 3D
viewer, not a rigid-body transform puppet) walking into a room, sitting, turning the TV on, and
opening a phone. Built the same way the games in `examples/` rig their TRELLIS/Tripo exports —
see `.claude/skills/aaa-game-builder/reference/rigging.md`.

## Rebuilding after a model or animation change

```
# 1. Weight the mesh to the skeleton in scripts/rig.gd (once per character.glb change)
xvfb-run -a godot --path . --rendering-driver opengl3 -s tools/bake_rig.gd

# 2. Look at it before filming anything
xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/rigshot.gd -- /tmp/rig.png
xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/scene_shot.gd -- /tmp/scene.png 8.3

# 3. Render the real video (xvfb-run only matters here; Godot needs a display even headless)
xvfb-run -a godot --path . --rendering-driver opengl3 \
  --write-movie /tmp/out.avi --fixed-fps 30 --resolution 1024x576

# 4. Encode for the web
ffmpeg -y -i /tmp/out.avi -vf "scale=960:-2" -c:v libx264 -preset slower -crf 23 \
  -pix_fmt yuv420p -an -movflags +faststart ../site/video/hero.mp4
ffmpeg -y -i /tmp/out.avi -vf "scale=960:-2" -c:v libvpx-vp9 -b:v 0 -crf 32 -an \
  ../site/video/hero.webm
ffmpeg -y -i ../site/video/hero.mp4 -vf "select=eq(n\,275)" -update 1 -vframes 1 \
  ../site/img/shots/hero-poster.jpg
```

The scene itself (room layout, the TV ad/brand beat, the camera path) is `scripts/main.gd`. The
clip ends — and `--write-movie` stops — when the timeline reaches `HOLD_END`; nothing else quits
the process, so a timeline edit does not also need a frame-count edit somewhere else.

## Why a baked video, not a live Three.js scene

The first pass of this hero *was* a live, draggable three.js viewer loading the same models in the
browser. It worked, but: a skinned/rigged character walking, sitting and reaching has no equivalent
without shipping a real animation runtime to the page, 11MB of models had to be fetched on every
visit, and the brief was explicit that this should read as a real video, not a demo of "look, 3D
in your browser." A 2–3MB baked clip is simpler, loads faster, and is the version that actually
has the rig.

## Assets

`assets/character.glb` and `assets/phone.glb` are generated (Triverse, from a reference image).
`assets/0*_*.glb` are the room/furniture set from
huggingface.co/datasets/tertrxcuvuvjvj/voidvideo-3d-models-12k. All of them are the raw 15–30MB
generations run through `@gltf-transform/cli optimize --texture-size 512 --texture-compress webp
--simplify true --compress false` (no Draco/Meshopt — Godot's glTF importer in this project's
version does not support `KHR_mesh_quantization`, which meshopt compression and some source
exports carry; `gltf-transform dequantize` first if a new source model fails to import with that
error). This is now the only place the full-size set is used — the live site only ships the
rendered video.
