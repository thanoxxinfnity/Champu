# Rigging a generated mesh

Measured on a TRELLIS T-pose character (box 1.0 × 0.685 × 0.18):
- arms at 0.55–0.70 of the height; shoulders ±0.07 from the middle; elbows at ±0.27; wrists ±0.40
- hips 0.50, knees 0.27, ankles 0.07; neck 0.735; head 0.78–1.0

Joint order matters: parents first. A bone's tip is its first child; chains end with `*_end` joints.
Weights: nearest 4 segments of the vertex's own side (limbs) — thighs only below the pelvis, arms only above hip height — `1 / (d / height)^3`, normalised.
Animation conventions (identity rest rotations, model faces +Z): leg swing about X, negative = forward; lowering a T-pose arm is Z-rotation (−s·down); forward reach is Y-rotation; a forward lean pushes the reaching arm down by the same angle, so add it back as `lift`.
Stretch: scale tracks on `fore_*` / `arm_*` along X for the long-armed lunge.
Stun/scream/peek/crawl clips are 0.5–3 s loops sampled at 16 keys.


## The 49-bone Rigger contract (use this now)

Both games rig their creatures to the humanoid contract of the Rkk "Rigger" tool (`thanoxxinfnity/Rkk`, `rigger/GAME_BRIEF.md`): `hips, spine, chest, neck, head`, per side `thigh/shin/foot/toe` + `upperArm/foreArm/hand`, and 15 finger bones per hand (`thumb1L … pinky3R`), suffix `L`/`R`, parents before children, found by name (`find_bone`), never by index.
* `Rig.spec()` lists the bones, `Rig.positions()` places them from the measured profile (fingers fan out from the wrist along the arm axis exactly as Rigger's auto-fit does), `Rig.tip()` gives each segment its end for weighting.
* Clips are written with short keys (`thigh_l`, `arm_r`, …) and `Rig.SHORT` maps them to the contract names; `fing_l` / `fing_r` in a pose curl a whole hand (left about +z, right about −z, thumb rolls a little, a small twitch per finger so none sits still). Toes bend when the heel lifts.
* `tools/export_rigger_glb.gd` writes `Character > Rig + Mesh`, clip `Take`, facing +Z, so anything that loads a Rigger export loads it back. `tests/rig_test.gd` (49 bones, contract names, finger parents, every clip drives real bones and all 30 finger bones, fist ≠ open hand, loops without a snap, code can drive a finger) and `tests/rigger_glb_test.gd` (the glb reloads) gate it.
* Honest limit: a TRELLIS mesh is one lump. Where the model has real fingers (crawler, Mr. Grin) they curl; where it has a mitten (the Warden) the bones are there and weighted, but the mesh only bends as a mitten.
