"""Game-ready version of a licensed anime character that lives only on the owner's machine (examples/crimson-mist/private/models, converted from PMX by
tools/pmx_to_glb.py in Crimson Mist). It keeps the rig the game animates (hips, spine, chest, neck, head, arms, hands, legs, feet, toes), merges the finger and the
physics ("sway_*") bones into their parents, decimates the mesh and shrinks the textures. The result goes to private/cast/<id>.glb: never committed (see .gitignore),
used by Avatar when it exists and replaced by the generated stand-in hero otherwise.
    blender -b -P tools/prep_private.py -- in.glb out.glb [--tris 9000] [--height 1.62] [--tex 1024]"""
import math, sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
tris = int(argv[argv.index('--tris') + 1]) if '--tris' in argv else 9000
height = float(argv[argv.index('--height') + 1]) if '--height' in argv else 0.0
tex = int(argv[argv.index('--tex') + 1]) if '--tex' in argv else 1024

KEEP = {'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Hand.L', 'Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Hand.R',
        'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'Toes.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R', 'Toes.R', 'Root', 'Pelvis'}

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

bones = rig.data.bones
parent_of = {b.name: (b.parent.name if b.parent else None) for b in bones}


def kept_ancestor(name):
    p = parent_of.get(name)
    while p is not None and p not in KEEP:
        p = parent_of.get(p)
    return p


# 1. merge the weights of every dropped bone into its nearest kept ancestor
drop = [b.name for b in bones if b.name not in KEEP]
target = {n: kept_ancestor(n) for n in drop}
vg = body.vertex_groups
for n in drop:
    t = target[n]
    if n not in vg or t is None or t not in vg:
        continue
    src_g, dst_g = vg[n], vg[t]
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == src_g.index:
                dst_g.add([v.index], g.weight, 'ADD')
                break
for n in drop:
    if n in vg:
        vg.remove(vg[n])
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for n in drop:
    eb = rig.data.edit_bones.get(n)
    if eb is not None:
        rig.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode='OBJECT')

# 2. at most 4 influences, normalised
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)

# 3. decimate
n_tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
if n_tris > tris:
    md = body.modifiers.new('dec', 'DECIMATE')
    md.ratio = tris / n_tris
    bpy.ops.object.modifier_apply(modifier='dec')
for p in body.data.polygons:
    p.use_smooth = True

# 4. textures
for img in bpy.data.images:
    if img.size[0] > tex or img.size[1] > tex:
        k = tex / max(img.size)
        img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='AUTO', export_yup=True, export_skins=True)
print('PRIV', dst, len(rig.data.bones), 'bones', sum(len(p.vertices) - 2 for p in body.data.polygons), 'tris')
