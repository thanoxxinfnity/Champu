# 3D models for the story scene

Used by `js/story-scene.js`. Two sources, both image-to-3D:

- `01_…glb` through `25_…glb` — the furniture/room set, generated and hosted at
  huggingface.co/datasets/tertrxcuvuvjvj/voidvideo-3d-models-12k.
- `character.glb`, `phone.glb` — generated via the Triverse API
  (docs.triverse.ai) from a reference image and a product photo.

All of them started as 15–30 MB high-poly exports, far too heavy to ship on a
marketing page. Each was run through `@gltf-transform/cli optimize`
(512 px WebP textures, mesh simplification, no Draco/Meshopt — plain glTF so
the page needs nothing but `GLTFLoader.js`) down to the few hundred KB each
is now. Re-run that step if a model is ever swapped:

```
npx @gltf-transform/cli optimize in.glb out.glb --texture-size 512 \
  --texture-compress webp --simplify true --compress false
```

Each model's real scale is whatever its generator happened to export at —
`fitAndPlace()` in story-scene.js normalises every one to an actual
real-world size at load time rather than trusting a fixed multiplier.
