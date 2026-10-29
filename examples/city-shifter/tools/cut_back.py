"""Cut off what hangs behind a back-pack (shoulder straps, a dangling strap): every face whose centre lies more than `keep` of the depth
behind the front face goes, so the pack sits flat on the hero's back instead of floating a strap's length away from it.
Front = glTF +Z (the thrusters' side, Blender -Y), the straps reach towards glTF -Z (Blender +Y).
    blender -b -P tools/cut_back.py -- in.glb out.glb [keep=0.6]"""
import sys
import bpy
import bmesh

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
keep = float(argv[2]) if len(argv) > 2 else 0.6
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
ys = [(o.matrix_world @ v.co).y for o in meshes for v in o.data.vertices]
cut = min(ys) + (max(ys) - min(ys)) * keep
gone = 0
for o in meshes:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    dead = [f for f in bm.faces if (o.matrix_world @ f.calc_center_median()).y > cut]
    gone += len(dead)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
print('CUT faces', gone, 'behind y', round(cut, 3))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True, export_image_format='JPEG', export_jpeg_quality=90)
