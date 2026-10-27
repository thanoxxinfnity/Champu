"""Downloaded Sketchfab model -> phone-sized, upright, correctly pointed glb.
    blender -b -P tools/prep_sf.py -- in.glb out.glb kind tris tex_px [rx,ry,rz]
kind: keep (a generated, upright model: only an optional turn about the vertical, origin at the bottom centre), gun (barrel along glTF -Z, the heavy end behind, origin at the centre), vehicle / city / prop (longest side along glTF Z, upright, origin at the
bottom centre). An optional x,y,z rotation in degrees (in the glTF's own space, applied first) fixes a model that arrives lying down or backwards.
Joins the meshes, decimates to `tris`, keeps only the base-colour texture shrunk to `tex_px`."""
import math, os, sys
import bpy
from mathutils import Matrix, Vector

src, dst, kind, tris, tex_px = sys.argv[sys.argv.index('--') + 1:][:5]
extra = sys.argv[sys.argv.index('--') + 6] if len(sys.argv) > sys.argv.index('--') + 6 else ''
tris, tex_px = int(tris), int(tex_px)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
# drop everything that is not geometry (armatures, empties, cameras, lights): the pose it was exported in is baked into the meshes by the join below
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH':
        o.select_set(False)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
    for m in list(o.modifiers):
        if m.type == 'ARMATURE':
            try:
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier=m.name)
            except Exception:
                o.modifiers.remove(m)
bpy.context.view_layer.objects.active = meshes[0]
bpy.context.view_layer.update()
for o in meshes:                                  # unparent but keep where the parents (empties with their own turn and scale) put the mesh
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# remove the leftover non-mesh objects now
for o in list(bpy.context.scene.objects):
    if o != ob:
        bpy.data.objects.remove(o, do_unlink=True)


def rot(rx, ry, rz):
    """Turn the mesh itself (X, then Y, then Z, degrees) — done on the vertices, not through an operator."""
    m = Matrix.Rotation(math.radians(rz), 4, 'Z') @ Matrix.Rotation(math.radians(ry), 4, 'Y') @ Matrix.Rotation(math.radians(rx), 4, 'X')
    ob.data.transform(m)
    ob.data.update()


def dims():
    vs = [v.co for v in ob.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return mn, mx


def drop_plates():
    """Generated models often stand on a ground plate (a slab, a grass disc) that is a separate island: split into islands and delete the flat wide low ones."""
    global ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if len(parts) < 2:
        return
    def box(o):
        vs = [v.co for v in o.data.vertices]
        return (Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))), Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs))))
    boxes = {o: box(o) for o in parts}
    zmin = min(b[0].z for b in boxes.values())
    zmax = max(b[1].z for b in boxes.values())
    H = max(zmax - zmin, 1e-6)
    wide = max(max(b[1].x - b[0].x, b[1].y - b[0].y) for b in boxes.values())
    kept = []
    for o, (a, b) in boxes.items():
        flat = (b.z - a.z) < 0.16 * H
        low = (a.z - zmin) < 0.08 * H
        broad = max(b.x - a.x, b.y - a.y) > 0.35 * wide
        if flat and low and broad:
            bpy.data.objects.remove(o, do_unlink=True)
        else:
            kept.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in kept:
        o.select_set(True)
    bpy.context.view_layer.objects.active = kept[0]
    if len(kept) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    print('PLATES', len(parts) - len(kept))


if kind == 'keep':
    # generated models (Triverse / TRELLIS): upright already; `extra` is a turn about the vertical in degrees (180 when the front arrives at +Z)
    drop_plates()
    if extra:
        rot(0, 0, float(extra))
elif extra:
    gx, gy, gz = [float(t) for t in extra.split(',')]       # glTF space -> Blender space: (x, y, z) = (gx, -gz, gy)
    rot(gx, -gz, gy) if False else None
    # apply as three separate turns about Blender's own axes: glTF X = Blender X, glTF Y(up) = Blender Z, glTF Z = Blender -Y
    rot(gx, 0, 0)
    rot(0, 0, gy)
    rot(0, -gz, 0)
mn, mx = dims()
size = mx - mn
# the longest side goes along Blender +Y (= glTF -Z, the way the game's things face)
axes = sorted(range(3), key=lambda a: -size[a])
if kind == 'keep':
    longest = 1
elif kind == 'gun':
    longest = axes[0]
else:
    longest = 0 if size[0] >= size[1] and size[0] >= size[2] * 0.0 and size[0] > size[1] else 1
    if size[2] > max(size[0], size[1]) * 1.3:
        longest = 2       # a tall thing (tower) keeps its height, the long horizontal side is found below
    if longest == 2:
        longest = 0 if size[0] >= size[1] else 1
if kind == 'keep':
    pass
elif longest == 0:
    rot(0, 0, 90)
elif longest == 2 and kind == 'gun':
    rot(-90, 0, 0)
mn, mx = dims()
if kind == 'gun':
    # the heavy end (centroid) is the butt: it must be at -Y so the muzzle points to +Y
    c = sum((v.co for v in ob.data.vertices), Vector()) / len(ob.data.vertices)
    if c.y > (mn.y + mx.y) * 0.5:
        rot(0, 0, 180)
    mn, mx = dims()
    off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))
else:
    off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
ob.data.transform(Matrix.Translation(-off))
ob.data.update()
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
    if bsdf and bsdf.inputs['Emission Color'].is_linked:
        # its glow came from a texture we are dropping: without it the flat factor would paint the whole model white
        bsdf.inputs['Emission Color'].default_value = (0, 0, 0, 1)
        for l in list(nt.links):
            if l.to_socket == bsdf.inputs['Emission Color']:
                nt.links.remove(l)
    for x in list(nt.nodes):
        if x.type == 'TEX_IMAGE':
            linked = any(l.from_node == x and l.to_socket.name in ('Base Color',) for l in nt.links)
            if not linked:
                nt.nodes.remove(x)
            elif x.image and max(x.image.size) > tex_px:
                k = tex_px / max(x.image.size)
                x.image.scale(max(1, int(x.image.size[0] * k)), max(1, int(x.image.size[1] * k)))
    for x in list(nt.nodes):
        if x.type in ('SEPARATE_COLOR', 'SEPARATE_RGB', 'MATH'):
            nt.nodes.remove(x)
    if bsdf:
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.9
os.makedirs(os.path.dirname(dst), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_yup=True)
mn, mx = dims()
print('PREP', os.path.basename(dst), n, '->', sum(len(p.vertices) - 2 for p in ob.data.polygons), os.path.getsize(dst) // 1024, 'KB', 'size', tuple(round(x, 2) for x in (mx - mn)))
