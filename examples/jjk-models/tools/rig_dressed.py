"""Rig a body + fitted garments (output of fit_garments.py) with a 51-bone skeleton plus cloth-sway chains.

    blender -b -P tools/rig_dressed.py -- raw/suk_fitted.glb configs/sukuna_rig.json models/sukuna_final

Config: {"head": "head", "frac": {...rig_split.fit fractions...},
         "garments": {"gi": {"bones": ["hips","spine","chest","neck","shoulderL","shoulderR","upperarmL","upperarmR"],
                              "hem": {"n": 6, "frac": 0.2, "k": 2}}, "obi": {"tails": 2}, ...}}
Every garment is weighted (distance^-3, 3 nearest bones) to its allowed bones plus the sway bones generated for it. Sway chains hang from the
nearest body bone along the cloth (hem of gi/hakama, tails of the obi), and the game's spring script (spring_chain.gd) moves them."""
import bpy, bmesh, sys, os, json, math
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_split as rs

a = sys.argv[sys.argv.index('--') + 1:]
src, cfgpath, out_base = a[0], a[1], a[2]
cfg = json.load(open(cfgpath))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
objs = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
for o in objs.values():
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world.identity()
for o in [o for o in bpy.data.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)
body, head = objs['body'], objs[cfg.get('head', 'head')]
garments = {n: o for n, o in objs.items() if n in cfg['garments'] or n.rstrip('LR') in cfg['garments']}

# ── skeleton measured from the body ─────────────────────────────────────────────
bv = [v.co.copy() for v in body.data.vertices]
temp = []


def points_obj(name, pts):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in pts], [], [])
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    temp.append(o)
    return o


parts, roles = {}, {}
ax0 = cfg.get('arm_min_x', 0.2)
for side, sg in (('L', 1), ('R', -1)):
    parts['arm' + side] = points_obj('arm' + side, [p for p in bv if sg * p.x > ax0 and p.z > cfg.get('arm_min_z', 0.3)])
    roles['arm' + side] = 'arm' + side
    parts['shoe' + side] = points_obj('shoe' + side, [p for p in bv if sg * p.x > 0 and p.z < -0.90])
    roles['shoe' + side] = 'shoe' + side
parts['torso'] = points_obj('torso', [p for p in bv if abs(p.x) < ax0])
roles['torso'] = 'torso'
P, Hm, floor = rs.fit(parts, roles, {'frac': cfg.get('frac', {})})
for o in temp:
    bpy.data.objects.remove(o, do_unlink=True)

# ── sway chains from the garments ───────────────────────────────────────────────
base_arm_tmp = rs.build_armature(P, {})
base_segs = rs.segments(base_arm_tmp)
bpy.data.objects.remove(base_arm_tmp, do_unlink=True)


def nearest_base(p):
    return min(base_segs, key=lambda n: rs.seg_dist(p, *base_segs[n]))


sway = {}          # chain name -> (points, parent)
sway_of = {}       # garment name -> [chain names]


def hem_chains(gname, obj, n, frac, k, split_x=False):
    pts = [(obj.matrix_world @ v.co) for v in obj.data.vertices]
    zmin = min(p.z for p in pts)
    zmax = max(p.z for p in pts)
    zcut = zmin + (zmax - zmin) * frac
    groups = {}
    for p in pts:
        if p.z > zcut:
            continue
        key = ('L' if p.x > 0 else 'R') if split_x else ''
        groups.setdefault(key, []).append(p)
    names = []
    for key, g in groups.items():
        cx = sum(p.x for p in g) / len(g)
        cy = sum(p.y for p in g) / len(g)
        buckets = [[] for _ in range(n)]
        for p in g:
            ang = (math.atan2(p.y - cy, p.x - cx) + math.tau) % math.tau
            buckets[int(ang / math.tau * n) % n].append(p)
        for i, b in enumerate(buckets):
            if len(b) < 4:
                continue
            mx = sum(p.x for p in b) / len(b)
            my = sum(p.y for p in b) / len(b)
            top = Vector((mx, my, zcut + (zmax - zmin) * 0.10))
            bot = Vector((mx, my, min(p.z for p in b)))
            chain = [top.lerp(bot, j / k) for j in range(k + 1)]
            nm = f'sway_{gname}{key}{i}_'
            sway[nm] = (chain, nearest_base(top))
            names.append(nm)
    sway_of.setdefault(gname, []).extend(names)


def tail_chains(gname, obj, count, k):
    pts = [(obj.matrix_world @ v.co) for v in obj.data.vertices]
    zmax = max(p.z for p in pts)
    zmin = min(p.z for p in pts)
    tails = [p for p in pts if p.z < zmax - 0.085]
    for i, side in enumerate(('L', 'R')[:count]):
        g = [p for p in tails if (p.x > 0) == (side == 'L')]
        if len(g) < 4:
            continue
        mx = sum(p.x for p in g) / len(g)
        my = sum(p.y for p in g) / len(g)
        top = Vector((mx * 0.4, my, zmax - 0.04))
        bot = Vector((mx, my, zmin))
        chain = [top.lerp(bot, j / k) for j in range(k + 1)]
        nm = f'sway_{gname}{side}_'
        sway[nm] = (chain, nearest_base(top))
        sway_of.setdefault(gname, []).append(nm)


for gname, gcfg in cfg['garments'].items():
    for oname, o in garments.items():
        if oname.rstrip('LR') != gname and oname != gname:
            continue
        if 'hem' in gcfg:
            h = gcfg['hem']
            hem_chains(oname, o, h['n'], h['frac'], h['k'], h.get('split_x', False))
        if 'tails' in gcfg:
            tail_chains(oname, o, gcfg['tails'], 3)

arm = rs.build_armature(P, sway)
segs = rs.segments(arm)
all_bones = list(segs)


def weight(obj, allowed, power=3.0):
    for n in allowed:
        obj.vertex_groups.new(name=n)
    groups = {g.name: g for g in obj.vertex_groups}
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        ds = sorted(((rs.seg_dist(p, *segs[n]), n) for n in allowed))[:3]
        ws = [1.0 / (d + 0.004) ** power for d, _ in ds]
        tot = sum(ws)
        for (d, n), w in zip(ds, ws):
            groups[n].add([v.index], w / tot, 'REPLACE')
    m = obj.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    obj.parent = arm


weight(body, all_bones)
rs.rigid(head, arm, 'head')
head.vertex_groups['head'].add([v.index for v in head.data.vertices], 1.0, 'REPLACE')
for oname, o in garments.items():
    gname = oname.rstrip('LR') if oname.rstrip('LR') in cfg['garments'] else oname
    gcfg = cfg['garments'][gname]
    allowed = [b for b in gcfg['bones'] if b in segs] + sway_of.get(oname, [])
    allowed = allowed + [b for n in sway_of.get(oname, []) for b in all_bones if b.startswith(n)]
    allowed = list(dict.fromkeys(b for b in allowed if b in segs))
    weight(o, allowed)
for o in [body, head] + list(garments.values()):
    for p in o.data.polygons:
        p.use_smooth = True
arm.name = os.path.basename(out_base) + '_rig'
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), out_base)
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', export_skins=True, export_image_format='JPEG', export_yup=True)
print('DRESSED', out_base, 'bones', len(arm.data.bones), 'sway chains', len(sway), 'objects', len(objs))
