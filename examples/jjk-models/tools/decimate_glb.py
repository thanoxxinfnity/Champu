"""Shrink a heavy GLB for phones:  blender -b -P tools/decimate_glb.py -- in.glb out.glb target_tris [max_tex]

Every mesh is collapse-decimated in proportion to its share of the triangles (keeping UVs and materials), normals are smoothed, and the
textures are downscaled to max_tex (default 1024) before export, so the file stays small enough to ship in an APK."""
import bpy, sys

a = sys.argv[sys.argv.index('--') + 1:]
src, dst, target = a[0], a[1], int(a[2])
max_tex = int(a[3]) if len(a) > 3 else 1024
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
total = sum(len(o.data.polygons) for o in meshes)
ratio = min(1.0, target / max(1, total))
print('DECIMATE', len(meshes), 'meshes', total, '->', int(total * ratio))
for o in meshes:
    n = len(o.data.polygons)
    if n * ratio >= n:
        continue
    bpy.context.view_layer.objects.active = o
    m = o.modifiers.new('dec', 'DECIMATE')
    m.ratio = max(0.01, min(1.0, ratio))
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    for p in o.data.polygons:
        p.use_smooth = True
for img in bpy.data.images:
    if img.size[0] > max_tex or img.size[1] > max_tex:
        k = max_tex / max(img.size)
        img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85, export_yup=True)
print('DONE', dst, sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH'))
