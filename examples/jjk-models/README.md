# JJK fan models — Gojo and Sukuna (Blender, procedural)

Fan-made, stylised 3D models inspired by two *Jujutsu Kaisen* characters, built entirely in Blender from Python (no image/3D-generation credits).
They are not official assets and not affiliated with the series; keep them for personal / non-commercial use.

| File | What |
|---|---|
| `models/gojo_blindfold.glb` / `.blend` | Gojo: white spiky hair, blindfold, dark high-collar uniform with gold buttons, jacket skirt on sway bones |
| `models/gojo_open_eyes.glb` / `.blend` | the same without the blindfold (blue eyes with emissive iris) |
| `models/sukuna.glb` / `.blend` | Sukuna: pink swept hair, two pairs of red eyes, two pairs of arms, face/body markings, open kimono, sash, long skirt on sway bones, stomach mouth |

* **Rig** — 51+ bones: hips, spine, chest, neck, head, shoulders, arms, **all five fingers with three joints each**, legs, feet, **toes**; Sukuna adds the second pair of arms; both have 12–14 *sway chains* (`skirt*_1/2/3`) for cloth secondary motion.
* **Skinning** — body skinned with automatic weights; garments are cut from the weighted body so they inherit the weights and bend with it; rigid parts (eyes, hair, buttons, markings) are bound 100 % to one bone.
* **Textures** — procedural image textures (`textures/`): skin, woven navy uniform with normal map, kimono with a border band, hair strand gradients, iris discs, blindfold cloth.
* `previews/` — renders: front view, face close-up and a posed view (raised arm, bent knee, closed fist) that shows the skinning works.

## Rebuild

```bash
python3 tools/textures.py textures                    # PIL + numpy
blender -b -P tools/gojo.py                           # both Gojo variants
blender -b -P tools/sukuna.py
```

## Honest limits
Stylised and low-detail: the faces are simple (no facial blendshapes), hair is spike cones with a scalp cap (no strands), cloth has no physics
simulation — the sway bones are there to drive it from a game engine or Blender's cloth/physics. This is a solid rigged starting point, not a
studio-quality hero asset.
