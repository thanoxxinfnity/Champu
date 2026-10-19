"""Render the rig inside the model:  blender -b models/x_rigged.blend -P tools/bones_shot.py -- out.png
Bones become bright emissive sticks + joint balls (the model is made see-through), so the skeleton shows in a normal render."""
import bpy, sys, math
from mathutils import Vector
out = sys.argv[sys.argv.index('--')+1]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c); mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    for m in o.data.materials:
        if m and m.use_nodes:
            m.surface_render_method = 'BLENDED'
            b = m.node_tree.nodes.get('Principled BSDF')
            if b: b.inputs['Alpha'].default_value = 0.28
ctr = (mn+mx)/2; h = mx.z-mn.z
def mat(name, col):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Emission Color'].default_value = (*col, 1); b.inputs['Emission Strength'].default_value = 3.0
    return m
cols = {'finger': (1.0, 0.85, 0.1), 'main': (0.2, 1.0, 0.45), 'joint': (1.0, 0.2, 0.25)}
mats = {k: mat(k, v) for k, v in cols.items()}
r = h * 0.0035
for b in arm.data.bones:
    a = arm.matrix_world @ b.head_local; t = arm.matrix_world @ b.tail_local
    d = t - a
    if d.length < 1e-5: continue
    kind = 'finger' if any(b.name.startswith(f) for f in ('thumb', 'index', 'middle', 'ring', 'pinky')) else 'main'
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=r * (0.55 if kind == 'finger' else 1.6), radius2=r * 0.2, depth=d.length, location=(a + t) / 2)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.data.materials.append(mats[kind])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=r * (0.8 if kind == 'finger' else 2.1), location=a)
    bpy.context.object.data.materials.append(mats['joint'])
arm.hide_render = True
bpy.ops.object.light_add(type='SUN', location=(2,-4,4)); bpy.context.object.data.energy = 2
w = bpy.data.worlds.new('w'); w.use_nodes = True; bpy.context.scene.world = w
w.node_tree.nodes['Background'].inputs[0].default_value = (.08,.09,.12,1)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = h*1.12
cam.location = (ctr.x, ctr.y-10, ctr.z); cam.rotation_euler = (math.pi/2, 0, 0)
s = bpy.context.scene; s.render.engine = 'BLENDER_EEVEE_NEXT'
s.render.resolution_x = 620; s.render.resolution_y = 900; s.render.filepath = out
bpy.ops.render.render(write_still=True)
