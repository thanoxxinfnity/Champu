"""Put the reference drawing's own face on the model.

    blender -b models/gojo_rigged.blend -P tools/face_decal.py -- reference/gojo.png gojo_head

Image-to-3D bakes the face into a soft, often wrong texture. This copies the front-facing triangles of the head part into a separate
`<name>_face` mesh (same skin weights, nudged outward) and projects the reference image onto it from the front, so eyes, brows, markings
and mouth are exactly the drawn ones. The silhouette of the figure in the image is matched to the model's bounding box, so no manual
alignment is needed. Saves the .blend and re-exports the .glb next to it."""
import bpy, bmesh, sys, os
from mathutils import Vector

ref, head_prefix = sys.argv[sys.argv.index('--') + 1:][:2]
img = bpy.data.images.load(os.path.abspath(ref))
W, H = img.size
px = list(img.pixels)


def at(x, y):
    i = (y * W + x) * 4
    return px[i:i + 3]


bg = at(2, H - 3)
x0, x1, y0, y1 = W, 0, H, 0
for y in range(0, H, 2):
    for x in range(0, W, 2):
        c = at(x, y)
        if abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) > 0.12:
            x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
# image rows: y counts from the bottom in Blender, so y0 is the feet and y1 the top of the hair

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
mn = Vector((1e9,) * 3)
mx = Vector((-1e9,) * 3)
for o in meshes:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        mn = Vector(map(min, mn, w))
        mx = Vector(map(max, mx, w))


def uv_of(p):
    u = (p.x - mn.x) / (mx.x - mn.x) * (x1 - x0) + x0
    v = (p.z - mn.z) / (mx.z - mn.z) * (y1 - y0) + y0
    return u / W, v / H


head = [o for o in meshes if o.name.startswith(head_prefix)][0]
face = head.copy()
face.data = head.data.copy()
face.name = head.name + '_face'
bpy.context.scene.collection.objects.link(face)
bm = bmesh.new()
bm.from_mesh(face.data)
bm.faces.ensure_lookup_table()
mw = face.matrix_world
drop = [f for f in bm.faces if (mw.to_3x3() @ f.normal).y > -0.25]
bmesh.ops.delete(bm, geom=drop, context='FACES')
for v in bm.verts:
    v.co += v.normal * 0.0025
uvl = bm.loops.layers.uv.verify()
for f in bm.faces:
    for l in f.loops:
        l[uvl].uv = uv_of(mw @ l.vert.co)
bm.to_mesh(face.data)
bm.free()
face.data.materials.clear()
m = bpy.data.materials.new('face_art')
m.use_nodes = True
b = m.node_tree.nodes['Principled BSDF']
t = m.node_tree.nodes.new('ShaderNodeTexImage')
t.image = img
t.interpolation = 'Linear'
t.extension = 'EXTEND'
m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
b.inputs['Roughness'].default_value = 1.0
b.inputs['Metallic'].default_value = 0.0
face.data.materials.append(m)

blend = bpy.data.filepath
bpy.ops.wm.save_mainfile()
bpy.ops.export_scene.gltf(filepath=blend.replace('.blend', '.glb'), export_format='GLB', export_skins=True, export_yup=True)
print('FACE', face.name, len(face.data.polygons), 'bbox', (x0, x1, y0, y1))
