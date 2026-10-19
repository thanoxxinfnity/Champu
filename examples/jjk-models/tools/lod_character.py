"""Reduce a rigged, dressed character to a triangle budget (keeps skin weights, sway bones and materials).

    blender -b models/gojo_final.blend -P tools/lod_character.py -- 12000 gojo_12k [max_tex]

The budget is shared out by importance: the head keeps the biggest share (the face is what you look at), then the body, then the clothes.
Textures are scaled to max_tex (default 1024; the head keeps up to 2x that). Output: models/<name>.glb."""
import bpy, sys, os

a = sys.argv[sys.argv.index('--') + 1:]
budget = int(a[0])
name = a[1]
max_tex = int(a[2]) if len(a) > 2 else 1024
SHARE = {'head': 0.28, 'body': 0.22, 'tee': 0.16, 'gi': 0.16, 'undershirt': 0.06, 'hakama': 0.22, 'obi': 0.07, 'tabi': 0.05, 'geta': 0.03}
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
w = {}
for o in meshes:
    key = next((k for k in SHARE if o.name.rstrip('LR') == k or o.name.startswith(k)), None)
    w[o.name] = SHARE.get(key, 0.04)
tot = sum(w.values())
before = 0
after = 0
for o in meshes:
    n = len(o.data.polygons) * 2 if False else sum(len(p.vertices) - 2 for p in o.data.polygons)
    before += n
    target = max(300, int(budget * w[o.name] / tot))
    if n > target:
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            if m.type == 'ARMATURE':
                m.show_viewport = False        # decimate the rest shape, then switch the armature back on
        d = o.modifiers.new('lod', 'DECIMATE')
        d.ratio = target / n
        d.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='lod')
        for m in o.modifiers:
            if m.type == 'ARMATURE':
                m.show_viewport = True
    after += sum(len(p.vertices) - 2 for p in o.data.polygons)
    for p in o.data.polygons:
        p.use_smooth = True
for img in bpy.data.images:
    lim = max_tex * 2 if 'head' in img.name.lower() else max_tex
    if max(img.size) > lim:
        k = lim / max(img.size)
        img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
out = os.path.join(os.path.dirname(bpy.data.filepath), name + '.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_skins=True, export_image_format='JPEG', export_jpeg_quality=88, export_yup=True)
print('LOD', name, 'tris', before, '->', after, 'file', round(os.path.getsize(out) / 1e6, 1), 'MB')
