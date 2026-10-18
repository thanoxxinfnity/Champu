#!/usr/bin/env python3
"""Turn a RigNet prediction into the bone-height profile scripts/player/rig.gd rigs a character with.

    python3 tools/rignet_profile.py <model.glb> <rignet *_rig.txt> <out_profile.json>

RigNet (github.com/zhan-xu/RigNet, run with the helper in this repo's history — see docs in tools/README.md) predicts joint
positions for a character mesh. On realistic, clothed humans its *joint positions* are good (knee, ankle, elbow, wrist,
neck and head land within a few percent of where they should) but its bone *connectivity* is not (a leg hangs off a spine
joint), so its own skinning cannot drive a walk cycle. What is taken from it is therefore only where things are, as
fractions of the model's bounding box in the form Rig.PROFILE uses; the connectivity, the skin weights and the animation
come from rig.gd and tools/bake_rig.gd. Every value is clamped to a plausible human range, so a bad prediction can only
degrade to the default, never to nonsense.
"""
import json
import re
import sys

import numpy as np
import trimesh


def load_joints(path):
    joints = {}
    for line in open(path):
        t = line.split()
        if t and t[0] == "joints" and not re.search(r"_dup_\d+$", t[1]):
            joints[t[1]] = np.array(list(map(float, t[2:5])))
    return joints


def main(model, rig, out):
    mesh = trimesh.load(model, force="mesh", process=False)
    lo, hi = mesh.bounds
    size = hi - lo
    cx = (lo[0] + hi[0]) / 2
    fy = lambda y: (y - lo[1]) / size[1]
    fx = lambda x: abs(x - cx) / size[0]
    J = load_joints(rig)
    pts = [(fx(p[0]), fy(p[1]), p[2]) for p in J.values()]
    clamp = lambda v, a, b: float(min(max(v, a), b))
    prof = {}

    arm = [p for p in pts if p[0] > 0.2 and p[1] > 0.6]               # the outer joints on the arm line
    if len(arm) >= 3:
        xs = sorted({round(p[0], 2) for p in arm})                    # both arms give the same joint: count each x once
        prof["shoulder_y"] = clamp(np.mean([p[1] for p in arm]), 0.66, 0.86)
        prof["elbow_x"] = clamp(xs[0], 0.2, 0.34)
        prof["wrist_x"] = clamp(xs[-2] if len(xs) > 1 else xs[-1], 0.3, 0.45)   # the last one is the fingertip
    inner = [p[0] for p in pts if 0.03 < p[0] < 0.12 and p[1] > 0.6]
    if inner:
        prof["shoulder_x"] = clamp(min(inner), 0.045, 0.09)

    centre = sorted([p[1] for p in pts if p[0] < 0.03 and p[1] > 0.55], reverse=True)   # head, neck, chest, spine from the top
    if len(centre) >= 3:
        head, neck = centre[0], centre[1]
        if head - neck < 0.02:
            neck = head - 0.04
        prof["head"] = clamp(head, 0.8, 0.9)
        prof["neck"] = clamp(neck, 0.76, 0.86)
        below = [c for c in centre[2:] if c < prof["neck"] - 0.05]
        if below:
            prof["chest"] = clamp(below[0], 0.6, 0.76)

    knee = [p[1] for p in pts if p[0] > 0.03 and 0.24 < p[1] < 0.34]
    ankle = [p[1] for p in pts if p[0] > 0.03 and 0.06 < p[1] < 0.14]
    if knee:
        prof["knee"] = clamp(np.median(knee), 0.24, 0.33)
    if ankle:
        prof["ankle"] = clamp(np.median(ankle), 0.06, 0.12)
    legx = [p[0] for p in pts if p[0] > 0.03 and p[1] < 0.35]
    if legx:
        prof["leg_x"] = clamp(np.median(legx) * 0.7, 0.035, 0.07)

    prof = {k: round(v, 4) for k, v in prof.items()}
    json.dump(prof, open(out, "w"), indent=1)
    print(out, prof)


if __name__ == "__main__":
    main(*sys.argv[1:4])
