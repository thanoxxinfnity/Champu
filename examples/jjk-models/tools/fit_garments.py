"""Fit separately generated garments (each normalised into a +-1 box) onto a body.

    blender -b -P tools/fit_garments.py -- body.glb fit.json out_base

fit.json: {"garments": {"gi": {"file": "raw/suk_gi.glb", "scale": 0.40, "z": 0.31, "x": 0, "y": 0, "rot_x": 0, "solidify": 0.006,
                              "tint": [1.25, 1.25, 1.25]}, ...}}
Scale is uniform. `z` is the garment centre height in body units (body spans -1 .. 1). `rot_x` rotates about X in degrees first (geta
soles come standing and have to be laid flat). `tint` multiplies the texture so cream cloth can be pushed to white. Result: one blend and
one glb holding the body, head and every garment as separate objects (no rig yet)."""
import bpy, bmesh, sys, os, json, math
from mathutils import Matrix, Vector

a = sys.argv[sys.argv.index('--') + 1:]
body_path, fit_path, base = a[0], a[1], a[2]
fit = json.load(open(fit_path))
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
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
    return ms


bodies = load(body_path)
bodies.sort(key=lambda o: sum(v.co.z for v in o.data.vertices) / len(o.data.vertices))
bodies[0].name, bodies[1].name = 'body', 'head'
body_pts = [v.co for v in bodies[0].data.vertices]


def body_center_y(z0, z1):
    ys = [p.y for p in body_pts if z0 <= p.z <= z1 and abs(p.x) < 0.2]
    return (max(ys) + min(ys)) / 2


def foot_center(side):
    f = [p for p in body_pts if p.z < -0.93 and p.x * side > 0.02]
    return (sum(p.x for p in f) / len(f), (max(p.y for p in f) + min(p.y for p in f)) / 2)


def split_lr(obj):
    # the pair arrives as two islands; split them at x = 0 into left / right objects
    out = []
    for side, tag in ((1, 'L'), (-1, 'R')):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if (sum(v.co.x for v in f.verts) / 3) * side <= 0], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        m2 = bpy.data.meshes.new(obj.name + tag)
        bm.to_mesh(m2)
        bm.free()
        for mat in obj.data.materials:
            m2.materials.append(mat)
        o2 = bpy.data.objects.new(obj.name + tag, m2)
        bpy.context.scene.collection.objects.link(o2)
        out.append((o2, side))
    bpy.data.objects.remove(obj, do_unlink=True)
    return out


for name, g in list(fit['garments'].items()):
    obj = load(os.path.join(root, g['file']))[0]
    obj.name = name
    me = obj.data
    # generated garments often arrive unwelded; smoothing / displacing unwelded seams tears them open, so weld first
    wbm = bmesh.new()
    wbm.from_mesh(me)
    nv0 = len(wbm.verts)
    bmesh.ops.remove_doubles(wbm, verts=wbm.verts, dist=g.get('weld', 5e-5))
    print('WELD', name, nv0, '->', len(wbm.verts))
    wbm.to_mesh(me)
    wbm.free()
    tgt = int(g.get('tris', 0) * float(__import__('os').environ.get('LODSCALE', 1.0)))
    if tgt and sum(len(p.vertices) - 2 for p in me.polygons) > tgt:
        # reduce the clean, welded, un-thickened shell first; thickness and push-out come afterwards so the collapse never sees two layers
        bpy.context.view_layer.objects.active = obj
        dm = obj.modifiers.new('lod', 'DECIMATE')
        dm.ratio = tgt / max(1, sum(len(p.vertices) - 2 for p in me.polygons))
        dm.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='lod')
        print('LOD', name, '->', len(me.polygons))
    if g.get('auto_y'):
        g['y'] = body_center_y(*g['auto_y'])
    if g.get('split_lr'):
        # pivot each foot item on its own foot: scale first (about the pair centre), then split and move
        zs0 = [v.co for v in me.vertices]
        mn0 = Vector((min(v.x for v in zs0), min(v.y for v in zs0), min(v.z for v in zs0)))
        mx0 = Vector((max(v.x for v in zs0), max(v.y for v in zs0), max(v.z for v in zs0)))
        me.transform(Matrix.Translation(-(mn0 + mx0) / 2))
        if g.get('rot_x'):
            me.transform(Matrix.Rotation(math.radians(g['rot_x']), 4, 'X'))
        sc = g['scale']
        me.transform(Matrix.Diagonal((sc, sc, sc, 1.0)))
        for o2, side in split_lr(obj):
            pts = [v.co for v in o2.data.vertices]
            c = Vector((sum(p.x for p in pts) / len(pts), (max(p.y for p in pts) + min(p.y for p in pts)) / 2, 0.0))
            fx, fy = foot_center(side)
            o2.data.transform(Matrix.Translation(Vector((fx - c.x, fy - c.y + g.get('dy', 0.0), g['z']))))
            for p in o2.data.polygons:
                p.use_smooth = True
        continue
    # centre the garment's own box first so scale / rotation act about its middle
    zs = [v.co for v in me.vertices]
    mn = Vector((min(v.x for v in zs), min(v.y for v in zs), min(v.z for v in zs)))
    mx = Vector((max(v.x for v in zs), max(v.y for v in zs), max(v.z for v in zs)))
    me.transform(Matrix.Translation(-(mn + mx) / 2))
    if g.get('rot_x'):
        me.transform(Matrix.Rotation(math.radians(g['rot_x']), 4, 'X'))
    if g.get('rot_z'):
        me.transform(Matrix.Rotation(math.radians(g['rot_z']), 4, 'Z'))
    s = g['scale']
    me.transform(Matrix.Diagonal((s, s, s * g.get('sz', 1.0), 1.0)))
    me.transform(Matrix.Translation(Vector((g.get('x', 0.0), g.get('y', 0.0), g['z']))))
    if g.get('smooth'):
        bpy.context.view_layer.objects.active = obj
        m = obj.modifiers.new('sm', 'SMOOTH')
        m.factor = g['smooth'][0]
        m.iterations = int(g['smooth'][1])
        bpy.ops.object.modifier_apply(modifier='sm')
    if g.get('displace'):
        # smoothing shrinks the cloth; push it back out along its normals so the layers underneath never poke through
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * g['displace']
        bm.to_mesh(me)
        bm.free()
    if g.get('solidify'):
        bpy.context.view_layer.objects.active = obj
        m = obj.modifiers.new('thick', 'SOLIDIFY')
        m.thickness = g['solidify']
        m.offset = 0.0
        bpy.ops.object.modifier_apply(modifier='thick')
    for mat in me.materials:
        b = mat.node_tree.nodes['Principled BSDF']
        b.inputs['Roughness'].default_value = 0.9     # cloth is matte: no foil-like highlights on the folds
        b.inputs['Metallic'].default_value = 0.0
        if 'Specular IOR Level' in b.inputs:
            b.inputs['Specular IOR Level'].default_value = 0.15
    for p in me.polygons:
        p.use_smooth = True
    if g.get('tint'):
        for mat in me.materials:
            for n in mat.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image:
                    img = n.image
                    px = list(img.pixels)
                    t = g['tint']
                    for i in range(0, len(px), 4):
                        px[i] = min(1.0, px[i] * t[0])
                        px[i + 1] = min(1.0, px[i + 1] * t[1])
                        px[i + 2] = min(1.0, px[i + 2] * t[2])
                    img.pixels = px
    if g.get('flat_color'):
        for mat in me.materials:
            b = mat.node_tree.nodes['Principled BSDF']
            for l in list(mat.node_tree.links):
                if l.to_socket == b.inputs['Base Color']:
                    mat.node_tree.links.remove(l)
            b.inputs['Base Color'].default_value = (*g['flat_color'], 1)
zones = fit.get('trim_zones') or ([[fit['trim_body'][0], fit['trim_body'][1], 0.35]] if fit.get('trim_body') else [])
if zones:
    # delete the skin that clothes hide (torso, hips, thighs): it would poke through folds and muscle ridges as skin-coloured streaks
    bm = bmesh.new()
    bm.from_mesh(bodies[0].data)
    bm.faces.ensure_lookup_table()
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        if any(z0 < c.z < z1 and abs(c.x) < xm for z0, z1, xm in zones):
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(bodies[0].data)
    bm.free()
    print('TRIMMED', len(kill))
for ob, key in ((bodies[0], 'body_tris'), (bodies[1], 'head_tris')):
    t = int(fit.get(key, 0) * float(__import__('os').environ.get('LODSCALE', 1.0)))
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if t and n > t:
        bpy.context.view_layer.objects.active = ob
        dm = ob.modifiers.new('lod', 'DECIMATE')
        dm.ratio = t / n
        dm.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='lod')
        for p in ob.data.polygons:
            p.use_smooth = True
        print('LOD', ob.name, n, '->', len(ob.data.polygons))
out = os.path.join(root, 'raw', base)
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', export_image_format='JPEG', export_yup=True)
print('FITTED', base, sorted(fit['garments']))
