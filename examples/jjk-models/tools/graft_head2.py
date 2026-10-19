"""Graft a head onto a generated body with a short, natural neck.

    blender -b -P tools/graft_head2.py -- body.glb head.glb out_base shoulder_below_top neck_narrow_below_top squash chin_len neck_len

Body numbers are metres below the top of the body's own hair. The body's neck column (above the shoulder line) is squashed vertically by
`squash`, the body is cut at the squashed neck, and the head is scaled so hair-top-to-chin is `chin_len`, then seated `neck_len` above the
shoulder line (0 = chin sits right on the collar, as with Sukuna's turtleneck). The head keeps a short neck stub that overlaps the body cut."""
import bpy, bmesh, sys, os
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index('--') + 1:]
body_path, head_path, base = a[0], a[1], a[2]
sh, nk, k, chin_len, neck_len = (float(x) for x in a[3:8])
STUB = float(a[8]) if len(a) > 8 else 0.045
bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    ms = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in ms:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world.identity()
    for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    ms[0].name = name
    return ms[0]


def zt(o): return max(v.co.z for v in o.data.vertices)
def zb(o): return min(v.co.z for v in o.data.vertices)


body = load(body_path, 'body')
head = load(head_path, 'head')
T = zt(body)
zs = T - sh
# squash everything above the shoulder line toward it (the neck column); the old head is deleted afterwards anyway
for v in body.data.vertices:
    if v.co.z > zs:
        v.co.z = zs + (v.co.z - zs) * k
zc = zs + (sh - nk) * k + 0.004        # cut at the (squashed) narrowest part of the neck
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=Vector((0, 0, zc)), plane_no=Vector((0, 0, 1)),
                       clear_inner=False, clear_outer=True)
bm.to_mesh(body.data)
bm.free()
# head: scale so hair tip -> chin (82% of the bust height) is chin_len, then seat the chin neck_len above the shoulder line
hh = zt(head) - zb(head)
s = chin_len / (0.82 * hh)
head.data.transform(Matrix.Diagonal((s, s, s, 1.0)))
bx = [v.co for v in body.data.vertices if v.co.z > zs - 0.05]
bcx = (max(v.x for v in bx) + min(v.x for v in bx)) / 2
bcy = (max(v.y for v in bx) + min(v.y for v in bx)) / 2
hx = [v.co for v in head.data.vertices]
hcx = (max(v.x for v in hx) + min(v.x for v in hx)) / 2
hcy = (max(v.y for v in hx) + min(v.y for v in hx)) / 2
chin_z = zs + neck_len
head.data.transform(Matrix.Translation(Vector((bcx - hcx, bcy - hcy, (chin_z + chin_len) - zt(head)))))
# keep the head down to a little below the chin so its own neck stub overlaps the body's neck
bm = bmesh.new()
bm.from_mesh(head.data)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=Vector((0, 0, chin_z - STUB)), plane_no=Vector((0, 0, 1)),
                       clear_inner=True, clear_outer=False)
bm.to_mesh(head.data)
bm.free()
for o in (body, head):
    for p in o.data.polygons:
        p.use_smooth = True
out = os.path.join(os.path.dirname(os.path.abspath(body_path)), base)
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', export_image_format='JPEG', export_yup=True)
print('GRAFT2', base, 'scale', round(s, 4), 'zc', round(zc - T, 3))
