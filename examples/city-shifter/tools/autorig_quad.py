"""A generated, standing four-legged model (a horse) -> skinned GLB with a real quadruped skeleton.
    blender -b -P tools/autorig_quad.py -- in.glb out.glb [--length 2.4] [--preview /tmp/p.png]
The model may face any horizontal way; it is turned so the head points to Blender +Y (= glTF -Z, the game's forward), put on the floor and fitted to `length`
metres (nose to tail). The joints are measured on the mesh itself (leg positions by quadrant, back height, neck and head from the highest vertices, the tail
from the rearmost), the weights are the three nearest bone segments (inverse distance cubed), a leg bone only ever pulls vertices of its own quadrant.
Bones: Pelvis Spine1 Spine2 Chest Neck1 Neck2 Head EarL EarR  {FL,FR}_{Upper,Lower,Cannon,Hoof}  {HL,HR}_{Thigh,Shin,Cannon,Hoof}  Tail0..Tail3 (see scripts/horse_rig.gd)."""
import math, os, sys
import bpy
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
length = float(argv[argv.index('--length') + 1]) if '--length' in argv else 2.4
preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
max_tris = int(argv[argv.index('--max-tris') + 1]) if '--max-tris' in argv else 9000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'horse'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o != body:
        bpy.data.objects.remove(o, do_unlink=True)
me = body.data


def bbox():
    vs = [v.co for v in me.vertices]
    return Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))), Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))


def rot_z(deg):
    me.transform(Matrix.Rotation(math.radians(deg), 4, 'Z'))
    me.update()


# 1. the long horizontal axis goes along Y, the head to +Y
mn, mx = bbox()
if (mx.x - mn.x) > (mx.y - mn.y):
    rot_z(90)
mn, mx = bbox()
H = mx.z - mn.z
top = [v.co for v in me.vertices if v.co.z > mn.z + 0.8 * H]
mid_y = (mn.y + mx.y) * 0.5
if sum(c.y for c in top) / max(len(top), 1) < mid_y:       # the head (highest part) is at -Y: turn around
    rot_z(180)
mn, mx = bbox()
# 2. on the floor, centred, fitted to `length`
k = length / (mx.y - mn.y)
cx = (mn.x + mx.x) * 0.5
cy = (mn.y + mx.y) * 0.5
me.transform(Matrix.Translation(Vector((-cx, -cy, -mn.z))))
me.transform(Matrix.Scale(k, 4))
me.update()
ntris = sum(len(p.vertices) - 2 for p in me.polygons)
if ntris > max_tris:
    mod = body.modifiers.new('dec', 'DECIMATE')
    mod.ratio = max_tris / ntris
    bpy.ops.object.modifier_apply(modifier='dec')
    me = body.data
for ma in me.materials:
    if ma and ma.use_nodes:
        for nd in ma.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image and max(nd.image.size) > 1024:
                kk = 1024 / max(nd.image.size)
                nd.image.scale(int(nd.image.size[0] * kk), int(nd.image.size[1] * kk))
mn, mx = bbox()
Hz = mx.z
L = mx.y - mn.y
vs = [v.co for v in me.vertices]


def mean(pts):
    pts = list(pts)
    return sum(pts, Vector()) / max(len(pts), 1)


# 3. measure
legs = {}
y_mid = 0.0
for fore in (True, False):
    for left in (True, False):
        pts = [c for c in vs if 0.05 * Hz < c.z < 0.30 * Hz and ((c.y > y_mid) == fore) and ((c.x < 0) == left)]
        legs[('F' if fore else 'H') + ('L' if left else 'R')] = mean(pts) if pts else Vector((-0.12 if left else 0.12, 0.5 * L * (0.5 if fore else -0.5), 0))
yf = (legs['FL'].y + legs['FR'].y) * 0.5
yh = (legs['HL'].y + legs['HR'].y) * 0.5
centre = [c for c in vs if yh + 0.1 * L < c.y < yf - 0.1 * L]
back_z = max((c.z for c in centre), default=0.7 * Hz)
spine_z = back_z - 0.12 * Hz
y_butt = max((c.y for c in vs if c.z > 0.45 * Hz), default=yh - 0.15 * L)
y_tail_end = mn.y
tail_pts = [c for c in vs if c.y < mn.y + 0.05 * L]
tail_tip = mean(tail_pts) if tail_pts else Vector((0, mn.y, 0.45 * Hz))
poll_pts = [c for c in vs if c.z > 0.9 * Hz]
poll = mean(poll_pts)
nose_pts = sorted([c for c in vs if c.z > 0.55 * Hz], key=lambda c: -c.y)[:20]
nose = mean(nose_pts)
print('MEASURE yf %.2f yh %.2f back %.2f spine %.2f poll (%.2f,%.2f) nose (%.2f,%.2f) tail_tip z %.2f' % (yf, yh, back_z, spine_z, poll.y, poll.z, nose.y, nose.z, tail_tip.z))
# the tail: the rearmost side is the model's -Y end? (the head is +Y, the tail the other end)
# 4. the skeleton
B = {}


def bone(name, head, tail, parent=None):
    B[name] = (Vector(head), Vector(tail), parent)


def V(x, y, z):
    return (x, y, z)


bone('Pelvis', V(0, y_butt - 0.08 * L, spine_z), V(0, yh + (yf - yh) * 0.25, spine_z))
bone('Spine1', V(0, yh + (yf - yh) * 0.25, spine_z), V(0, yh + (yf - yh) * 0.55, spine_z), 'Pelvis')
bone('Spine2', V(0, yh + (yf - yh) * 0.55, spine_z), V(0, yf - 0.02 * L, spine_z + 0.01 * Hz), 'Spine1')
bone('Chest', V(0, yf - 0.02 * L, spine_z + 0.01 * Hz), V(0, yf + 0.06 * L, spine_z + 0.05 * Hz), 'Spine2')
neck_a = Vector((0, yf + 0.06 * L, spine_z + 0.05 * Hz))
neck_mid = neck_a.lerp(Vector((0, poll.y, poll.z)), 0.5)
bone('Neck1', neck_a, neck_mid, 'Chest')
bone('Neck2', neck_mid, V(0, poll.y, poll.z), 'Neck1')
bone('Head', V(0, poll.y, poll.z), V(0, nose.y, nose.z), 'Neck2')
bone('EarL', V(-0.025 * L, poll.y, poll.z), V(-0.03 * L, poll.y - 0.0 * L, poll.z + 0.05 * Hz), 'Head')
bone('EarR', V(0.025 * L, poll.y, poll.z), V(0.03 * L, poll.y - 0.0 * L, poll.z + 0.05 * Hz), 'Head')
for side in ('L', 'R'):
    f = legs['F' + side]
    h = legs['H' + side]
    fx, hx = f.x, h.x
    sz = spine_z
    # front: shoulder -> elbow -> knee -> fetlock -> hoof
    z1, z2, z3, z4 = sz * 0.60, sz * 0.34, sz * 0.10, 0.02 * Hz
    bone(f'F{side}_Upper', V(fx, f.y, sz - 0.02 * Hz), V(fx, f.y - 0.01 * L, z1), 'Chest')
    bone(f'F{side}_Lower', V(fx, f.y - 0.01 * L, z1), V(fx, f.y, z2), f'F{side}_Upper')
    bone(f'F{side}_Cannon', V(fx, f.y, z2), V(fx, f.y + 0.01 * L, z3), f'F{side}_Lower')
    bone(f'F{side}_Hoof', V(fx, f.y + 0.01 * L, z3), V(fx, f.y + 0.03 * L, z4), f'F{side}_Cannon')
    # hind: hip -> stifle -> hock -> fetlock -> hoof (the hock sits behind the line of the leg)
    bone(f'H{side}_Thigh', V(hx, h.y, sz), V(hx, h.y + 0.02 * L, sz * 0.56), 'Pelvis')
    bone(f'H{side}_Shin', V(hx, h.y + 0.02 * L, sz * 0.56), V(hx, h.y - 0.07 * L, sz * 0.34), f'H{side}_Thigh')
    bone(f'H{side}_Cannon', V(hx, h.y - 0.07 * L, sz * 0.34), V(hx, h.y - 0.03 * L, z3), f'H{side}_Shin')
    bone(f'H{side}_Hoof', V(hx, h.y - 0.03 * L, z3), V(hx, h.y, z4), f'H{side}_Cannon')
tail_root = Vector((0, y_butt - 0.04 * L, spine_z + 0.02 * Hz))
for i in range(4):
    a = tail_root.lerp(tail_tip, i / 4.0)
    b = tail_root.lerp(tail_tip, (i + 1) / 4.0)
    bone(f'Tail{i}', a, b, 'Pelvis' if i == 0 else f'Tail{i - 1}')

arm = bpy.data.armatures.new('Armature')
rig = bpy.data.objects.new('Armature', arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for nm, (h, t, p) in B.items():
    e = arm.edit_bones.new(nm)
    e.head, e.tail = h, t
    eb[nm] = e
for nm, (h, t, p) in B.items():
    if p:
        eb[nm].parent = eb[p]
bpy.ops.object.mode_set(mode='OBJECT')


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


for nm in B:
    body.vertex_groups.new(name=nm)
core = [n for n in B if '_' not in n and not n.startswith('Tail')]
tail = [n for n in B if n.startswith('Tail')]
for v in me.vertices:
    c = v.co
    fore = c.y > (yf + yh) * 0.5
    left = c.x < 0
    q = ('F' if fore else 'H') + ('L' if left else 'R')
    pool = list(core) + [n for n in B if n.startswith(q + '_')]
    pool += [n for n in tail if seg_dist(c, B[n][0], B[n][1]) < 0.12 * L]
    ds = sorted(((seg_dist(c, B[n][0], B[n][1]), n) for n in pool))[:3]
    ws = [1.0 / (max(d, 1e-4) ** 3) for d, _ in ds]
    s = sum(ws)
    for (d, n), w in zip(ds, ws):
        body.vertex_groups[n].add([v.index], w / s, 'REPLACE')
body.parent = rig
body.modifiers.new('Armature', 'ARMATURE').object = rig
for p in me.polygons:
    p.use_smooth = True
print('BONES', len(B), 'VERTS', len(me.vertices), 'TRIS', sum(len(p.vertices) - 2 for p in me.polygons), 'HEIGHT %.2f LENGTH %.2f' % (Hz, L))
os.makedirs(os.path.dirname(dst) or '.', exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_yup=True, export_skins=True)
print('SAVED', dst, os.path.getsize(dst) // 1024, 'KB')

if preview:
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = 900, 600
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    pb = rig.pose.bones
    for nm, ang in (('FL_Upper', -50), ('FL_Lower', 70), ('HR_Thigh', 40), ('HR_Shin', -50), ('Neck1', 25), ('Head', 20), ('Tail1', 30), ('Spine1', 10)):
        pb[nm].rotation_mode = 'XYZ'
        pb[nm].rotation_euler = (math.radians(ang), 0, 0)
    bpy.ops.object.mode_set(mode='OBJECT')
    for name, loc in (('side', (6.0, 0, 1.2)), ('front', (0, 6.0, 1.4))):
        cam.location = loc
        cam.rotation_euler = (Vector((0, 0, 1.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = preview.replace('.png', f'_{name}.png')
        bpy.ops.render.render(write_still=True)
