"""Re-skin a rigged hero with Blender's bone-heat weights instead of distance weights (the hand no longer drags the thigh, the knee no
longer folds the shin into a spike).
Generated meshes are triangle soups (open, overlapping shells), on which bone heat fails. So the weights are computed on a clean proxy:
  1. the mesh is copied and voxel-remeshed into one closed, manifold shell (fine voxels keep the gap between hand and leg),
  2. the proxy is decimated to a size bone heat handles quickly, then parented with automatic (heat) weights,
  3. the weights are carried back to the real mesh by Data Transfer (nearest face, interpolated),
  4. at most 4 bones per vertex, tiny weights removed, everything normalised (what glTF and Godot keep anyway).
    blender -b -P tools/heat_rig.py -- rigged_in.glb out.glb [--voxel 0.006] [--proxy-faces 60000]   (voxel in units of height)"""
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
voxel_rel = float(argv[argv.index('--voxel') + 1]) if '--voxel' in argv else 0.006
proxy_faces = int(argv[argv.index('--proxy-faces') + 1]) if '--proxy-faces' in argv else 60000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.find_armature() == rig)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o != body:
        bpy.data.objects.remove(o)
zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
H = max(zs) - min(zs)
bones = [b.name for b in rig.data.bones if not b.name.startswith('sway_')]


def activate(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


# 1-2. the proxy shell
proxy = body.copy()
proxy.data = body.data.copy()
proxy.name = 'proxy'
bpy.context.collection.objects.link(proxy)
proxy.vertex_groups.clear()
proxy.modifiers.clear()
proxy.parent = None
proxy.matrix_world = body.matrix_world.copy()
activate(proxy)
rm = proxy.modifiers.new('remesh', 'REMESH')
rm.mode = 'VOXEL'
rm.voxel_size = voxel_rel * H / max(proxy.matrix_world.to_scale())
rm.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier='remesh')
nf = len(proxy.data.polygons)
if nf > proxy_faces:
    dec = proxy.modifiers.new('dec', 'DECIMATE')
    dec.ratio = proxy_faces / nf
    bpy.ops.object.modifier_apply(modifier='dec')
print('PROXY faces %d -> %d (voxel %.4f)' % (nf, len(proxy.data.polygons), voxel_rel * H))

# heat weights on the proxy (only the deform bones of the body; hair/skirt sway bones keep their old weights below)
for b in rig.data.bones:
    b.use_deform = b.name in bones
def heat():
    proxy.vertex_groups.clear()
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    names = [g.name for g in proxy.vertex_groups]
    used = set(g.group for v in proxy.data.vertices for g in v.groups)
    return names, [n for n in names if proxy.vertex_groups[n].index not in used]


# the rest pose is what heat measures: a rig left in another pose (an A-pose baked over a T-pose) would put the bones outside the skin
rig.data.pose_position = 'REST'
got, empty = heat()
if len(empty) > len(got) // 2:
    # bone heat's solver gives up on small meshes: the same thing ten times bigger
    print('HEAT retry at x10')
    proxy.parent = None
    for o in (rig, proxy):
        o.scale = o.scale * 10.0
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    got, empty = heat()
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True)
    rig.select_set(True)
    proxy.parent = None
    for o in (rig, proxy):
        o.scale = o.scale * 0.1
    bpy.context.view_layer.update()
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def visibility_weights():
    """What bone heat does, by hand, when its solver gives up: a point takes weight only from bones it can see through the inside of
    the body (a straight line to the bone that never leaves the skin), falling off with distance, then smoothed over the surface."""
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import intersect_point_line
    proxy.vertex_groups.clear()
    mw = proxy.matrix_world
    inv = mw.inverted()
    segs = {}
    for b in rig.data.bones:
        if b.name in bones:
            segs[b.name] = (inv @ (rig.matrix_world @ b.head_local), inv @ (rig.matrix_world @ b.tail_local))
    groups = {n: proxy.vertex_groups.new(name=n) for n in segs}
    bvh = BVHTree.FromPolygons([v.co for v in proxy.data.vertices], [p.vertices[:] for p in proxy.data.polygons])
    for v in proxy.data.vertices:
        p = v.co - v.normal * 0.002
        cand = []
        for n, (a, b) in segs.items():
            q, t = intersect_point_line(p, a, b)
            t = min(1.0, max(0.0, t))
            q = a + (b - a) * t
            d = (q - p).length
            cand.append((d, n, q))
        cand.sort(key=lambda c: c[0])
        vis = []
        for d, n, q in cand[:6]:
            hit = bvh.ray_cast(p, (q - p).normalized(), d) if d > 1e-5 else (None,)
            if hit[0] is None:
                vis.append((d, n))
        if not vis:
            vis = [(cand[0][0], cand[0][1])]
        dmin = vis[0][0]
        vis = [c for c in vis if c[0] < dmin * 2.2 + 0.01][:4]
        ws = [1.0 / max(d, 1e-4) ** 2 for d, _ in vis]
        tot = sum(ws)
        for (d, n), w in zip(vis, ws):
            groups[n].add([v.index], w / tot, 'REPLACE')
    activate(proxy)
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    return list(segs), []


if len(empty) > len(got) // 2:
    print('HEAT failed: visibility weights instead')
    got, empty = visibility_weights()
print('HEAT groups', len(got), 'empty', empty)
if len(got) < len(bones) // 2:
    sys.exit('bone heat failed on the proxy')

# 3. carry the weights back
keep_sway = {g.name: g for g in body.vertex_groups if g.name.startswith('sway_')}
for g in list(body.vertex_groups):
    if not g.name.startswith('sway_'):
        body.vertex_groups.remove(g)
for n in got:
    if n not in body.vertex_groups:
        body.vertex_groups.new(name=n)
activate(body)
dt = body.modifiers.new('xfer', 'DATA_TRANSFER')
dt.object = proxy
dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'
dt.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.datalayout_transfer(modifier='xfer')
while body.modifiers[0].name != 'xfer':
    bpy.ops.object.modifier_move_up(modifier='xfer')
bpy.ops.object.modifier_apply(modifier='xfer')

# 3b. capsules: on a fused proxy a coat tail or a sash touching the hand takes arm weight and is pulled into a sheet when the arm swings.
# An arm bone may only move what lies inside a capsule round its arm; cloth hanging away from the legs follows the hips more than the leg.
from mathutils.geometry import intersect_point_line


def seg_dist(p, a, b):
    q, t = intersect_point_line(p, a, b)
    t = min(1.0, max(0.0, t))
    return (p - (a + (b - a) * t)).length


segw = {b.name: (rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in rig.data.bones}
gidx = {g.index: g.name for g in body.vertex_groups}
gname = {g.name: g for g in body.vertex_groups}
z0 = min(zs)
ARM = {'UpperArm': 0.085, 'LowerArm': 0.07, 'Hand': 0.075}
moved = 0
for v in body.data.vertices:
    p = body.matrix_world @ v.co
    w = {gidx[g.group]: g.weight for g in v.groups if g.weight > 0.0}
    if not w:
        continue
    new = dict(w)
    for sd in ('L', 'R'):
        arm = [f'{k}.{sd}' for k in ARM if f'{k}.{sd}' in segw]
        if not any(n in new for n in arm):
            continue
        inside = any(seg_dist(p, *segw[n]) < ARM[n.split('.')[0]] * H for n in arm)
        if not inside:
            for n in arm:
                new.pop(n, None)
        leg = [n for n in (f'UpperLeg.{sd}', f'LowerLeg.{sd}') if n in segw]
        lw = sum(new.get(n, 0.0) for n in leg)
        if lw > 0.0 and 0.12 * H < p.z - z0 < 0.56 * H:
            d = min(seg_dist(p, *segw[n]) for n in leg)
            r = 0.09 * H
            if d > r:
                keep = max(0.35, 1.0 - (d - r) / r)        # 1 at the leg's skin, 0.35 a leg's width further out
                for n in leg:
                    if n in new:
                        new[n] *= keep
                new['Hips'] = new.get('Hips', 0.0) + lw * (1.0 - keep)
    if new != w:
        moved += 1
        if not new:      # it only had arm weight: the nearest body bone takes it
            near = min((n for n in bones if n in segw and not n.split('.')[0] in ARM), key=lambda n: seg_dist(p, *segw[n]))
            new = {near: 1.0}
        tot = sum(new.values())
        for n in w:
            if n not in new:
                gname[n].remove([v.index])
        for n, x in new.items():
            if n not in gname:
                gname[n] = body.vertex_groups.new(name=n)
            gname[n].add([v.index], x / tot, 'REPLACE')
print('CAPSULE verts changed', moved)

# 4. clean: 4 influences, drop slivers, normalise
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.02)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')
loose = sum(1 for v in body.data.vertices if not v.groups)
print('UNWEIGHTED verts', loose)
bpy.data.objects.remove(proxy)
for b in rig.data.bones:
    b.use_deform = True
if not body.modifiers.get('Armature') and not any(m.type == 'ARMATURE' for m in body.modifiers):
    body.modifiers.new('Armature', 'ARMATURE').object = rig

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True, export_skins=True,
                          export_animations=False, export_image_format='JPEG', export_jpeg_quality=88)
print('SAVED', dst)
