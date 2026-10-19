"""Graft a head onto a body mesh: cut both at the neck and join them.

    blender -b -P tools/graft_head.py -- body.glb head.glb out_base [chin_from_top=0.218] [head_scale_chin_frac=0.82] [body_cut=0.235] [head_cut=0.245]

All numbers are metres below the top of the body's hair. The head mesh (a bust: head + short neck + shoulders, normalised to a 2 m box)
is scaled so its chin lands at `chin_from_top`, moved so its hair top meets the body's hair top, cut below `head_cut`, and the body is cut
above `body_cut`; the two overlap a little so no gap shows. Result: one object per source (body, head) + a merged GLB/blend."""
import bpy, bmesh, sys, os
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index('--') + 1:]
body_path, head_path, base = a[0], a[1], a[2]
chin_from_top = float(a[3]) if len(a) > 3 else 0.218
chin_frac = float(a[4]) if len(a) > 4 else 0.82
body_cut = float(a[5]) if len(a) > 5 else 0.235
head_cut = float(a[6]) if len(a) > 6 else 0.245

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


def ztop(o):
    return max((o.matrix_world @ v.co).z for v in o.data.vertices)


def zbot(o):
    return min((o.matrix_world @ v.co).z for v in o.data.vertices)


def cut(o, z, keep_above):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((0, 0, z)), plane_no=Vector((0, 0, 1)), clear_inner=keep_above is True, clear_outer=keep_above is False)
    # the open edge at the cut is left as is: the other piece overlaps it
    bm.to_mesh(o.data)
    bm.free()


body = load(body_path, 'body')
head = load(head_path, 'head')
top = ztop(body)
# scale the head so chin_frac of its height equals chin_from_top
hh = ztop(head) - zbot(head)
s = chin_from_top / (chin_frac * hh)
head.data.transform(Matrix.Diagonal((s, s, s, 1.0)))
# centre on the body's head (x, y) and put the hair tips on the body's hair top
bx = [v.co for v in body.data.vertices if v.co.z > top - 0.2]
bcx = (max(v.x for v in bx) + min(v.x for v in bx)) / 2
bcy = (max(v.y for v in bx) + min(v.y for v in bx)) / 2
hx = [v.co for v in head.data.vertices]
hcx = (max(v.x for v in hx) + min(v.x for v in hx)) / 2
# depth: align the face front (min y) with the body's face front
hfy = min(v.y for v in hx)
bfy = min(v.y for v in bx)
head.data.transform(Matrix.Translation(Vector((bcx - hcx, bfy - hfy, top - ztop(head)))))
cut(body, top - body_cut, keep_above=False)   # keep the part below the cut
cut(head, top - head_cut, keep_above=True)    # keep the part above the cut
for o in (body, head):
    for p in o.data.polygons:
        p.use_smooth = True
out = os.path.join(os.path.dirname(os.path.abspath(body_path)), base)
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', export_image_format='JPEG', export_yup=True)
print('GRAFT', base, 'scale', round(s, 4))
