"""Rig the Gojo underwear body (A-pose, head grafted) and fit Gojo's clothes onto it.

    blender -b -P tools/rig_gojo_body.py -- models/gojo_underwear_headswap.glb raw/gojo_tv_split.glb gojo_final

Clothes come from the T-pose Triverse Gojo split (top, pants, sash, shoes). The sleeves of the top are bent down into the body's A-pose
with a smooth shoulder deformation, then every piece is weighted to one 51-bone armature measured from the body (5 fingers x 3 joints,
toes, spine...). The body keeps its own socks/shoes; the clothes sit over it."""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_split as rs

a = sys.argv[sys.argv.index('--') + 1:]
body_glb, cloth_glb, base = a[0], a[1], a[2]
ARM_DROP_DEG = float(os.environ.get('ARM_DROP', 32))
SH_X = float(os.environ.get('SH_X', 0.19))   # where the sleeve starts to bend (|x| from the centre line)
SH_Z = float(os.environ.get('SH_Z', 0.66))

bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    ms = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in ms:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world.identity()
    for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    return ms


body_objs = load(body_glb)
cloth_objs = load(cloth_glb)
names = {o.name: o for o in cloth_objs}
print('CLOTH', sorted(names))
# the body file holds two meshes: the body and the grafted head (head is the one whose centre is highest)
body_objs.sort(key=lambda o: sum((o.matrix_world @ v.co).z for v in o.data.vertices) / len(o.data.vertices))
body, head = body_objs[0], body_objs[1]
body.name, head.name = 'gojo_body', 'gojo_head'

# keep only the garments we want; drop the T-pose skin, hair and head of the clothed model
keep = {'p_top': 'top', 'p_pants': 'pants', 'p_sash': 'sash'}   # the body has its own socks and shoes
for n, o in list(names.items()):
    if n in keep:
        o.name = 'gojo_' + keep[n]
    else:
        bpy.data.objects.remove(o, do_unlink=True)
clothes = [o for o in bpy.data.objects if o.name.startswith('gojo_') and o.name not in ('gojo_body', 'gojo_head')]

# drop the stray dark outline shards the colour split left far out beside the hands (islands whose centre is beyond |x| > 0.42)
def drop_far_islands(obj, max_ax=0.42):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    seen, kill = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, comp = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        cx_ = sum(abs(g.calc_center_median().x) for g in comp) / len(comp)
        if cx_ > max_ax and len(comp) < 400:
            kill.extend(comp)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    print('SHARDS', obj.name, 'removed faces', len(kill))


drop_far_islands(bpy.data.objects['gojo_top'])

# ── bend the top's sleeves from T-pose down to the body's A-pose ────────────────
top = bpy.data.objects['gojo_top']
th = math.radians(ARM_DROP_DEG)
for v in top.data.vertices:
    ax = abs(v.co.x)
    t = max(0.0, min(1.0, (ax - SH_X) / 0.10))
    t = t * t * (3 - 2 * t)
    if t <= 0.0:
        continue
    s = 1.0 if v.co.x > 0 else -1.0
    pivot = Vector((s * SH_X, 0.0, SH_Z))
    p = v.co - pivot
    ang = s * th * t                       # rotate about Y so the sleeve end swings down
    c, sn = math.cos(ang), math.sin(ang)
    v.co = pivot + Vector((p.x * c + p.z * sn, p.y, -p.x * sn + p.z * c))

# ── measure the body and build the armature ─────────────────────────────────────
H = 1.979
cx = 0.0
temp = []


def points_obj(name, pts):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in pts], [], [])
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    temp.append(o)
    return o


bv = [v.co.copy() for v in body.data.vertices]
parts = {}
roles = {}
for side, sg in (('L', 1), ('R', -1)):
    parts['arm' + side] = points_obj('arm' + side, [p for p in bv if sg * p.x > 0.20 and p.z > -0.15])
    roles['arm' + side] = 'arm' + side
    parts['shoe' + side] = points_obj('shoe' + side, [p for p in bv if sg * p.x > 0 and p.z < -0.90])
    roles['shoe' + side] = 'shoe' + side
parts['torso'] = points_obj('torso', [p for p in bv if abs(p.x) < 0.2])
roles['torso'] = 'torso'
cfg = {'frac': {'shoulder_x': 0.095, 'shoulder_z': 0.815, 'tip_z': 0.0, 'elbow_at': 0.47, 'hand_frac': 0.2, 'hip_x': 0.08,
                'pelvis': 0.505, 'spine': 0.60, 'chest': 0.70, 'neck': 0.80, 'head': 0.84, 'knee': 0.27, 'ankle': 0.075}}
P, Hm, floor = rs.fit(parts, roles, cfg)
arm = rs.build_armature(P, {})
segs = rs.segments(arm)
for o in temp:
    bpy.data.objects.remove(o, do_unlink=True)

all_bones = list(segs)
FINGER = ('thumb', 'index', 'middle', 'ring', 'pinky')


def bones_of(prefixes_exact=(), starts=()):
    return [b for b in all_bones if b in prefixes_exact or any(b.startswith(s) for s in starts)]


allowed = {
    'gojo_body': all_bones,
    'gojo_top': bones_of(('hips', 'spine', 'chest', 'neck', 'shoulderL', 'shoulderR', 'upperarmL', 'upperarmR', 'forearmL', 'forearmR')),
    'gojo_pants': bones_of(('hips', 'spine', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR')),
    'gojo_sash': bones_of(('hips', 'spine')),
}


def weight(obj, names_allowed, power=3.0):
    for n in names_allowed:
        obj.vertex_groups.new(name=n)
    groups = {g.name: g for g in obj.vertex_groups}
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        ds = sorted(((rs.seg_dist(p, *segs[n]), n) for n in names_allowed))[:3]
        ws = [1.0 / (d + 0.004) ** power for d, _ in ds]
        tot = sum(ws)
        for (d, n), w in zip(ds, ws):
            groups[n].add([v.index], w / tot, 'REPLACE')
    m = obj.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    obj.parent = arm


for o in [body] + clothes:
    weight(o, allowed[o.name])
rs.rigid(head, arm, 'head')
head.vertex_groups['head'].add([v.index for v in head.data.vertices], 1.0, 'REPLACE')
for o in [body, head] + clothes:
    for p in o.data.polygons:
        p.use_smooth = True
arm.name = base + '_rig'
out = os.path.join(os.path.dirname(os.path.abspath(body_glb)), base)
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', export_skins=True, export_image_format='JPEG', export_yup=True)
print('RIGGED', base, 'bones', len(arm.data.bones), 'objects', len([o for o in bpy.data.objects if o.type == 'MESH']))
