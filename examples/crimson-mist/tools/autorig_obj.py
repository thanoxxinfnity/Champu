"""Static T-pose OBJ -> skinned humanoid GLB (auto-rig from body-proportion fractions, weights by segment distance).
    blender -b -P tools/autorig_obj.py -- model.obj out.glb [preview.png] [--height 1.55] [--tail]
The model must be a front-facing (-Y) T-pose standing on z=0 after the OBJ import. Fractions were measured on Mococo Abyssgard
and are a starting point for similar chibi-ish anime proportions."""
import math, os, sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
preview = argv[2] if len(argv) > 2 and not argv[2].startswith('--') else None
height = float(argv[argv.index('--height') + 1]) if '--height' in argv else 1.55
has_tail = '--tail' in argv

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = os.path.splitext(os.path.basename(dst))[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
vs = body.data.vertices
H0 = max(v.co.z for v in vs) - min(v.co.z for v in vs)
k = height / H0
for v in vs:
    v.co = v.co * k
zmin = min(v.co.z for v in vs)
for v in vs:
    v.co.z -= zmin
H = height

# joints as fractions of height (x is half-width, y negative = front)
def P(x, y, z):
    return Vector((x * H, y * H, z * H))

hx = 0.0
J = {
    'Hips': (P(0, 0, .553), P(0, 0, .60)),
    'Spine': (P(0, 0, .60), P(0, 0, .69)),
    'Chest': (P(0, 0, .69), P(0, 0, .77)),
    'Neck': (P(0, 0, .77), P(0, 0, .81)),
    'Head': (P(0, 0, .81), P(0, 0, .99)),
}
parent = {'Hips': None, 'Spine': 'Hips', 'Chest': 'Spine', 'Neck': 'Chest', 'Head': 'Neck'}
for s, sg in (('L', 1), ('R', -1)):
    J[f'Shoulder.{s}'] = (P(0, 0, .775), P(sg * .047, 0, .775))
    J[f'UpperArm.{s}'] = (P(sg * .047, 0, .775), P(sg * .165, 0, .775))
    J[f'LowerArm.{s}'] = (P(sg * .165, 0, .775), P(sg * .278, 0, .775))
    J[f'Hand.{s}'] = (P(sg * .278, 0, .775), P(sg * .335, 0, .775))
    J[f'UpperLeg.{s}'] = (P(sg * .027, 0, .553), P(sg * .027, 0, .306))
    J[f'LowerLeg.{s}'] = (P(sg * .027, 0, .306), P(sg * .027, 0, .106))
    J[f'Foot.{s}'] = (P(sg * .027, 0, .106), P(sg * .027, -.085, .035))
    J[f'Toes.{s}'] = (P(sg * .027, -.085, .035), P(sg * .027, -.14, .02))
    parent.update({f'Shoulder.{s}': 'Chest', f'UpperArm.{s}': f'Shoulder.{s}', f'LowerArm.{s}': f'UpperArm.{s}', f'Hand.{s}': f'LowerArm.{s}',
                   f'UpperLeg.{s}': 'Hips', f'LowerLeg.{s}': f'UpperLeg.{s}', f'Foot.{s}': f'LowerLeg.{s}', f'Toes.{s}': f'Foot.{s}'})

tail_names = []
if has_tail:  # follow the tail geometry: vertices clearly behind the body
    tv = [v.co for v in vs if v.co.y > .06 * H and .2 * H < v.co.z < .75 * H]
    tv.sort(key=lambda c: c.y)
    n = 5
    pts = [Vector((0, .02 * H, .55 * H))]
    for i in range(n):
        chunk = tv[int(len(tv) * i / n):int(len(tv) * (i + 1) / n)] or tv[-1:]
        pts.append(Vector((sum(c.x for c in chunk) / len(chunk), sum(c.y for c in chunk) / len(chunk), sum(c.z for c in chunk) / len(chunk))))
    for i in range(n):
        nm = f'Tail{i}'
        J[nm] = (pts[i], pts[i + 1])
        parent[nm] = 'Hips' if i == 0 else f'Tail{i - 1}'
        tail_names.append(nm)

arm = bpy.data.armatures.new('Armature')
rig = bpy.data.objects.new('Armature', arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for nm, (a, b) in J.items():
    e = arm.edit_bones.new(nm)
    e.head, e.tail = a, b
    eb[nm] = e
for nm, p in parent.items():
    if p:
        eb[nm].parent = eb[p]
bpy.ops.object.mode_set(mode='OBJECT')


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


for nm in J:
    body.vertex_groups.new(name=nm)
body_names = [n for n in J if n not in tail_names]
for v in vs:
    c = v.co
    pool = tail_names if (has_tail and c.y > .06 * H and .2 * H < c.z < .75 * H) else body_names
    if pool is body_names:
        side = c.x
        pool = [n for n in body_names if not (n.endswith('.L') and side < -.02 * H) and not (n.endswith('.R') and side > .02 * H)]
    ds = sorted(((seg_dist(c, *J[n]), n) for n in pool))[:3]
    ws = [1 / (max(d, 1e-4) ** 3) for d, _ in ds]
    s = sum(ws)
    for (d, n), w in zip(ds, ws):
        body.vertex_groups[n].add([v.index], w / s, 'REPLACE')
body.parent = rig
body.modifiers.new('Armature', 'ARMATURE').object = rig
for p in body.data.polygons:
    p.use_smooth = True
print('BONES', len(J), 'VERTS', len(vs), 'TRIS', sum(len(p.vertices) - 2 for p in body.data.polygons))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='AUTO', export_yup=True, export_skins=True)
print('SAVED', dst, os.path.getsize(dst) // 1024, 'KB')

if preview:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 12
    sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 600, 800
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.82, 0.9, 1)
    sc.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    # pose test: raise left arm, bend right knee, swing tail to prove the weights
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    pb = rig.pose.bones
    pb['UpperArm.L'].rotation_mode = 'XYZ'
    pb['UpperArm.L'].rotation_euler = (0, math.radians(-70), 0)
    pb['UpperLeg.R'].rotation_mode = 'XYZ'
    pb['UpperLeg.R'].rotation_euler = (math.radians(-60), 0, 0)
    pb['LowerLeg.R'].rotation_mode = 'XYZ'
    pb['LowerLeg.R'].rotation_euler = (math.radians(70), 0, 0)
    pb['Head'].rotation_mode = 'XYZ'
    pb['Head'].rotation_euler = (0, 0, math.radians(25))
    for nm in tail_names:
        pb[nm].rotation_mode = 'XYZ'
        pb[nm].rotation_euler = (0, 0, math.radians(18))
    bpy.ops.object.mode_set(mode='OBJECT')
    for yaw, name in ((0, 'front'), (180, 'back'), (90, 'posed')):
        cam.location = (math.sin(math.radians(yaw)) * -3.0, math.cos(math.radians(yaw)) * -3.0, 0.8)
        cam.rotation_euler = (Vector((0, 0, 0.8)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        if name == 'posed':
            cam.location = (0, -3.0, 0.8)
            cam.rotation_euler = (Vector((0, 0, 0.8)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = preview.replace('.png', f'_{name}.png')
        bpy.ops.render.render(write_still=True)
