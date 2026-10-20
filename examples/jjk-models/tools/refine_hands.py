"""Rebuild the hand skin weights so each finger follows only its own bones.

    blender -b models/x.blend -P tools/refine_hands.py -- out_glb_path

Distance-based weights blend neighbouring fingers together, which is why a closed fist crumples. For every vertex beyond the knuckle line
of each hand: find the nearest finger chain (thumb included) and weight it only to that chain's three bones (distance^-3), fading to the
hand bone across the knuckle line. The palm and wrist are left as they were."""
import bpy, sys, os, math
from mathutils import Vector

out = sys.argv[sys.argv.index('--') + 1]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name == 'body'] or [o for o in bpy.data.objects if o.type == 'MESH']
body = max(body, key=lambda o: len(o.data.vertices))
M = arm.matrix_world
bones = arm.data.bones
FING = ('thumb', 'index', 'middle', 'ring', 'pinky')


def seg(b):
    return M @ bones[b].head_local, M @ bones[b].tail_local


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (p - (a + ab * t)).length


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


changed = 0
for side, sg in (('L', 1), ('R', -1)):
    H = M @ bones['hand' + side].head_local
    tip = M @ bones['hand' + side].tail_local
    d = (tip - H).normalized()
    base_t = ((M @ bones['index0' + side].head_local) - H).dot(d)
    chains = {f: [f'{f}{j}{side}' for j in range(3)] for f in FING}
    segs = {b: seg(b) for c in chains.values() for b in c}
    reach = (M @ bones['middle2' + side].tail_local - H).length * 1.25
    for v in body.data.vertices:
        p = body.matrix_world @ v.co
        if (p - H).length > reach or sg * (p.x - H.x) < -0.02:
            continue
        t = (p - H).dot(d)
        blend = smooth((t - base_t * 0.8) / (base_t * 0.5))
        if blend <= 0.001:
            continue
        # which finger is this vertex part of? nearest chain by its three segments
        best, bd = None, 1e9
        for f, names in chains.items():
            dist = min(seg_dist(p, *segs[b]) for b in names)
            if dist < bd:
                best, bd = f, dist
        names = chains[best]
        ws = [1.0 / (seg_dist(p, *segs[b]) + 0.003) ** 3 for b in names]
        tot = sum(ws)
        # keep the existing weight on every other bone (arm, forearm...) but scale it down by `blend`; the hand bone keeps the rest
        old = {g.group: g.weight for g in v.groups}
        gi = {vg.name: vg.index for vg in body.vertex_groups}
        keep = 1.0 - blend
        for g_idx, w in old.items():
            name = body.vertex_groups[g_idx].name
            if name.startswith(FING):
                body.vertex_groups[g_idx].remove([v.index])   # drop the old, mixed finger weights
        total_old = sum(w for g_idx, w in old.items() if not body.vertex_groups[g_idx].name.startswith(FING))
        for g_idx, w in old.items():
            name = body.vertex_groups[g_idx].name
            if not name.startswith(FING) and total_old > 0:
                body.vertex_groups[g_idx].add([v.index], w / total_old * keep, 'REPLACE')
        for b, w in zip(names, ws):
            body.vertex_groups[gi[b]].add([v.index], blend * w / tot, 'ADD')
        changed += 1
print('HANDS refined vertices', changed)
bpy.ops.wm.save_mainfile()
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_skins=True, export_image_format='JPEG', export_yup=True)
print('EXPORTED', out)
