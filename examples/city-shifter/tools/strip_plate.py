"""Delete the display stand / ground disc a generator put under a figure: split the mesh into islands and drop every flat, wide island that sits at the bottom.
If the figure is welded to its stand (one island) the bottom slice that is wider than the feet is cut off instead.
    blender -b -P tools/strip_plate.py -- in.glb out.glb"""
import sys
import bpy
import bmesh
from mathutils import Vector

src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ms = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in ms:
    o.select_set(True)
bpy.context.view_layer.objects.active = ms[0]
if len(ms) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')
parts = [o for o in bpy.data.objects if o.type == 'MESH']


def box(o):
    vs = [v.co for v in o.data.vertices]
    return Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))), Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))


boxes = {o: box(o) for o in parts}
zmin = min(b[0].z for b in boxes.values())
zmax = max(b[1].z for b in boxes.values())
H = zmax - zmin
big = max(parts, key=lambda o: boxes[o][1].z - boxes[o][0].z)
gone = 0
for o, (a, b) in boxes.items():
    if o is big:
        continue
    if (b.z - a.z) < 0.2 * H and (a.z - zmin) < 0.1 * H:
        bpy.data.objects.remove(o, do_unlink=True)
        gone += 1
print('STRIP islands', len(parts), 'removed', gone)
bpy.ops.object.select_all(action='DESELECT')
rest = [o for o in bpy.data.objects if o.type == 'MESH']
for o in rest:
    o.select_set(True)
bpy.context.view_layer.objects.active = rest[0]
if len(rest) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
# welded stand: faces in the lowest 7 % whose centre lies farther from the body axis than the feet are (the feet are within 14 % of H of the axis)
bm = bmesh.new()
bm.from_mesh(ob.data)
cx = sum(v.co.x for v in bm.verts) / len(bm.verts)
low = [f for f in bm.faces if f.calc_center_median().z < zmin + 0.04 * H]
wide = [f for f in low if abs(f.calc_center_median().x - cx) > 0.2 * H]
print('STRIP welded faces', len(wide))
if wide:
    bmesh.ops.delete(bm, geom=wide, context='FACES')
    bm.to_mesh(ob.data)
bm.free()
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True, export_image_format='JPEG')
