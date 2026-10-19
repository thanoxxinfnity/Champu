"""Graft a head onto a generated body with a short, natural neck.

    blender -b -P tools/graft_head2.py -- body.glb head.glb out_base shoulder_below_top neck_narrow_below_top squash chin_len neck_len

Body numbers are metres below the top of the body's own hair. The body's neck column (above the shoulder line) is squashed vertically by
`squash`, the body is cut at the squashed neck, and the head is scaled so hair-top-to-chin is `chin_len`, then seated `neck_len` above the
shoulder line (0 = chin sits right on the collar, as with Sukuna's turtleneck). The head keeps a short neck stub that overlaps the body cut."""
import bpy, bmesh, sys, os, math
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
# widen the head's own neck below the chin so it fills the collar opening; blends in over 3 cm
WIDEN = float(a[10]) if len(a) > 10 else 0.0
if WIDEN > 0:
    for v in head.data.vertices:
        d = chin_z - v.co.z
        if d > 0:
            t = min(1.0, d / 0.03)
            t = t * t * (3 - 2 * t)
            v.co.x = bcx + (v.co.x - bcx) * (1 + WIDEN * t)
            v.co.y = bcy + (v.co.y - bcy) * (1 + WIDEN * 0.8 * t)
# keep the head down to a little below the chin so its own neck stub overlaps the body's neck
bm = bmesh.new()
bm.from_mesh(head.data)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=Vector((0, 0, chin_z - STUB)), plane_no=Vector((0, 0, 1)),
                       clear_inner=True, clear_outer=False)
bm.to_mesh(head.data)
bm.free()
# the bust flares into shoulders right under the chin; keep only a neck-wide column there so no thin skirt shows around the collar
NECK_HALF = float(a[9]) if len(a) > 9 else 0.0
if NECK_HALF > 0:
    bm = bmesh.new()
    bm.from_mesh(head.data)
    bm.faces.ensure_lookup_table()
    kill = [f for f in bm.faces if f.calc_center_median().z < chin_z + 0.015 and abs(f.calc_center_median().x - bcx) > NECK_HALF]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(head.data)
    bm.free()
# optional neck tube: replaces the body's ragged neck. Skin colour is sampled from the head's own neck texels so the two match.
TUBE = float(a[12]) if len(a) > 12 else 0.0
if TUBE > 0:
    img = None
    for mt in head.data.materials:
        for nd in mt.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image:
                img = nd.image
    cols = []
    uvl = head.data.uv_layers.active.data
    if img is not None:
        W_, H_ = img.size
        px = img.pixels[:]
        for poly in head.data.polygons:
            c = poly.center
            if abs(c.z - (chin_z - 0.02)) < 0.02 and abs(c.x - bcx) < 0.03:
                uv = sum((uvl[li].uv for li in poly.loop_indices), Vector((0, 0))) / len(poly.loop_indices)
                i = (min(H_ - 1, max(0, int(uv.y * H_))) * W_ + min(W_ - 1, max(0, int(uv.x * W_)))) * 4
                cols.append((px[i], px[i + 1], px[i + 2]))
    skin = tuple(float(x) for x in os.environ.get('SKIN', '0.708,0.474,0.392').split(','))   # linear RGB of the head's neck skin
    print('SKIN', [round(x, 3) for x in skin], len(cols))
    ztop = chin_z - 0.035
    zbot = zc - 0.012
    rt = TUBE * 0.62
    rb = TUBE * 1.45
    bm = bmesh.new()
    segs, rings = 28, 6
    for r in range(rings + 1):
        t = r / rings
        z = ztop + (zbot - ztop) * t
        rad = rt + (rb - rt) * (t ** 2.2)
        ring = [bm.verts.new((bcx + rad * math.cos(2 * math.pi * k_ / segs), bcy + rad * 1.0 * math.sin(2 * math.pi * k_ / segs), z)) for k_ in range(segs)]
        if r:
            for k_ in range(segs):
                try:
                    bm.faces.new((prev[k_], prev[(k_ + 1) % segs], ring[(k_ + 1) % segs], ring[k_]))
                except ValueError:
                    pass
        prev = ring
    me = bpy.data.meshes.new('neck')
    bm.to_mesh(me)
    bm.free()
    tube = bpy.data.objects.new('neck', me)
    bpy.context.scene.collection.objects.link(tube)
    tm = bpy.data.materials.new('neck_skin')
    tm.use_nodes = True
    tb = tm.node_tree.nodes['Principled BSDF']
    tb.inputs['Base Color'].default_value = (*skin, 1)
    tb.inputs['Roughness'].default_value = 0.8
    me.materials.append(tm)
    for pp in me.polygons:
        pp.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    tube.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
# optional rib collar (crew neck): a flattened torus in shirt black round the neck at the shoulder line, merged into the body mesh so it is skinned with it
COLLAR = float(a[11]) if len(a) > 11 else 0.0
if COLLAR > 0:
    bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.2, major_segments=40, minor_segments=10)
    col = bpy.context.object
    col.location = (bcx, bcy, zc + 0.004)
    col.scale = (COLLAR, COLLAR * 1.15, COLLAR * 0.9)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    cm = bpy.data.materials.new('collar')
    cm.use_nodes = True
    cb = cm.node_tree.nodes['Principled BSDF']
    cb.inputs['Base Color'].default_value = (0.012, 0.012, 0.014, 1)
    cb.inputs['Roughness'].default_value = 0.9
    col.data.materials.append(cm)
    for pp in col.data.polygons:
        pp.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    col.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
for o in (body, head):
    for p in o.data.polygons:
        p.use_smooth = True
out = os.path.join(os.path.dirname(os.path.abspath(body_path)), base)
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', export_image_format='JPEG', export_yup=True)
print('GRAFT2', base, 'scale', round(s, 4), 'zc', round(zc - T, 3))
