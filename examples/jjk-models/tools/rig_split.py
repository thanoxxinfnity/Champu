"""Rig a Rodin-generated, BANG-split character (one mesh per part) from scratch.

    blender -b -P tools/rig_split.py -- configs/gojo.json

Z is up and the character faces -Y inside Blender (glTF export turns that into Y-up facing +Z). The armature is fitted to the measured
mesh: spine/neck/head from fractions of the height, arms from the arm parts' own extents, 5 fingers x 3 joints and toes from the
hand/foot extents. Weights are our own (nearest bone segments, distance^-3, only bones allowed for that part's role), because automatic
heat weights fail on these dense, partly open meshes.

Config (JSON): {"name", "src", "parts": {"root.3": "head", ...}, "out_dir"}. Roles: head, hair, torso, pants, skirt, sash, armL, armR,
shoeL, shoeR, shinL, shinR, rigid:<bone> (bind 100% to one bone), body.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky']


def args():
    return sys.argv[sys.argv.index('--') + 1:]


def load(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    # drop empties/parents: bake the importer's transform into the mesh data so measurements are in world space
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH':
            mw = o.matrix_world.copy()
            o.parent = None
            o.data.transform(mw)
            o.matrix_world.identity()
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    return {o.name: o for o in bpy.context.scene.objects if o.type == 'MESH'}


def bounds(objs):
    mn = Vector((1e9,) * 3)
    mx = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            c = o.matrix_world @ v.co
            mn = Vector(map(min, mn, c))
            mx = Vector(map(max, mx, c))
    return mn, mx


def fit(parts, roles, cfg):
    """Joint positions measured from the parts."""
    allobj = list(parts.values())
    mn, mx = bounds(allobj)
    H = mx.z - mn.z
    cx = 0.5 * (mn.x + mx.x)
    cy = 0.5 * (mn.y + mx.y)
    floor = mn.z
    f = cfg.get('frac', {})

    def z(k, d):
        return floor + H * f.get(k, d)

    P = {}
    P['pelvis'] = Vector((cx, cy, z('pelvis', 0.505)))
    P['spine'] = Vector((cx, cy, z('spine', 0.60)))
    P['chest'] = Vector((cx, cy, z('chest', 0.70)))
    P['neck'] = Vector((cx, cy, z('neck', 0.815)))
    P['head'] = Vector((cx, cy, z('head', 0.855)))
    P['head_top'] = Vector((cx, cy, floor + H * 0.99))
    for side, sx in (('L', 1), ('R', -1)):
        arm = [o for n, o in parts.items() if roles[n] == 'arm' + side]
        amn, amx = bounds(arm)
        tipx = (amx.x if sx > 0 else amn.x)
        # arms leave the shoulder along the cfg direction (T-pose: horizontal, A-pose: down-and-out)
        shoulder_x = cx + sx * H * f.get('shoulder_x', 0.105)
        shoulder_z = z('shoulder_z', 0.77)
        sh = Vector((shoulder_x, cy, shoulder_z))
        tip = Vector((tipx, 0.5 * (amn.y + amx.y), amn.z + (amx.z - amn.z) * f.get('tip_z', 0.5)))
        d = tip - sh
        L = d.length
        hand_len = L * f.get('hand_frac', 0.26)
        wrist = sh + d * (1 - hand_len / L)
        elbow = sh + d * f.get('elbow_at', 0.46)
        P['shoulder' + side] = P['chest'] + Vector((sx * 0.02, 0, H * 0.04))
        P['upperarm' + side] = sh
        P['forearm' + side] = elbow
        P['hand' + side] = wrist
        fdir = (tip - wrist).normalized()
        # palm normal is Z in a T-pose; fingers fan along Y
        for name, (off, lens) in {
            'index': (-0.30, (0.30, 0.22, 0.18)), 'middle': (-0.05, (0.34, 0.24, 0.19)),
            'ring': (0.20, (0.31, 0.22, 0.18)), 'pinky': (0.42, (0.24, 0.17, 0.14))}.items():
            wid = hand_len * 0.30
            cur = wrist + fdir * hand_len * 0.30 + Vector((0, 1, 0)) * off * wid * -1
            for j, Lj in enumerate(lens):
                P[f'{name}{j}{side}'] = cur
                cur = cur + fdir * hand_len * Lj
            P[f'{name}3{side}'] = cur
        cur = wrist + fdir * hand_len * 0.12 + Vector((0, -1, 0)) * hand_len * 0.22
        tdir = (fdir * 0.6 + Vector((0, -1, 0)) * 0.7).normalized()
        for j, Lj in enumerate((0.24, 0.20, 0.16)):
            P[f'thumb{j}{side}'] = cur
            cur = cur + tdir * hand_len * Lj
        P['thumb3' + side] = cur
        # legs
        shoe = [o for n, o in parts.items() if roles[n] == 'shoe' + side]
        smn, smx = bounds(shoe)
        hip_x = cx + sx * H * f.get('hip_x', 0.085)
        P['thigh' + side] = Vector((hip_x, cy, P['pelvis'].z - H * 0.02))
        P['shin' + side] = Vector((hip_x, cy - H * 0.005, floor + H * f.get('knee', 0.27)))
        foot_x = 0.5 * (smn.x + smx.x)
        P['foot' + side] = Vector((foot_x, cy, floor + H * f.get('ankle', 0.075)))
        P['toe' + side] = Vector((foot_x, smn.y + (smx.y - smn.y) * 0.45, smn.z + (smx.z - smn.z) * 0.35))
        P['toeEnd' + side] = Vector((foot_x, smn.y + (smx.y - smn.y) * 0.02, smn.z + (smx.z - smn.z) * 0.25))
    return P, H, floor


def build_armature(P, sway):
    arm = bpy.data.armatures.new('Armature')
    ob = bpy.data.objects.new('Armature', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones

    def bone(n, a, b, parent=None, connect=False):
        e = eb.new(n)
        e.head, e.tail = a, b
        if (e.tail - e.head).length < 1e-4:
            e.tail = e.head + Vector((0, 0, 0.01))
        if parent:
            e.parent = eb[parent]
            e.use_connect = connect
        return e

    bone('hips', P['pelvis'], P['spine'])
    bone('spine', P['spine'], P['chest'], 'hips', True)
    bone('chest', P['chest'], P['neck'], 'spine', True)
    bone('neck', P['neck'], P['head'], 'chest', True)
    bone('head', P['head'], P['head_top'], 'neck', True)
    for s in ('L', 'R'):
        bone('shoulder' + s, P['shoulder' + s], P['upperarm' + s], 'chest')
        bone('upperarm' + s, P['upperarm' + s], P['forearm' + s], 'shoulder' + s, True)
        bone('forearm' + s, P['forearm' + s], P['hand' + s], 'upperarm' + s, True)
        tipdir = (P['hand' + s] - P['forearm' + s]).normalized()
        bone('hand' + s, P['hand' + s], P['hand' + s] + tipdir * (P['hand' + s] - P['forearm' + s]).length * 0.2, 'forearm' + s, True)
        for f in FINGERS:
            prev = 'hand' + s
            for j in range(3):
                bone(f'{f}{j}{s}', P[f'{f}{j}{s}'], P[f'{f}{j+1}{s}'], prev, False)
                prev = f'{f}{j}{s}'
        bone('thigh' + s, P['thigh' + s], P['shin' + s], 'hips')
        bone('shin' + s, P['shin' + s], P['foot' + s], 'thigh' + s, True)
        bone('foot' + s, P['foot' + s], P['toe' + s], 'shin' + s, True)
        bone('toe' + s, P['toe' + s], P['toeEnd' + s], 'foot' + s, True)
    for cname, (pts, parent) in sway.items():
        prev = parent
        for i in range(1, len(pts)):
            bone(f'{cname}{i}', pts[i - 1], pts[i], prev, False)
            prev = f'{cname}{i}'
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def segments(arm):
    out = {}
    for b in arm.data.bones:
        out[b.name] = (arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local)
    return out


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (p - (a + ab * t)).length


ALLOWED = {
    'head': ['head', 'neck'],
    'torso': ['hips', 'spine', 'chest', 'neck', 'shoulderL', 'shoulderR', 'upperarmL', 'upperarmR'],
    'pants': ['hips', 'spine', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'],
    'skirt': ['hips', 'spine', 'thighL', 'thighR', 'shinL', 'shinR'],
    'sash': ['hips', 'spine'],
    'body': ['hips', 'spine', 'chest', 'neck', 'head', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'toeL', 'toeR'],
}


def allowed_for(role, bones):
    if role in ALLOWED:
        base = ALLOWED[role]
        extra = [b for b in bones if any(b.startswith(p) for p in ('sway_' + role,))]
        return [b for b in base if b in bones] + extra
    side = role[-1] if role[-1] in 'LR' else None
    if role.startswith('arm'):
        return [b for b in bones if b.endswith(side) and b.split(side)[0].rstrip('0123') in
                ('shoulder', 'upperarm', 'forearm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')]
    if role.startswith('shoe'):
        return [b for b in bones if b in ('shin' + side, 'foot' + side, 'toe' + side)]
    if role.startswith('shin'):
        return [b for b in bones if b in ('thigh' + side, 'shin' + side, 'foot' + side)]
    return list(bones)


def weight(obj, arm, role, segs, extra_bones=()):
    names = allowed_for(role, list(segs)) + [b for b in extra_bones if b in segs]
    for n in names:
        obj.vertex_groups.new(name=n)
    groups = {g.name: g for g in obj.vertex_groups}
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        ds = sorted(((seg_dist(p, *segs[n]), n) for n in names))[:3]
        ws = [1.0 / (d + 0.004) ** 3 for d, _ in ds]
        tot = sum(ws)
        for (d, n), w in zip(ds, ws):
            groups[n].add([v.index], w / tot, 'REPLACE')
    m = obj.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    obj.parent = arm


def rigid(obj, arm, bone):
    vg = obj.vertex_groups.new(name=bone)
    vg.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
    m = obj.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    obj.parent = arm


def main():
    cfgpath = args()[0]
    cfg = json.load(open(cfgpath))
    base = os.path.dirname(os.path.dirname(os.path.abspath(cfgpath)))
    parts = load(os.path.join(base, cfg['src']))
    roles = {}
    for n, r in cfg['parts'].items():
        roles[n] = r
    # arms are assigned by the sign of x if the config says just "arm"
    for n, o in parts.items():
        if roles.get(n) == 'arm':
            mn, mx = bounds([o])
            roles[n] = 'armL' if (mn.x + mx.x) > 0 else 'armR'
        if roles.get(n) in ('shoe', 'shin'):
            mn, mx = bounds([o])
            roles[n] += 'L' if (mn.x + mx.x) > 0 else 'R'
    P, H, floor = fit(parts, roles, cfg)
    sway = {}
    for cname, spec in cfg.get('sway', {}).items():
        a = Vector(spec['from']) * H + Vector((0, 0, floor)) if False else None
    arm = build_armature(P, {})
    segs = segments(arm)
    for n, o in parts.items():
        role = roles[n]
        o.name = f"{cfg['name']}_{role}_{n.split('.')[-1]}"
        if role.startswith('rigid:'):
            rigid(o, arm, role.split(':')[1])
        elif role == 'hair':
            rigid(o, arm, 'head')
        else:
            weight(o, arm, role, segs)
    arm.name = cfg['name'] + '_rig'
    out = os.path.join(base, cfg.get('out_dir', 'models'))
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, cfg['name'] + '_rigged.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, cfg['name'] + '_rigged.glb'), export_format='GLB', export_skins=True,
                              export_yup=True, export_apply=False)
    print('RIGGED', cfg['name'], 'bones', len(arm.data.bones), 'parts', len(parts), 'H', round(H, 3))


if __name__ == '__main__':
    main()
