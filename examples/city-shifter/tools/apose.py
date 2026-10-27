"""Take an auto-rigged T-pose hero (assets/cast/<id>.glb, bones from tools/autorig_obj.py) and make it behave better when the game bends its arms:
  1. smooth the skin weights over the mesh neighbours (no more hard seams and flapping sleeves), keep at most 4 influences per vertex;
  2. bake an A-pose: the arms are lowered `--deg` degrees (default 42) and that pose becomes the new rest pose (mesh and armature), so the game only has to bend
     the arms the remaining 45 degrees to hang them, instead of 90: shoulders, sleeves and hands stay clean.
    blender -b -P tools/apose.py -- in.glb out.glb [--deg 42] [--smooth 3]"""
import math, sys
import bpy, bmesh
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
deg = float(argv[argv.index('--deg') + 1]) if '--deg' in argv else 42.0
iters = int(argv[argv.index('--smooth') + 1]) if '--smooth' in argv else 3

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
mod = next((m for m in body.modifiers if m.type == 'ARMATURE'), None)
assert mod is not None, 'no armature modifier'

# 0. optional: Blender's own bone-heat weights instead of the distance weights of the auto-rig
if '--auto' in argv:
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    for g in list(body.vertex_groups):
        body.vertex_groups.remove(g)
    for m in list(body.modifiers):
        if m.type == 'ARMATURE':
            body.modifiers.remove(m)
    body.parent = None
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        print('AUTO WEIGHTS ok', len(body.vertex_groups))
    except Exception as e:
        print('AUTO WEIGHTS failed', e)
    mod = next((m for m in body.modifiers if m.type == 'ARMATURE'), None)
    assert mod is not None, 'no armature modifier after auto weights'

# 1. smooth the weights
names = [g.name for g in body.vertex_groups]
idx = {n: i for i, n in enumerate(names)}
me = body.data
n = len(me.vertices)
W = [dict() for _ in range(n)]
for v in me.vertices:
    for g in v.groups:
        W[v.index][g.group] = g.weight
bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
nb = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
bm.free()
for _ in range(iters):
    new = []
    for i in range(n):
        acc = {}
        for gi, w in W[i].items():
            acc[gi] = acc.get(gi, 0.0) + w * 0.5
        if nb[i]:
            share = 0.5 / len(nb[i])
            for j in nb[i]:
                for gi, w in W[j].items():
                    acc[gi] = acc.get(gi, 0.0) + w * share
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(w for _, w in top) or 1.0
        new.append({gi: w / tot for gi, w in top})
    W = new
for g in body.vertex_groups:
    g.remove(list(range(n)))
for i in range(n):
    for gi, w in W[i].items():
        if w > 0.01:
            body.vertex_groups[gi].add([i], w, 'REPLACE')

# 2. the A-pose
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
for sd, sg in (('L', 1.0), ('R', -1.0)):
    pb = rig.pose.bones.get(f'UpperArm.{sd}')
    if pb is None:
        continue
    head = pb.bone.head_local
    tail = pb.bone.tail_local
    cur = (tail - head).normalized()
    side = 1.0 if cur.x >= 0 else -1.0                      # which way this arm points in the armature
    tgt = Vector((side * math.cos(math.radians(deg)) * 1.0, 0.0, -math.sin(math.radians(deg)))).normalized()
    delta = cur.rotation_difference(tgt)
    R = pb.bone.matrix_local.to_3x3()
    loc = R.inverted() @ delta.to_matrix() @ R
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = loc.to_quaternion()
bpy.ops.object.mode_set(mode='OBJECT')
# bake the posed mesh, make the pose the rest pose
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply()
bpy.ops.object.mode_set(mode='OBJECT')
m2 = body.modifiers.new('Armature', 'ARMATURE')
m2.object = rig
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_yup=True, export_skins=True)
print('APOSE', dst)
