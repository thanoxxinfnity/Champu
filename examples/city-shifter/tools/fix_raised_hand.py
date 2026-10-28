"""For a hero modelled with one hand at the face (Kafu holds her hood string by the cheek): the auto-rig gave half the face, the hood and the
side locks to that hand, so when the arm comes down the hair and the cheek stretch after it ("the hair is stuck in the hand").
  * the hand itself (skin-coloured, inside a box round the hand bone) keeps the hand bone and nothing else;
  * the hair and hood strands the fingers touch (not skin, above the cuff, inside that box) are deleted;
  * every other vertex above the neck, or inside the head, loses its arm weights to the head / neck / chest.
    blender -b -P tools/fix_raised_hand.py -- in.glb out.glb [--side L] [--preview out.png]"""
import sys
import math
import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.geometry import intersect_point_line

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
side = argv[argv.index('--side') + 1] if '--side' in argv else 'L'
preview = argv[argv.index('--preview') + 1] if '--preview' in argv else ''
sgn = 1.0 if side == 'L' else -1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and o.find_armature() == rig)
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH' and o != obj:
        bpy.data.objects.remove(o)
mw = rig.matrix_world
B = rig.data.bones


def hd(n):
    return mw @ B[n].head_local


def tl(n):
    return mw @ B[n].tail_local


hand_a, hand_b = hd('Hand.' + side), tl('Hand.' + side)
fore_a = hd('LowerArm.' + side)
neck_z = hd('Neck').z
head_c = (hd('Head') + tl('Head')) * 0.5
gi = {g.name: g.index for g in obj.vertex_groups}
ARMG = {gi[n] for n in ('UpperArm.' + side, 'LowerArm.' + side, 'Hand.' + side) if n in gi}
HAND = gi['Hand.' + side]

# the albedo colour under each vertex (the first image texture of the material)
img = None
for m in obj.data.materials:
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image is not None:
                img = n.image
                break
px = list(img.pixels) if img is not None else None
W, Hh = (img.size[0], img.size[1]) if img is not None else (1, 1)
me = obj.data
uv = me.uv_layers.active.data
col = [None] * len(me.vertices)
for loop in me.loops:
    if col[loop.vertex_index] is None and px is not None:
        u, v = uv[loop.index].uv
        x = min(W - 1, max(0, int((u % 1.0) * W)))
        y = min(Hh - 1, max(0, int((v % 1.0) * Hh)))
        i = (y * W + x) * 4
        col[loop.vertex_index] = (px[i], px[i + 1], px[i + 2])


def skin(c):
    return c is not None and c[0] - c[2] > 0.07 and c[0] > 0.45 and c[0] >= c[1]


# the box round the hand: from just past the wrist to the finger tips, a little round it
lo = Vector((min(hand_a.x, hand_b.x), min(hand_a.y, hand_b.y), min(hand_a.z, hand_b.z))) - Vector((0.05, 0.06, 0.04))
hi = Vector((max(hand_a.x, hand_b.x), max(hand_a.y, hand_b.y), max(hand_a.z, hand_b.z))) + Vector((0.07, 0.04, 0.0))
cuff_z = hand_a.z + 0.035
tips_z = hand_a.z + 0.13          # the finger tips: above them the bone runs on into the head, but nothing there is hand
# the head is the same on both sides: a point on the hand's side whose mirror image lies on the other side's surface is cheek / hair / hood;
# whatever has no mirror image is the hand, or the lock of hair it holds
# (the head is not always on x = 0: a generated hero tilts it towards the hand, so the mirror is the middle of the crown)
_ws = [obj.matrix_world @ v.co for v in me.vertices]
_top = max(p.z for p in _ws)
_crown = [p.x for p in _ws if p.z > _top - 0.05]
X0 = sum(_crown) / len(_crown)
print('head middle x', round(X0, 3))
CELL = 0.01
reach = {}
for p in _ws:
    if -sgn * (p.x - X0) > 0.0 and p.z > neck_z - 0.06:
        k = (round(p.y / CELL), round(p.z / CELL))
        reach[k] = max(reach.get(k, 0.0), -sgn * (p.x - X0))


def inside_head(p):
    """Inside the other side's outline at this height and depth (own grid cell only, so the hood next to it does not count)."""
    return sgn * (p.x - X0) <= reach.get((round(p.y / CELL), round(p.z / CELL)), 0.0) + 0.004


from mathutils.bvhtree import BVHTree
_w = [obj.matrix_world @ v.co for v in me.vertices]
_other = [f.vertices[:] for f in me.polygons if all(-sgn * (_w[i].x - X0) > 0.0 for i in f.vertices)]
mirror_bvh = BVHTree.FromPolygons(_w, _other)


def mirrored(p):
    hit = mirror_bvh.find_nearest(Vector((2.0 * X0 - p.x, p.y, p.z)))
    return hit[0] is not None and hit[3] < 0.007


def seg_d(p, a, b):
    q, t = intersect_point_line(p, a, b)
    t = min(1.0, max(0.0, t))
    return (p - (a + (b - a) * t)).length


hand_v, drop_v, head_v = set(), set(), set()
for v in me.vertices:
    p = obj.matrix_world @ v.co
    armw = sum(g.weight for g in v.groups if g.group in ARMG)
    inbox = lo.x <= p.x <= hi.x and lo.y <= p.y <= hi.y and lo.z <= p.z <= hi.z
    if inbox and p.z > cuff_z and sgn * (p.x - X0) > 0.0 and (mirrored(p) or inside_head(p) or p.z > tips_z):
        if armw > 0.0:
            head_v.add(v.index)
    elif inbox and skin(col[v.index]) and sgn * p.x > 0.03:
        hand_v.add(v.index)
    elif inbox and p.z > cuff_z and sgn * p.x > 0.0:
        drop_v.add(v.index)        # the lock of hair the fingers hold, and the hood string
    elif armw > 0.0 and neck_z - 0.16 < p.z <= neck_z and sgn * p.x > 0.0 and min(seg_d(p, hd('UpperArm.' + side), fore_a), seg_d(p, fore_a, hand_a)) > 0.05:
        head_v.add(v.index)        # the collar and chest under the raised forearm
    elif armw > 0.0 and (p.z > neck_z or (p - head_c).length < 0.13):
        # above the neck and not the hand: the forearm sleeve lies along the forearm, everything else is head
        q, t = intersect_point_line(p, fore_a, hand_a)
        if not (0.0 <= t <= 1.0 and (p - q).length < 0.055):
            head_v.add(v.index)
print('hand', len(hand_v), 'drop', len(drop_v), 'head', len(head_v))

for i in hand_v:
    v = me.vertices[i]
    for g in list(v.groups):
        obj.vertex_groups[g.group].remove([i])
    obj.vertex_groups[HAND].add([i], 1.0, 'REPLACE')
for i in head_v:
    v = me.vertices[i]
    p = obj.matrix_world @ v.co
    lost = 0.0
    for g in list(v.groups):
        if g.group in ARMG:
            lost += g.weight
            obj.vertex_groups[g.group].remove([i])
    to = 'Head' if p.z > neck_z + 0.04 else ('Neck' if p.z > neck_z - 0.02 else 'Chest')
    obj.vertex_groups[gi[to]].add([i], lost, 'ADD')

bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
# a triangle from a finger to the cheek or the hood would stretch from the hand to the face: it goes too
dl = bm.verts.layers.deform.active


def arm_of(bv):
    return sum(w for g, w in bv[dl].items() if g in ARMG) if dl is not None else 0.0


torn = [f for f in bm.faces if any(v.index in hand_v for v in f.verts) and any(v.index not in hand_v and arm_of(v) < 0.5 for v in f.verts)]
print('torn faces', len(torn))
bmesh.ops.delete(bm, geom=torn, context='FACES_ONLY')
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in drop_v], context='VERTS')
# loose bits left behind by the cut
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(me)
bm.free()
me.update()



def hang_arm():
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    for n, d in (('UpperArm.' + side, Vector((sgn * 0.25, 0.0, -1.0))), ('LowerArm.' + side, Vector((sgn * 0.1, -0.3, -1.0))), ('Hand.' + side, Vector((sgn * 0.05, -0.2, -1.0)))):
        pb = rig.pose.bones[n]
        bpy.context.view_layer.update()
        cur = (pb.tail - pb.head).normalized()
        rot = cur.rotation_difference(d.normalized()).to_matrix().to_4x4()
        m = pb.matrix.copy()
        loc = m.to_translation()
        pb.matrix = Matrix.Translation(loc) @ rot @ Matrix.Translation(-loc) @ m
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')


# with the arm hanging down as in the game, a triangle that stretches to more than 3x its length joins the arm to the body or the hair: cut it
hang_arm()
ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
P = [v.co.copy() for v in ev.vertices]
obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
for pb in rig.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
bad = []
for f in bm.faces:
    vs = [v.index for v in f.verts]
    for a, b in zip(vs, vs[1:] + vs[:1]):
        if (P[a] - P[b]).length > 3.0 * (me.vertices[a].co - me.vertices[b].co).length + 0.015:
            bad.append(f)
            break
print('stretched faces cut', len(bad))
bmesh.ops.delete(bm, geom=bad, context='FACES_ONLY')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(me)
bm.free()
me.update()

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True, export_animations=False,
                          export_image_format='JPEG', export_jpeg_quality=85)

if preview:
    hang_arm()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg).to_mesh()
    bad = [(e.vertices[0], e.vertices[1]) for e in me.edges
           if (ev.vertices[e.vertices[0]].co - ev.vertices[e.vertices[1]].co).length > 2.5 * (me.vertices[e.vertices[0]].co - me.vertices[e.vertices[1]].co).length + 0.02]
    print('stretched edges', len(bad))
    for a, b in bad[:12]:
        va = me.vertices[a]
        print('  ', [round(c, 3) for c in obj.matrix_world @ va.co], [(obj.vertex_groups[g.group].name, round(g.weight, 2)) for g in va.groups])
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_WORKBENCH'
    scn.display.shading.color_type = 'TEXTURE'
    scn.render.resolution_x, scn.render.resolution_y = 500, 500
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 0.7
    views = (((0, -5, 1.2), (math.pi / 2, 0, 0), 0.7), ((5, 0, 1.2), (math.pi / 2, 0, math.pi / 2), 0.7), ((0, 5, 1.2), (math.pi / 2, 0, math.pi), 0.7),
             ((0, -5, 1.36), (math.pi / 2, 0, 0), 0.32), ((3.5, -3.5, 1.36), (math.pi / 2, 0, math.pi / 4), 0.32), ((5, 0, 1.36), (math.pi / 2, 0, math.pi / 2), 0.32))
    for k, (loc, rot, sc) in enumerate(views):
        cam.location, cam.rotation_euler, cam.data.ortho_scale = loc, rot, sc
        scn.render.filepath = preview.replace('.png', '_%d.png' % k)
        bpy.ops.render.render(write_still=True)
