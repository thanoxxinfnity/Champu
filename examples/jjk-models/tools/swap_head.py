"""Replace the head (and neck) of a rigged character with a new head mesh.

    blender -b models/sukuna_rigged.blend -P tools/swap_head.py -- raw/sukuna_head_small.glb sukuna_newhead [hair_frac]

The old head/hair parts (objects whose name contains `_head_` or `_hair_`) are removed. The new head is scaled so its overall width matches
the old head+hair, centred on the old head, set so its hair top sits at the old hair top, and bound 100% to the `head` bone."""
import bpy, sys, os
from mathutils import Vector

a = sys.argv[sys.argv.index('--') + 1:]
src, base = a[0], a[1]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
old = [o for o in bpy.data.objects if o.type == 'MESH' and ('_head_' in o.name or '_hair_' in o.name or o.name.endswith('_head') or o.name.endswith('_hair'))]
print('OLD', [o.name for o in old])


def bbox(objs):
    mn = Vector((1e9,) * 3)
    mx = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    return mn, mx


omn, omx = bbox(old)
for o in old:
    bpy.data.objects.remove(o, do_unlink=True)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
for o in new:
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world.identity()
for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)
nmn, nmx = bbox(new)
s = (omx.x - omn.x) / (nmx.x - nmn.x)
for o in new:
    o.data.transform(__import__('mathutils').Matrix.Diagonal((s, s, s, 1.0)))
nmn, nmx = bbox(new)
shift = Vector(((omn.x + omx.x) / 2 - (nmn.x + nmx.x) / 2, (omn.y + omx.y) / 2 - (nmn.y + nmx.y) / 2, omx.z - nmx.z))
for o in new:
    o.data.transform(__import__('mathutils').Matrix.Translation(shift))
    o.name = base.split('_')[0] + '_newhead'
    vg = o.vertex_groups.new(name='head')
    vg.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
    m = o.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    o.parent = arm
    for p in o.data.polygons:
        p.use_smooth = True
out = os.path.join(os.path.dirname(bpy.data.filepath), base)
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', export_skins=True, export_image_format='JPEG', export_yup=True)
print('HEADSWAP', base, 'scale', round(s, 3))
