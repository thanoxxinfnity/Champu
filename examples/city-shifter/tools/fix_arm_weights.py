"""Unbinds hair, capes and coats from the arms of an auto-rigged hero, and makes wide sleeves follow the arm. Bone-heat weighting gives arm weights to everything near the arm in the rest pose:
a long strand of hair beside the elbow, the edge of a cape, so when the arm swings up the hair is dragged along with the hand ("the hand is tied to the hair").
Every vertex with arm weight is measured against the arm itself (a capsule from the shoulder joint down to the end of the hand bone): inside the capsule the
weights stay, outside they move to the torso bone at that height (head above the neck, chest above the hips, else the hips), with a soft band between.
    blender -b -P tools/fix_arm_weights.py -- in.glb out.glb [--inner 0.065] [--outer 0.1]      (radii in units of the hero's height)"""
import sys
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
r_in = float(argv[argv.index('--inner') + 1]) if '--inner' in argv else 0.065
r_out = float(argv[argv.index('--outer') + 1]) if '--outer' in argv else 0.10
simple = '--simple' in argv       # only the capsule test (no sleeve and body-column rules): best for twin tails and capes that hang beside the arms

ARM = {'L': ['Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Hand.L'], 'R': ['Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Hand.R']}
ARM_ALL = set(ARM['L'] + ARM['R'])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.find_armature() == rig]
mw = rig.matrix_world
bone = rig.data.bones


def head(n):
    return mw @ bone[n].head_local if n in bone else None


def tail(n):
    return mw @ bone[n].tail_local if n in bone else None


zs = [(mw @ b.head_local).z for b in bone] + [(mw @ b.tail_local).z for b in bone]
H = max(zs) - min(zs)
# the arm as a chain of segments: shoulder joint -> elbow -> wrist -> end of the hand
chains = {}
for s, names in ARM.items():
    pts = [p for p in [head('UpperArm.' + s), head('LowerArm.' + s), head('Hand.' + s), tail('Hand.' + s)] if p is not None]
    chains[s] = list(zip(pts[:-1], pts[1:]))
neck_z = head('Neck').z if 'Neck' in bone else (head('Head').z if 'Head' in bone else 0.8 * H)
hips_z = head('Chest').z if 'Chest' in bone else (head('Spine').z if 'Spine' in bone else 0.5 * H)


def arm_dist(p):
    best = 1.0e9
    for segs in chains.values():
        for a, b in segs:
            q, t = intersect_point_line(p, a, b)
            t = min(1.0, max(0.0, t))
            best = min(best, (p - (a + (b - a) * t)).length)
    return best


sl, sr = head('UpperArm.L'), head('UpperArm.R')
mid_x = (sl.x + sr.x) * 0.5 if sl is not None and sr is not None else 0.0
torso_half = abs(sl.x - sr.x) * 0.5 * 0.8 if sl is not None and sr is not None else 0.12 * H

moved = 0
touched = 0
rigid = 0
for ob in meshes:
    vg = ob.vertex_groups
    idx = {g.name: g.index for g in vg}
    arm_ids = {idx[n] for n in ARM_ALL if n in idx}
    if not arm_ids:
        continue
    torso = {}
    for n in ['Head', 'Chest', 'Spine', 'Hips']:
        if n in idx:
            torso[n] = idx[n]
    om = ob.matrix_world
    for v in ob.data.vertices:
        aw = [(g.group, g.weight) for g in v.groups if g.group in arm_ids and g.weight > 0.0]
        if not aw:
            continue
        p = om @ v.co
        d = arm_dist(p) / H
        if d <= r_in:
            continue
        inside = abs(p.x - mid_x) < torso_half and not simple
        if not simple and not inside and p.z > hips_z and d < 0.22:
            # beside the arm, outside the body: a sleeve or a cuff. It moves with the arm only (no tearing between arm and chest).
            others = [(g.group, g.weight) for g in v.groups if g.group not in arm_ids and g.weight > 0.0]
            if others:
                for gi, _w in others:
                    vg[gi].remove([v.index])
                rigid += 1
            continue
        keep = max(0.0, min(1.0, (r_out - d) / (r_out - r_in))) if not inside else 0.0
        total = sum(w for _, w in aw)
        give = total * (1.0 - keep)
        if give <= 1e-4:
            continue
        for gi, w in aw:
            if keep > 0.0:
                vg[gi].add([v.index], w * keep, 'REPLACE')
            else:
                vg[gi].remove([v.index])
        to = 'Head' if p.z > neck_z else ('Chest' if p.z > hips_z else ('Spine' if 'Spine' in torso else 'Hips'))
        if to not in torso:
            to = next(iter(torso)) if torso else None
        if to is None:
            continue
        cur = next((g.weight for g in v.groups if g.group == torso[to]), 0.0)
        vg[torso[to]].add([v.index], cur + give, 'REPLACE')
        touched += 1
        moved += 1 if keep == 0.0 else 0
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='AUTO', export_yup=True, export_skins=True)
print('ARMFIX', dst, 'vertices re-weighted', touched, 'fully freed', moved, 'sleeves made rigid', rigid, 'height %.2f' % H)
