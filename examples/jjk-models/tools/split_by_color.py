"""Split a single textured character mesh (Triverse output) into named parts by texture colour and height.

    blender -b -P tools/split_by_color.py -- configs/gojo_split.json

Config: {"src": "raw/x.glb", "out": "raw/x_split.glb", "ratio": 0.3,
         "rules": [{"part": "shoe", "if": "z < 0.07 and v < 0.3"}, ...], "default": "pants", "smooth": 3}
Variables in a rule: z = height 0..1 (feet..top), ax = |x| / height, x = signed x / height, y = front(-)/back(+) / height,
v/s/h = value, saturation, hue of the texture at the face centre (0..1). First matching rule wins; unmatched faces get `default`.
Labels are smoothed by neighbour majority so a stray dark pixel does not punch a hole. Each part is decimated separately and keeps the
original material, so the texture and UVs still match. Parts are named p_<part>; rig_split.py maps those names to roles."""
import bpy, bmesh, colorsys, json, os, sys
import numpy as np
from collections import Counter
from mathutils import Vector

cfgpath = sys.argv[sys.argv.index('--') + 1]
cfg = json.load(open(cfgpath))
base = os.path.dirname(os.path.dirname(os.path.abspath(cfgpath)))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(base, cfg['src']))
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in objs:
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world.identity()
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
if len(obj.data.materials) == 0 or not obj.data.uv_layers:
    raise SystemExit('mesh needs a material and UVs')

mat = obj.data.materials[0]
img = None
for n in mat.node_tree.nodes:
    if n.type == 'TEX_IMAGE' and n.image:
        img = n.image
        break
W, Hh = img.size
pix = np.array(img.pixels[:], dtype=np.float32).reshape(Hh, W, 4)

me = obj.data
verts = np.array([v.co[:] for v in me.vertices])
mn, mx = verts.min(0), verts.max(0)
H = mx[2] - mn[2]
cx = 0.5 * (mn[0] + mx[0])
uvl = me.uv_layers.active.data

labels = []
rules = [(r['part'], compile(r['if'], 'rule', 'eval')) for r in cfg['rules']]
for poly in me.polygons:
    c = np.mean([verts[i] for i in poly.vertices], axis=0)
    uv = np.mean([uvl[li].uv[:] for li in poly.loop_indices], axis=0)
    px = pix[min(Hh - 1, max(0, int(uv[1] * Hh))), min(W - 1, max(0, int(uv[0] * W)))]
    h_, s_, v_ = colorsys.rgb_to_hsv(float(px[0]), float(px[1]), float(px[2]))
    env = {'z': (c[2] - mn[2]) / H, 'ax': abs(c[0] - cx) / H, 'x': (c[0] - cx) / H, 'y': (c[1] - 0.5 * (mn[1] + mx[1])) / H,
           'v': v_, 's': s_, 'h': h_}
    lab = cfg['default']
    for part, code in rules:
        if eval(code, {}, env):
            lab = part
            break
    labels.append(lab)

# majority smoothing over face adjacency
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
for _ in range(cfg.get('smooth', 3)):
    new = list(labels)
    for f in bm.faces:
        nb = [labels[g.index] for e in f.edges for g in e.link_faces if g is not f]
        if nb:
            top, n = Counter(nb).most_common(1)[0]
            if n >= 2 and top != labels[f.index] and Counter(nb)[labels[f.index]] <= 1:
                new[f.index] = top
    labels = new

parts = sorted(set(labels))
print('PARTS', {p: labels.count(p) for p in parts})
out_objs = []
for p in parts:
    b2 = bm.copy()
    b2.faces.ensure_lookup_table()
    drop = [f for f in b2.faces if labels[f.index] != p]
    bmesh.ops.delete(b2, geom=drop, context='FACES')
    loose = [v for v in b2.verts if not v.link_faces]
    bmesh.ops.delete(b2, geom=loose, context='VERTS')
    m2 = bpy.data.meshes.new('p_' + p)
    b2.to_mesh(m2)
    b2.free()
    o2 = bpy.data.objects.new('p_' + p, m2)
    bpy.context.scene.collection.objects.link(o2)
    m2.materials.append(mat)
    out_objs.append(o2)
bm.free()
bpy.data.objects.remove(obj, do_unlink=True)

ratio = cfg.get('ratio', 0.3)
for o in out_objs:
    n0 = len(o.data.polygons)
    if n0 > 1500:
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new('dec', 'DECIMATE')
        m.ratio = max(0.05, min(1.0, ratio if n0 * ratio > 700 else 700 / n0))
        bpy.ops.object.modifier_apply(modifier='dec')
    for poly in o.data.polygons:
        poly.use_smooth = True
    print('PART', o.name, n0, '->', len(o.data.polygons))

out = os.path.join(base, cfg['out'])
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True)
print('SPLIT', out, sum(len(o.data.polygons) for o in out_objs))
