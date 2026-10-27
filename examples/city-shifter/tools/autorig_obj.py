"""Static T-pose OBJ -> skinned humanoid GLB (auto-rig from body-proportion fractions, weights by segment distance).
    blender -b -P tools/autorig_obj.py -- model.obj out.glb [preview.png] [--height 1.55] [--tail]
The model must be a front-facing (-Y) T-pose standing on z=0 after the OBJ import. Fractions were measured on Mococo Abyssgard
and are a starting point for similar chibi-ish anime proportions."""
import math, os, sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
joints_file = argv[argv.index('--joints') + 1] if '--joints' in argv else None
preview = argv[2] if len(argv) > 2 and not argv[2].startswith('--') else None
height = float(argv[argv.index('--height') + 1]) if '--height' in argv else 1.55
has_tail = '--tail' in argv
adaptive = '--adaptive' in argv          # measure the joints on the mesh itself (T-pose humanoids)
want_hair = '--hair' in argv
want_skirt = '--skirt' in argv
max_tris = int(argv[argv.index('--max-tris') + 1]) if '--max-tris' in argv else 0

bpy.ops.wm.read_factory_settings(use_empty=True)
(bpy.ops.wm.obj_import if src.lower().endswith('.obj') else bpy.ops.import_scene.gltf)(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = os.path.splitext(os.path.basename(dst))[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
ADAPTIVE_SPEC = None
if adaptive:
    import statistics
    vs0 = body.data.vertices
    xs = [v.co.x for v in vs0]
    cx = (min(xs) + max(xs)) / 2
    for v in vs0:
        v.co.x -= cx
    zmin0, zmax0 = min(v.co.z for v in vs0), max(v.co.z for v in vs0)
    H0 = zmax0 - zmin0
    side = sorted(vs0, key=lambda v: -abs(v.co.x))[:max(8, len(vs0) // 60)]
    A = statistics.median(abs(v.co.x) for v in side) * 1.15           # arm span (half)
    arm_z = statistics.median(v.co.z for v in side)
    legs = [v for v in vs0 if zmin0 + 0.12 * H0 < v.co.z < zmin0 + 0.32 * H0]
    lx = statistics.median(abs(v.co.x) for v in legs if abs(v.co.x) > 0.01) if legs else 0.06 * H0
    lx = min(max(lx, 0.04 * H0), 0.14 * H0)
    z = lambda f: zmin0 + f * H0
    neck_z = arm_z + 0.015 * H0
    B = {}

    def bone(name, head, tail, parent=None, sway=False):
        B[name] = {'head': head, 'tail': tail, 'parent': parent, 'sway': sway}

    bone('Hips', [0, 0, z(0.52)], [0, 0, z(0.58)])
    bone('Spine', [0, 0, z(0.58)], [0, 0, z(0.66)], 'Hips')
    bone('Chest', [0, 0, z(0.66)], [0, 0, neck_z], 'Spine')
    bone('Neck', [0, 0, neck_z], [0, 0, neck_z + 0.04 * H0], 'Chest')
    bone('Head', [0, 0, neck_z + 0.04 * H0], [0, 0, zmax0], 'Neck')
    for sd, sg in (('L', 1), ('R', -1)):
        bone(f'Shoulder.{sd}', [0.0, 0, arm_z], [sg * 0.2 * A, 0, arm_z], 'Chest')
        bone(f'UpperArm.{sd}', [sg * 0.2 * A, 0, arm_z], [sg * 0.52 * A, 0, arm_z], f'Shoulder.{sd}')
        bone(f'LowerArm.{sd}', [sg * 0.52 * A, 0, arm_z], [sg * 0.8 * A, 0, arm_z], f'UpperArm.{sd}')
        bone(f'Hand.{sd}', [sg * 0.8 * A, 0, arm_z], [sg * A, 0, arm_z], f'LowerArm.{sd}')
        bone(f'UpperLeg.{sd}', [sg * lx, 0, z(0.52)], [sg * lx * 1.05, 0, z(0.29)], 'Hips')
        bone(f'LowerLeg.{sd}', [sg * lx * 1.05, 0, z(0.29)], [sg * lx * 1.05, 0, z(0.06)], f'UpperLeg.{sd}')
        bone(f'Foot.{sd}', [sg * lx * 1.05, 0, z(0.06)], [sg * lx * 1.05, -0.09 * H0, z(0.02)], f'LowerLeg.{sd}')
        bone(f'Toes.{sd}', [sg * lx * 1.05, -0.09 * H0, z(0.02)], [sg * lx * 1.05, -0.15 * H0, z(0.01)], f'Foot.{sd}')
    if want_hair:
        for i, (a, b) in enumerate(((0.93, 0.8), (0.8, 0.66), (0.66, 0.52))):
            bone(f'sway_hair{i}', [0, 0.05 * H0, z(a)], [0, 0.06 * H0, z(b)], 'Head' if i == 0 else f'sway_hair{i - 1}', True)
    if want_skirt:
        for sx, sy, nm in ((0.07, -0.05, 'FL'), (-0.07, -0.05, 'FR'), (0.07, 0.05, 'BL'), (-0.07, 0.05, 'BR')):
            bone(f'sway_skirt{nm}0', [sx * H0, sy * H0, z(0.5)], [sx * H0 * 1.2, sy * H0 * 1.2, z(0.36)], 'Hips', True)
            bone(f'sway_skirt{nm}1', [sx * H0 * 1.2, sy * H0 * 1.2, z(0.36)], [sx * H0 * 1.3, sy * H0 * 1.3, z(0.22)], f'sway_skirt{nm}0', True)
    ADAPTIVE_SPEC = {'bones': B}
    print('ADAPTIVE arm_z %.2f A %.2f leg_x %.2f H %.2f' % (arm_z, A, lx, H0))

ntris = sum(len(p.vertices) - 2 for p in body.data.polygons)
if max_tris and ntris > max_tris:
    mod = body.modifiers.new('dec', 'DECIMATE')
    mod.ratio = max_tris / ntris
    bpy.ops.object.modifier_apply(modifier='dec')
if '--flat-mat' in argv:      # generated models whose metal/roughness texture would make them mirror-black: keep only the base colour
    for ma in body.data.materials:
        if ma and ma.use_nodes:
            nt = ma.node_tree
            bsdf = next((x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED'), None)
            for nd in list(nt.nodes):
                if nd.type == 'TEX_IMAGE' and not any(l.from_node == nd and l.to_socket.name == 'Base Color' for l in nt.links):
                    nt.nodes.remove(nd)
            for nd in list(nt.nodes):
                if nd.type in ('SEPARATE_COLOR', 'SEPARATE_RGB', 'MATH'):
                    nt.nodes.remove(nd)
            if bsdf:
                bsdf.inputs['Metallic'].default_value = 0.0
                bsdf.inputs['Roughness'].default_value = 0.85
for ma in body.data.materials:
    if ma and ma.use_nodes:
        for nd in ma.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image and max(nd.image.size) > 1024:
                kk = 1024 / max(nd.image.size)
                nd.image.scale(int(nd.image.size[0] * kk), int(nd.image.size[1] * kk))
vs = body.data.vertices
H0 = max(v.co.z for v in vs) - min(v.co.z for v in vs)
k = height / H0
for v in vs:
    v.co = v.co * k
zmin_s = min(v.co.z for v in vs)
zmin = zmin_s / k
for v in vs:
    v.co.z -= zmin_s
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
    tv = [v.co for v in vs if v.co.y > .06 * H and .2 * H < v.co.z < .66 * H and abs(v.co.x) < .16 * H]
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

sway_set = set(tail_names)
if joints_file or adaptive:  # explicit joints measured on the mesh (raw model units, Blender axes: front = -Y, left = +X)
    import json
    spec = ADAPTIVE_SPEC if adaptive else json.load(open(joints_file))
    J, parent, sway_set = {}, {}, set()
    for nm, b in spec['bones'].items():
        h = Vector(b['head']) * k
        t = Vector(b['tail']) * k
        h.z -= zmin * k
        t.z -= zmin * k
        J[nm] = (h, t)
        parent[nm] = b.get('parent')
        if b.get('sway'):
            sway_set.add(nm)
    tail_names = [n for n in J if n in sway_set]
    has_tail = False

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
    if joints_file or adaptive:
        pool = [n for n in body_names if not (n.endswith('.L') and c.x < -.02 * H) and not (n.endswith('.R') and c.x > .02 * H)]
        pool += [n for n in tail_names if seg_dist(c, *J[n]) < .07 * H]
    else:
        pool = tail_names if (has_tail and c.y > .06 * H and .2 * H < c.z < .66 * H and abs(c.x) < .16 * H) else body_names
        if pool is body_names:
            pool = [n for n in body_names if not (n.endswith('.L') and c.x < -.02 * H) and not (n.endswith('.R') and c.x > .02 * H)]
            if abs(c.x) > .09 * H and .68 * H < c.z < .87 * H:   # sleeves follow the arm only
                pool = [n for n in pool if n.split('.')[0] in ('Shoulder', 'UpperArm', 'LowerArm', 'Hand')]
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
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG' if adaptive else 'AUTO', export_yup=True, export_skins=True)
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
