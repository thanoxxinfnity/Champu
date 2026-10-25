"""Poly Haven glTF -> game GLB: one mesh, triangle budget, base-colour (+alpha) texture only at <=1024 px.
    blender -b -P tools/prep_ph.py -- raw/ph/models/Barrel_01/Barrel_01.gltf assets/ph/barrel.glb [max_tris]"""
import os, sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
budget = int(argv[2]) if len(argv) > 2 else 3000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
lod0 = [o for o in meshes if 'LOD0' in o.name]
if lod0:      # scanned trees ship several LOD0 variants of millions of faces: keep the lightest one
    keep_obj = min(lod0, key=lambda o: len(o.data.polygons))
    for o in meshes:
        if o is not keep_obj:
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [keep_obj]
for o in bpy.context.scene.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
def count():
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


tris = count()
for _ in range(6):        # collapse decimation stops early on huge meshes: repeat until the budget is met
    if tris <= budget * 1.15:
        break
    d = obj.modifiers.new('dec', 'DECIMATE')
    d.ratio = max(0.001, min(0.5, budget / tris))
    bpy.ops.object.modifier_apply(modifier='dec')
    tris = count()

# keep only Base Color and Alpha texture links
for m in obj.data.materials:
    if not m or not m.use_nodes:
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        continue
    keep = set()
    for name in ('Base Color', 'Alpha'):
        for l in bsdf.inputs[name].links:
            keep.add(l.from_node)
            for l2 in l.from_node.inputs[0].links if l.from_node.inputs else []:
                keep.add(l2.from_node)
    for name in ('Normal', 'Roughness', 'Metallic', 'Emission Color'):
        for l in list(bsdf.inputs[name].links):
            nt.links.remove(l)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.85
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE' and n not in keep:
            nt.nodes.remove(n)
for img in bpy.data.images:
    if img.size[0] > 1024 or img.size[1] > 1024:
        k = 1024 / max(img.size)
        img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
os.makedirs(os.path.dirname(dst), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_yup=True, export_apply=True)
print('SAVED', dst, os.path.getsize(dst) // 1024, 'KB', 'tris', tris)
