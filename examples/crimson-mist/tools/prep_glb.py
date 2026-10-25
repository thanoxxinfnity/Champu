"""Raw Triverse GLB -> phone-sized prop/enemy GLB: join meshes, decimate to a triangle budget, keep only the base-colour texture
(the toon shader ignores PBR maps), downsize it, export.
    blender -b -P tools/prep_glb.py -- in.glb out.glb target_tris tex_px"""
import os, sys
import bpy

src, dst, tris, tex_px = sys.argv[sys.argv.index('--') + 1:][:4]
tris, tex_px = int(tris), int(tex_px)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
if n > tris:
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.ratio = tris / n
    bpy.ops.object.modifier_apply(modifier='dec')
for ma in ob.data.materials:
    if not ma or not ma.use_nodes:
        continue
    nt = ma.node_tree
    bsdf = next((x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED'), None)
    for x in list(nt.nodes):
        if x.type == 'TEX_IMAGE':
            linked = any(l.from_node == x and l.to_socket.name in ('Base Color',) for l in nt.links)
            if not linked:
                nt.nodes.remove(x)
            elif x.image and max(x.image.size) > tex_px:
                k = tex_px / max(x.image.size)
                x.image.scale(int(x.image.size[0] * k), int(x.image.size[1] * k))
    for x in list(nt.nodes):
        if x.type in ('SEPARATE_COLOR', 'SEPARATE_RGB', 'MATH'):
            nt.nodes.remove(x)
    if bsdf:
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 1.0
os.makedirs(os.path.dirname(dst), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_yup=True)
print('PREP', os.path.basename(dst), n, '->', sum(len(p.vertices) - 2 for p in ob.data.polygons), os.path.getsize(dst) // 1024, 'KB')
