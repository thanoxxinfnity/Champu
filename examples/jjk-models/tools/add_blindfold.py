"""Gojo blindfold variant:  blender -b models/gojo_rigged.blend -P tools/add_blindfold.py -- gojo_blindfold_tv
A black cloth band around the head at eye height (bound to the head bone). The open-eyes Gojo is the plain model."""
import bpy, bmesh, sys, os, math
from mathutils import Vector

base = sys.argv[sys.argv.index('--') + 1]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
heads = [o for o in bpy.data.objects if o.type == 'MESH' and ('_head_' in o.name or '_hair_' in o.name)]
pts = [o.matrix_world @ v.co for o in bpy.data.objects if o.type == 'MESH' for v in o.data.vertices]
top = max(p.z for p in pts)
H = top - min(p.z for p in pts)
hp = [o.matrix_world @ v.co for o in heads for v in o.data.vertices]
cx = sum(p.x for p in hp) / len(hp)
cy = sum(p.y for p in hp) / len(hp)
zeye = top - 0.063 * H - 0.056
width = max(p.x for p in hp if abs(p.z - zeye) < 0.03) - min(p.x for p in hp if abs(p.z - zeye) < 0.03)
depth = max(p.y for p in hp if abs(p.z - zeye) < 0.03) - min(p.y for p in hp if abs(p.z - zeye) < 0.03)
print('EYE', round(zeye, 3), 'w', round(width, 3), 'd', round(depth, 3))
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=40, radius1=1.0, radius2=1.0, depth=1.0)
me = bpy.data.meshes.new('blindfold')
bm.to_mesh(me)
bm.free()
o = bpy.data.objects.new('gojo_blindfold', me)
bpy.context.scene.collection.objects.link(o)
o.location = (cx, cy - 0.03, zeye + 0.004)
o.scale = (0.108, 0.150, 0.062)  # face is ~0.185 wide; the band hugs it
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
sol = o.modifiers.new('s', 'SOLIDIFY')
sol.thickness = 0.006
bpy.ops.object.modifier_apply(modifier='s')
m = bpy.data.materials.new('blindfold_cloth')
m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.01, 0.01, 0.012, 1)
m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
me.materials.append(m)
for p in me.polygons:
    p.use_smooth = True
vg = o.vertex_groups.new(name='head')
vg.add([v.index for v in me.vertices], 1.0, 'REPLACE')
mod = o.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
o.parent = arm
out = os.path.join(os.path.dirname(bpy.data.filepath), base)
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', export_skins=True, export_image_format='JPEG', export_yup=True)
print('BLINDFOLD', base)
