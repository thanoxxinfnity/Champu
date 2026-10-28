"""Mend a generated (Triverse / TRELLIS) hero: its mesh comes as a "triangle soup" — every patch has its own copy of the shared
vertices and some triangles face inwards. In game that showed as cracks and holes, and the ink outline (an inverted hull pushed
out along the normals) broke into dark shards around the body, because a split vertex has a different normal on each side.
Here every mesh is welded (vertices closer than a hair merge, weights kept), its faces turned to point outwards, and shaded
smooth, so normals agree across the old seams. The rig, weights, UVs and textures stay as they were.
    blender -b -P tools/weld_normals.py -- in.glb out.glb [--dist 0.0008]   (dist in units of the model's height)"""
import sys
import bpy
import bmesh

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
rel = float(argv[argv.index('--dist') + 1]) if '--dist' in argv else 0.0008

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
zs = [(o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices]
height = (max(zs) - min(zs)) if zs else 1.0
dist = max(1e-6, rel * height)
before = after = 0
for o in meshes:
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    before += len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist / max(o.matrix_world.to_scale()))
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    after += len(bm.verts)
    bm.to_mesh(me)
    bm.free()
    me.update()
print('WELD %s: %d -> %d verts (dist %.5f)' % (src.split('/')[-1], before, after, dist))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True, export_animations=False,
                          export_image_format='JPEG', export_jpeg_quality=88, export_normals=True)
