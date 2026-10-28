"""Front / side / back renders of a model (any GLB), to look at a generated asset before it goes in the game.
    blender -b -P tools/render_views.py -- in.glb out.png [size]"""
import sys, math, bpy, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
size = int(argv[2]) if len(argv) > 2 else 420
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ms = [o for o in bpy.data.objects if o.type == 'MESH']
pts = [o.matrix_world @ mathutils.Vector(c) for o in ms for c in o.bound_box]
lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
c, sz = (lo + hi) / 2, max(hi - lo)
print('VIEWS bbox', [round(x, 2) for x in (hi - lo)], 'tris', sum(len(o.data.polygons) for o in ms))
scn = bpy.context.scene
scn.render.engine = 'BLENDER_WORKBENCH'
scn.display.shading.color_type = 'TEXTURE'
scn.display.shading.light = 'STUDIO'
scn.render.resolution_x, scn.render.resolution_y = size, size
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scn.collection.objects.link(cam)
scn.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = sz * 1.08
for k, (d, rz) in enumerate(((mathutils.Vector((0, -1, 0)), 0.0), (mathutils.Vector((1, 0, 0)), math.pi / 2), (mathutils.Vector((0, 1, 0)), math.pi))):
    cam.location = c + d * sz * 3
    cam.rotation_euler = (math.pi / 2, 0, rz)
    scn.render.filepath = out.replace('.png', '_%d.png' % k)
    bpy.ops.render.render(write_still=True)
