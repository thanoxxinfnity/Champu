---
name: blender-rigging
description: Rig a generated or scanned humanoid (Triverse, TRELLIS, Meshy, photogrammetry) in headless Blender so it animates without stretching, spikes or holes, and check it in the game before shipping. Use when a hero's arm drags the thigh, a knee folds into a spike, hair sticks to a hand, a model shows holes or dark shards, or when asked to rig, re-rig, skin or weight-paint a character, or to make 3D models from character images.
---

# Blender rigging for generated heroes

Generated meshes are not artist meshes: they are triangle soups (open shells, duplicated vertices, flipped faces), often in an
A-pose, with a texture baked over noisy normals. Every step below exists because skipping it shipped a broken hero.
For general rigging theory (twist bones, weight limits, export culling) also read the `rigging-animation` skill.

## 0. Look first, always

Render front/side/back of the raw model before touching it: `blender -b -P tools/render_views.py -- in.glb out.png`.
Reject a model that is not one closed figure (two people, a base plate glued to the feet, a weapon fused to the hand).
Count islands (`bmesh` flood fill): thousands of islands = soup, expect trouble.

## 1. Get a riggable source

* Image-to-3D wants a single full-body figure, front view, plain background, arms clearly away from the body.
  Image generators rarely give a true T-pose; an A-pose is fine as long as there is air between arm and torso and between the legs.
* If the generator refuses a flow (Triverse text-to-model answered 403 without `turbo: true`), try the other flag before giving up.
* Keep raw downloads in a gitignored folder; never commit licensed or paid source meshes.

## 2. Place the skeleton from the mesh, not from a template

`tools/autorig_obj.py --adaptive` measures the body: height, hip width at pelvis height (not at the feet — a wide stance
lies), and the arms.
* T-pose: the outermost points above the knees are the hands; arms are horizontal.
* A-pose: the outermost points between 30 % and 78 % of the height are the hand tips; the arm runs from the shoulder
  (≈80 % height, ≈11 % of height off centre) to that tip, split 42 % / 78 %. The animator is direction-based, so any rest pose works.
* Never `continue` out of the per-side loop that also builds the legs (a 13-bone rig instead of 21).

## 3. Weights: heat, not distance

Distance weights (nearest bone segment) are what made the hand stretch the thigh and the shin fold into a spike: a vertex
near two bones listens to both even when flesh separates them. Use bone heat, which only lets a bone reach vertices it can
"see" through the inside of the body:

1. Copy the mesh and **voxel-remesh** it into a closed shell (voxel ≈ 0.6 % of height keeps the hand–thigh gap); decimate to
   ≤ 60k faces.
2. `parent_set(type='ARMATURE_AUTO')` on the proxy, in the **rest pose**, deform bones only.
3. If bone heat fails ("failed to find solution", every group empty): fall back to visibility weights — a vertex takes weight
   only from bones reachable by a straight line that stays inside the shell (BVH ray cast), 1/d², then smooth 4×.
4. **Data Transfer** the weights to the real mesh (`POLYINTERP_NEAREST`), then limit to 4 influences, clean < 0.02, normalise.

All of this is `tools/heat_rig.py`; the whole chain is `tools/rig_heroes.sh <id> <model> <height>`.
Old soup meshes rigged long ago may still spike with any weights (patches straddle both legs): regenerate them instead.

## 4. Shading that survives busy normals

* Draw both faces (`cull_disabled`) — flipped triangles otherwise show as holes.
* No inverted-hull outline on generated heroes: it shatters into dark shards. Darken the silhouette in the shader instead.
* Soft toon band edges; razor steps turn every bump of a detailed mesh into a speckle. Dark generated textures may need a
  per-hero brightness.

## 5. Prove it in the game

* Contact sheet of clips on the hero, front and side: `tests/clip_shots.gd -- out hero idle,run,sword_attack`.
  Look at the swing's widest frame and the run's deepest knee: that is where stretching shows.
* All heroes side by side: `tests/hero_lineup.gd`.
* Then the regression tests and a filmed match. Report what you looked at, not what you expect.
