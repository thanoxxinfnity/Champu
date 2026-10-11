# Rigging a generated mesh

Measured on a TRELLIS T-pose character (box 1.0 × 0.685 × 0.18):
- arms at 0.55–0.70 of the height; shoulders ±0.07 from the middle; elbows at ±0.27; wrists ±0.40
- hips 0.50, knees 0.27, ankles 0.07; neck 0.735; head 0.78–1.0

Joint order matters: parents first. A bone's tip is its first child; chains end with `*_end` joints.
Weights: nearest 4 segments of the vertex's own side (limbs) — thighs only below the pelvis, arms only above hip height — `1 / (d / height)^3`, normalised.
Animation conventions (identity rest rotations, model faces +Z): leg swing about X, negative = forward; lowering a T-pose arm is Z-rotation (−s·down); forward reach is Y-rotation; a forward lean pushes the reaching arm down by the same angle, so add it back as `lift`.
Stretch: scale tracks on `fore_*` / `arm_*` along X for the long-armed lunge.
Stun/scream/peek/crawl clips are 0.5–3 s loops sampled at 16 keys.
