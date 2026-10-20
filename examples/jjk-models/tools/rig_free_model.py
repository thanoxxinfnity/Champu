"""Rig an unrigged A/T-pose character (e.g. the CC-BY Sketchfab "Gojo Satoru (vs. Sukuna) free v2") with the game's bone names.

    blender -b in.blend -P tools/rig_free_model.py -- out.glb [height_m]

Scales to `height_m` (default 1.85) with feet on the floor, measures the body mesh (leg and arm centre lines, wrist, finger tips found
as separate mesh islands), builds the 21 body bones + 5 fingers x 3 joints per hand, then binds every mesh with Blender's heat-map
automatic weights (much better at shoulders/elbows than distance weights). Hair is bound 100% to the head."""
import bpy, bmesh, sys, math
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]
target_h = float(args[1]) if len(args) > 1 else 1.85

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in list(bpy.data.objects):
    if o.type not in ('MESH',):
        bpy.data.objects.remove(o, do_unlink=True)
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world.identity()
allv = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in meshes])
mn, mx = allv.min(0), allv.max(0)
k = target_h / (mx[2] - mn[2])
shift = Vector((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]))
for o in meshes:
    for v in o.data.vertices:
        v.co = (v.co + shift) * k
body = max(meshes, key=lambda o: len(o.data.vertices) if o.dimensions.x > 1.0 else 0)
hair = [o for o in meshes if o is not body and min(v.co.z for v in o.data.vertices) > target_h * 0.8]
cloth = [o for o in meshes if o is not body and o not in hair]
V = np.array([v.co[:] for v in body.data.vertices])
H = target_h
print('BODY', body.name, 'HAIR', [o.name for o in hair], 'CLOTH', [o.name for o in cloth])

def slab(axis, lo, hi, cond=None):
    s = V[(V[:, axis] >= lo) & (V[:, axis] < hi)]
    if cond is not None:
        s = s[cond(s)]
    return s

# ---- arms: centre line from slices along x
xs, ys, zs, widths = [], [], [], []
for x0 in np.arange(0.18, 0.95, 0.01):
    s = slab(0, x0, x0 + 0.01, lambda s: s[:, 2] > H * 0.55)
    if len(s) > 8:
        xs.append(x0 + 0.005); ys.append(np.median(s[:, 1])); zs.append((s[:, 2].min() + s[:, 2].max()) / 2); widths.append(s[:, 2].max() - s[:, 2].min())
xs, ys, zs, widths = map(np.array, (xs, ys, zs, widths))
tip_x = V[:, 0].max()
torso_half = None
for i in range(len(xs)):
    if widths[i] < 0.16:
        torso_half = xs[i]; break
torso_half = torso_half or 0.2
arm = (xs > torso_half) & (xs < tip_x - 0.22)
pz = np.polyfit(xs[arm], zs[arm], 1); py = np.polyfit(xs[arm], ys[arm], 1)
line = lambda x: Vector((x, float(np.polyval(py, x)), float(np.polyval(pz, x))))
# wrist: thinnest slice in the last third of the arm before the hand flares
cand = (xs > torso_half + (tip_x - torso_half) * 0.55) & (xs < tip_x - 0.12)
wrist_x = float(xs[cand][np.argmin(widths[cand])]) if cand.any() else tip_x - 0.2
shoulder_x = torso_half * 0.62
sh = line(torso_half + 0.02); sh_root = Vector((shoulder_x * 0.3, sh.y, sh.z - 0.01))
elbow_x = torso_half + (wrist_x - torso_half) * 0.53
print('ARM torso_half %.3f wrist %.3f tip %.3f' % (torso_half, wrist_x, tip_x))

# ---- legs
def leg_center(z):
    s = slab(2, z - 0.015, z + 0.015, lambda s: s[:, 0] > 0.0)
    return Vector((float(np.median(s[:, 0])), float(np.median(s[:, 1])), z)) if len(s) else Vector((0.1, 0, z))
crotch = H * 0.47
hip_j = Vector((0.0, 0.0, H * 0.53))
thigh = Vector((leg_center(H * 0.40).x, 0.0, crotch + 0.02))
knee = leg_center(H * 0.27); knee.z = H * 0.28
ankle = leg_center(H * 0.055); ankle.z = H * 0.05
feet = slab(2, 0.0, H * 0.04, lambda s: s[:, 0] > 0.0)
toe = Vector((ankle.x, float(feet[:, 1].min()) + 0.03, 0.02))
ball = Vector((ankle.x, (ankle.y + toe.y) / 2 - 0.02, 0.025))

# ---- fingers: islands beyond a cut across the hand
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0015)   # the mesh is split at UV seams; weld a copy so each finger is one island
bm.verts.ensure_lookup_table()
adir = (line(tip_x) - line(wrist_x)).normalized()
wr = line(wrist_x)
def islands(cut):
    sel = set(v.index for v in bm.verts if v.co.x > 0.2 and (v.co - wr).dot(adir) > cut and ((v.co - wr) - adir * (v.co - wr).dot(adir)).length < 0.13)
    seen, comps = set(), []
    for s in sel:
        if s in seen: continue
        stack, comp = [s], []
        seen.add(s)
        while stack:
            i = stack.pop(); comp.append(i)
            for e in bm.verts[i].link_edges:
                j = e.other_vert(bm.verts[i]).index
                if j in sel and j not in seen:
                    seen.add(j); stack.append(j)
        if len(comp) > 12: comps.append(comp)
    return comps
hand_len = (line(tip_x) - wr).length
def tip_base(c):
    P = np.array([bm.verts[i].co[:] for i in c])
    d = (P - np.array(wr[:])) @ np.array(adir[:])
    tip = Vector(P[np.argmax(d)])
    base = Vector(P[d < d.min() + 0.006].mean(0))
    return base, tip
fingers = {}
thumb_c = None
for f in np.arange(0.30, 0.95, 0.01):
    c = islands(hand_len * f)
    if thumb_c is None and len(c) == 2:
        thumb_c = (f, min(c, key=len))
    if len(c) >= 4 and thumb_c is not None and min(len(x) for x in sorted(c, key=len)[-4:]) > 60:
        four = sorted(c, key=len)[-4:]
        info = [tip_base(x) for x in four]
        info.sort(key=lambda t: t[1].y)                  # front (-y) to back: index, middle, ring, pinky
        for n, (b0, t) in zip(['index', 'middle', 'ring', 'pinky'], info):
            root = b0 - adir * hand_len * 0.22           # knuckle sits inside the palm, before the split
            fingers[n] = (root, t)
        b0, t = tip_base(thumb_c[1])
        fingers['thumb'] = (wr + (b0 - wr) * 0.45, t)
        print('FINGERS thumb cut %.2f fingers cut %.2f' % (thumb_c[0], f), {n: [round(x, 3) for x in fingers[n][1]] for n in fingers})
        break
if not fingers:
    print('FINGERS not found')
bm.free()

# ---- tuck the bare legs a little inside the wide trousers so a swaying hem never shows skin poking through
for v in body.data.vertices:
    p = v.co
    if H * 0.09 < p.z < H * 0.46 and abs(p.x) > 0.005:
        c = leg_center(p.z) if False else None
        axis_x = thigh.x * (1 if p.x > 0 else -1) + (knee.x - thigh.x) * 0.0
        k2 = 0.78
        p.x = axis_x + (p.x - axis_x) * k2
        p.y = p.y * k2
# ---- armature
spine_top = Vector((0, 0, H * 0.70)); chest_top = Vector((0, 0, sh.z - 0.02)); neck_top = Vector((0, 0, H * 0.87))
bpy.ops.object.armature_add(location=(0, 0, 0))
arm_obj = bpy.context.object; arm_obj.name = 'Armature'
A = arm_obj.data; A.name = 'Armature'
bpy.ops.object.mode_set(mode='EDIT')
eb = A.edit_bones
eb.remove(eb[0])
def bone(name, h, t, parent=None, connect=False):
    b = eb.new(name); b.head = h; b.tail = t
    if parent: b.parent = eb[parent]; b.use_connect = connect
    return b
bone('hips', hip_j - Vector((0, 0, 0.1)), hip_j + Vector((0, 0, 0.08)))
bone('spine', hip_j + Vector((0, 0, 0.08)), spine_top, 'hips', True)
bone('chest', spine_top, chest_top, 'spine', True)
bone('neck', chest_top, neck_top, 'chest', True)
bone('head', neck_top, Vector((0, 0, H * 0.99)), 'neck', True)
for side, sg in (('L', 1), ('R', -1)):
    m = lambda v: Vector((v.x * sg, v.y, v.z))
    bone('shoulder' + side, m(Vector((0.02, sh.y, chest_top.z - 0.03))), m(line(torso_half + 0.02)), 'chest')
    bone('upperarm' + side, m(line(torso_half + 0.02)), m(line(elbow_x)), 'shoulder' + side, True)
    bone('forearm' + side, m(line(elbow_x)), m(line(wrist_x)), 'upperarm' + side, True)
    bone('hand' + side, m(line(wrist_x)), m(line(wrist_x + hand_len * 0.45)), 'forearm' + side, True)
    bone('thigh' + side, m(thigh), m(knee), 'hips')
    bone('shin' + side, m(knee), m(ankle), 'thigh' + side, True)
    bone('foot' + side, m(ankle), m(ball), 'shin' + side, True)
    bone('toe' + side, m(ball), m(toe), 'foot' + side, True)
    for fn, (r, t) in fingers.items():
        p = 'hand' + side
        for j in range(3):
            a = r + (t - r) * (j / 3.0); b = r + (t - r) * ((j + 1) / 3.0)
            bone('%s%d%s' % (fn, j, side), m(a), m(b), p, j > 0); p = '%s%d%s' % (fn, j, side)
# ---- cloth chains: four hanging chains round each trouser leg (front/back/outer/inner) and two for the sash bow tails.
CV = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in cloth]) if cloth else V
def ring(side_x, z):
    s = CV[(CV[:, 2] > z - 0.02) & (CV[:, 2] < z + 0.02) & ((CV[:, 0] * np.sign(side_x)) > 0.0)]
    if len(s) < 6:
        return Vector((side_x, 0, z)), 0.12
    c = Vector((float(np.median(s[:, 0])), float(np.median(s[:, 1])), z))
    r = float(np.percentile(np.linalg.norm(s[:, :2] - np.array([c.x, c.y]), axis=1), 80))
    return c, max(0.06, r)
SWAY_TOP, SWAY_BOT = H * 0.40, H * 0.07
chain_dirs = {'F': Vector((0, -1, 0)), 'B': Vector((0, 1, 0)), 'O': Vector((1, 0, 0)), 'I': Vector((-1, 0, 0))}
leg_chains = []
for side, sg in (('L', 1), ('R', -1)):
    for ci, (cn, d) in enumerate(chain_dirs.items()):
        dd = Vector((d.x * sg, d.y, 0))
        pts = []
        for j in range(4):
            z = SWAY_TOP + (SWAY_BOT - SWAY_TOP) * j / 3.0
            c, r = ring(thigh.x * sg, z)
            pts.append(c + dd * r * 0.85)
        p = 'thigh' + side
        names = []
        for j in range(3):
            n = 'sway_leg%s%s_%d' % (side, cn, j)
            bone(n, pts[j], pts[j + 1], p, j > 0); p = n; names.append(n)
        leg_chains.append((side, dd, names, pts))
bow_front = float(CV[(CV[:, 2] > H * 0.55) & (CV[:, 2] < H * 0.64) & (np.abs(CV[:, 0]) < 0.12)][:, 1].min()) if len(CV) else -0.15
bow_chains = []
for bi, bx in enumerate((-0.035, 0.035)):
    a = Vector((bx, bow_front + 0.01, H * 0.635)); b2 = Vector((bx * 1.4, bow_front + 0.005, H * 0.585)); c2 = Vector((bx * 1.6, bow_front + 0.01, H * 0.53))
    bone('sway_bow%d_0' % bi, a, b2, 'hips'); bone('sway_bow%d_1' % bi, b2, c2, 'sway_bow%d_0' % bi, True)
    bow_chains.append(('sway_bow%d_0' % bi, 'sway_bow%d_1' % bi, a, b2, c2))
for b in eb:
    b.roll = 0.0
bpy.ops.object.mode_set(mode='OBJECT')

# ---- bind
def bind(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); arm_obj.select_set(True); bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    ok = any(len(o.vertex_groups) and True for _ in [0]) and any(g.name == 'hips' for g in o.vertex_groups)
    return ok
for o in [body] + cloth:
    bind(o)
    print('BOUND', o.name, len(o.vertex_groups))
# heat weights spread onto the cloth chains too; drop those everywhere first (skin must not follow cloth), then add them back on the cloth only
for o in [body] + cloth:
    for g in [g for g in o.vertex_groups if g.name.startswith('sway_')]:
        o.vertex_groups.remove(g)
    for v in o.data.vertices:
        if sum(g.weight for g in v.groups) < 1e-4:
            side = 'L' if v.co.x > 0 else 'R'
            n = 'shin' + side if v.co.z < H * 0.3 else ('thigh' + side if v.co.z < H * 0.5 else 'hips')
            (o.vertex_groups.get(n) or o.vertex_groups.new(name=n)).add([v.index], 1.0, 'REPLACE')
# hand the lower trouser legs and the bow tails over to the cloth chains (blended in from the top of each chain)
def seg_t(p, a, b):
    ab = b - a
    return max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
for o in cloth:
    groups = {g.name: g for g in o.vertex_groups}
    def G(n):
        return groups.get(n) or o.vertex_groups.new(name=n)
    for v in o.data.vertices:
        p = v.co
        # bow tails: in front of the belt, near the middle
        if abs(p.x) < 0.11 and p.y < bow_front + 0.035 and H * 0.52 < p.z < H * 0.64:
            ch = min(bow_chains, key=lambda c: abs(p.x - c[2].x))
            w = max(0.0, min(1.0, (H * 0.63 - p.z) / (H * 0.07)))
            if w <= 0.0:
                continue
            for g in list(v.groups):
                o.vertex_groups[g.group].add([v.index], g.weight * (1.0 - w), 'REPLACE')
            name = ch[0] if p.z > ch[3].z else ch[1]
            G(name).add([v.index], w, 'ADD')
            continue
        if p.z > SWAY_TOP or p.z < H * 0.085 or abs(p.x) < 0.01:      # shoes (below the hem) stay on the feet
            continue
        side = 'L' if p.x > 0 else 'R'
        chains = [c for c in leg_chains if c[0] == side]
        c0, _ = ring(thigh.x * (1 if side == 'L' else -1), p.z)
        rd = Vector((p.x - c0.x, p.y - c0.y, 0)).normalized()
        # two nearest chains by angle, weighted by how close the vertex is in angle
        sc = sorted(chains, key=lambda c: -rd.dot(c[1]))[:2]
        ws = [max(0.05, rd.dot(c[1]) + 1.0) for c in sc]
        tot = sum(ws)
        blend = 0.6 * max(0.0, min(1.0, (SWAY_TOP - p.z) / (H * 0.08)))   # cloth chains take up to 60 %; the rest keeps following the leg
        if blend <= 0.0:
            continue
        for g in list(v.groups):
            o.vertex_groups[g.group].add([v.index], g.weight * (1.0 - blend), 'REPLACE')
        for c, w in zip(sc, ws):
            pts = c[3]
            j = min(2, max(0, int((SWAY_TOP - p.z) / ((SWAY_TOP - SWAY_BOT) / 3.0))))
            G(c[2][j]).add([v.index], blend * w / tot, 'ADD')
# trousers, belt and the sash bow never follow the arms or fingers (heat weights leak into the bow from the nearby hands)
ARMISH = ('shoulder', 'upperarm', 'forearm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')
for o in cloth:
    gi = {g.index: g.name for g in o.vertex_groups}
    hips = o.vertex_groups.get('hips')
    for v in o.data.vertices:
        lost = 0.0
        for g in list(v.groups):
            if gi[g.group].startswith(ARMISH):
                lost += g.weight
                o.vertex_groups[g.group].remove([v.index])
        if lost > 0.0:
            keep = sum(g.weight for g in v.groups)
            if keep < 1e-4:
                hips.add([v.index], 1.0, 'REPLACE')
for o in hair:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); arm_obj.select_set(True); bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type='ARMATURE_NAME')
    g = o.vertex_groups.get('head') or o.vertex_groups.new(name='head')
    g.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
bpy.ops.wm.save_as_mainfile(filepath=out.replace('.glb', '.blend'))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_skins=True, export_yup=True, export_image_format='JPEG')
print('RIGGED', out)
