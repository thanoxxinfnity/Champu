"""Re-bake the colour of a generated hero onto its decimated, rigged mesh.
A generated model has a texture atlas made of thousands of tiny islands, one per patch of the soup. Decimating the mesh to 14k triangles collapses edges
across islands, so triangles end up spanning several charts and sample garbage: blue and red blotches on a brown jacket. The cure is what artists do: give the
low mesh clean UVs (smart project) and BAKE the colour from the original high-poly model onto them.
    blender -b -P tools/rebake.py -- original_high.glb rigged_low.glb out.glb [--size 1024]
The high model is scaled and moved onto the low one by their bounding boxes (the auto-rig scales to the hero's height and puts the feet on the floor)."""
import math
import sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
high_path, low_path, dst = argv[:3]
size = int(argv[argv.index('--size') + 1]) if '--size' in argv else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=high_path)
high_objs = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects:
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in high_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = high_objs[0]
if len(high_objs) > 1:
    bpy.ops.object.join()
high = bpy.context.view_layer.objects.active
high.name = 'high'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=low_path)
new = [o for o in bpy.data.objects if o not in before]
rig = next(o for o in new if o.type == 'ARMATURE')
low = max((o for o in new if o.type == 'MESH'), key=lambda o: len(o.data.polygons))
for o in new:
    if o.type == 'MESH' and o is not low:
        bpy.data.objects.remove(o, do_unlink=True)


def bbox(o):
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


lo0, lo1 = bbox(low)
hi0, hi1 = bbox(high)
k = (lo1.z - lo0.z) / (hi1.z - hi0.z)
for v in high.data.vertices:
    v.co = (v.co - Vector(((hi0.x + hi1.x) * 0.5, (hi0.y + hi1.y) * 0.5, hi0.z))) * k
    v.co += Vector(((lo0.x + lo1.x) * 0.5, (lo0.y + lo1.y) * 0.5, lo0.z))
high.data.update()
print('REBAKE scale', round(k, 3), 'low tris', len(low.data.polygons), 'high tris', len(high.data.polygons))

# clean UVs on the low mesh
bpy.ops.object.select_all(action='DESELECT')
low.select_set(True)
bpy.context.view_layer.objects.active = low
for m in list(low.modifiers):
    if m.type != 'ARMATURE':
        low.modifiers.remove(m)
while low.data.uv_layers:
    low.data.uv_layers.remove(low.data.uv_layers[0])
low.data.uv_layers.new(name='UVMap')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.012)
bpy.ops.object.mode_set(mode='OBJECT')

# the bake target
img = bpy.data.images.new('baked', size, size)
mat = bpy.data.materials.new('hero')
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = img
nt.nodes.active = tex
low.data.materials.clear()
low.data.materials.append(mat)

scn = bpy.context.scene
scn.render.engine = 'CYCLES'
scn.cycles.device = 'CPU'
scn.cycles.samples = 4
b = scn.render.bake
b.use_pass_direct = False
b.use_pass_indirect = False
b.use_pass_color = True
b.use_selected_to_active = True
b.cage_extrusion = 0.06
b.max_ray_distance = 0.2
b.margin = 10
bpy.ops.object.select_all(action='DESELECT')
high.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low
bpy.ops.object.bake(type='DIFFUSE')
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Metallic'].default_value = 0.0
bsdf.inputs['Roughness'].default_value = 0.85
bpy.data.objects.remove(high, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
low.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True, export_skins=True, export_animations=False,
                          export_image_format='JPEG', export_jpeg_quality=90)
print('REBAKED', dst)
