"""Front and side x-ray render of a rigged GLB with its bones drawn as red sticks: check where autorig put the arms before skinning.
    blender -b -P tools/render_bones.py -- rigged.glb out.png [size]"""
import sys, math, bpy, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
size = int(argv[2]) if len(argv) > 2 else 420
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
ms = [o for o in bpy.data.objects if o.type == 'MESH']
for o in ms:
    o.color = (0.75, 0.75, 0.75, 1)
for b in rig.data.bones:
    if b.name == 'neutral_bone':
        continue
    a, c = rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local
    d = c - a
    if d.length < 1e-5:
        continue
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=d.length, location=(a + c) / 2)
    cyl = bpy.context.active_object
    cyl.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    cyl.color = (1, 0.1, 0.1, 1) if '.L' in b.name else (0.1, 0.3, 1, 1) if '.R' in b.name else (1, 0.8, 0, 1)
pts = [o.matrix_world @ mathutils.Vector(c) for o in ms for c in o.bound_box]
lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
ctr, sz = (lo + hi) / 2, max(hi - lo)
scn = bpy.context.scene
scn.render.engine = 'BLENDER_WORKBENCH'
scn.display.shading.color_type = 'OBJECT'
scn.display.shading.show_xray = True
scn.display.shading.xray_alpha = 0.35
scn.render.resolution_x, scn.render.resolution_y = size, size
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scn.collection.objects.link(cam)
scn.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = sz * 1.1
for i, ang in enumerate((0, 90)):
    r = math.radians(ang)
    cam.location = ctr + mathutils.Vector((math.sin(r), -math.cos(r), 0)) * sz * 3
    cam.rotation_euler = (math.pi / 2, 0, r)
    scn.render.filepath = out.replace('.png', '_%d.png' % i)
    bpy.ops.render.render(write_still=True)
