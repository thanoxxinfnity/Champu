"""Shared humanoid builder for the Jujutsu-style fan models (run inside Blender: blender -b -P tools/make_all.py).

The body is grown from a stick figure with Blender's Skin modifier (per-joint radii) and smoothed with subdivision, so limbs, hands and
fingers come out organic and watertight. A matching armature (spine, neck, head, shoulders, arms, 5 fingers x 3 joints, legs, feet, toes,
plus optional extra arms and cloth-sway chains) is created and the body is skinned to it with automatic weights. Clothes are cut from the
weighted body (so they inherit the weights and deform with it), offset outward and given fabric materials.

Units are metres; the character faces -Y, Z is up (glTF export turns that into Y-up, facing +Z)."""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix, Euler

# ── scene helpers ────────────────────────────────────────────────────────────

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = 'METRIC'


def select_only(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def new_obj(name, mesh):
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def principled(name, color, rough=0.6, metal=0.0, tex=None, emit=None, emit_strength=0.0, alpha=None, normal=None, sss=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_strength
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(tex)
        t.image.colorspace_settings.name = 'sRGB'
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if normal:
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(normal)
        n.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if alpha is not None:
        m.blend_method = 'BLEND'
        b.inputs["Alpha"].default_value = alpha
    return m


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def smart_uv(obj, margin=0.02):
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def box_uv(obj, size=0.5):
    """World-scale cube projection: gives patterned cloth/skin a steady texel density with no unwrap seams to fight."""
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=size)
    bpy.ops.object.mode_set(mode='OBJECT')


# ── the stick figure ────────────────────────────────────────────────────────

def joints(H=1.80, shoulder=0.20, hip=0.095, arm_drop=0.0, bulk=1.0):
    """Joint positions for a figure H metres tall (A-pose arms). Returns {name: Vector}."""
    k = H / 1.80
    P = {}

    def v(x, y, z):
        return Vector((x * k, y * k, z * k))

    P['pelvis'] = v(0, 0, 0.96)
    P['spine'] = v(0, 0, 1.12)
    P['chest'] = v(0, 0, 1.30)
    P['neck'] = v(0, 0, 1.50)
    P['head'] = v(0, 0, 1.58)
    P['head_top'] = v(0, 0, 1.78)
    for side, sx in (('L', 1), ('R', -1)):
        P['shoulder' + side] = v(sx * 0.10, 0, 1.44)
        P['upperarm' + side] = v(sx * shoulder, 0.0, 1.43)
        P['forearm' + side] = v(sx * (shoulder + 0.18), 0.02, 1.17)
        P['hand' + side] = v(sx * (shoulder + 0.30), 0.05, 0.945)
        P['thigh' + side] = v(sx * hip, 0, 0.93)
        P['shin' + side] = v(sx * (hip + 0.01), -0.01, 0.50)
        P['foot' + side] = v(sx * (hip + 0.01), 0.0, 0.085)
        P['toe' + side] = v(sx * (hip + 0.01), -0.11, 0.035)
        P['toeEnd' + side] = v(sx * (hip + 0.01), -0.19, 0.03)
        # fingers: base on the hand, pointing along the forearm direction, slightly fanned
        base = P['hand' + side]
        fdir = (P['hand' + side] - P['forearm' + side]).normalized()
        side_axis = Vector((0, 1, 0)).cross(fdir).normalized() * (1 if sx > 0 else -1)
        lens = {'index': (0.040, 0.026, 0.020), 'middle': (0.044, 0.028, 0.021), 'ring': (0.040, 0.026, 0.019), 'pinky': (0.032, 0.020, 0.017)}
        offs = {'index': -0.026, 'middle': -0.008, 'ring': 0.010, 'pinky': 0.028}
        for name, ls in lens.items():
            p0 = base + fdir * 0.045 * k + Vector((0, 1, 0)) * offs[name] * k * (-1 if False else 1)
            # spread along the Y axis (front/back of the hand), curl a little toward the palm (-X toward body)
            cur = p0
            for j, L in enumerate(ls):
                curl = Vector((-sx * 0.0, 0.0, 0.0))
                nxt = cur + (fdir + Vector((-sx * 0.10 * j, 0.0, 0.0))).normalized() * L * k
                P[f'{name}{j}{side}'] = cur
                cur = nxt
            P[f'{name}3{side}'] = cur
        # thumb
        t0 = base + fdir * 0.015 * k + Vector((-sx * 0.012, -0.03, 0.0)) * k
        tdir = (fdir + Vector((-sx * 0.35, -0.6, 0.0))).normalized()
        cur = t0
        for j, L in enumerate((0.032, 0.028, 0.022)):
            P[f'thumb{j}{side}'] = cur
            cur = cur + tdir * L * k
            tdir = (tdir + fdir * 0.15).normalized()
        P['thumb3' + side] = cur
    return P


FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky']


def body_mesh(P, name='Body', bulk=1.0, extra_arms=None, shoulder_w=1.0):
    """Skin-modifier body from the joint graph. `extra_arms` is a list of (name, shoulder_pos, elbow, wrist) for a second pair of arms."""
    verts = []
    edges = []
    radii = []
    idx = {}

    def add(key, pos, r):
        idx[key] = len(verts)
        verts.append(pos.copy())
        radii.append(r)

    def link(a, b):
        edges.append((idx[a], idx[b]))

    b = bulk
    add('pelvis', P['pelvis'], (0.155 * b, 0.105 * b))
    add('spine', P['spine'], (0.145 * b, 0.098 * b))
    add('chest', P['chest'], (0.170 * b * shoulder_w, 0.108 * b))
    add('neck', P['neck'], (0.058, 0.056))
    add('head', P['head'], (0.050, 0.050))
    link('pelvis', 'spine'); link('spine', 'chest'); link('chest', 'neck'); link('neck', 'head')
    for s in ('L', 'R'):
        add('shoulder' + s, P['shoulder' + s] + Vector((0, 0, 0.0)), (0.060, 0.058))
        add('upperarm' + s, P['upperarm' + s], (0.058 * b, 0.056 * b))
        add('forearm' + s, P['forearm' + s], (0.046 * b, 0.044 * b))
        add('hand' + s, P['hand' + s], (0.040, 0.022))
        link('chest', 'shoulder' + s); link('shoulder' + s, 'upperarm' + s); link('upperarm' + s, 'forearm' + s); link('forearm' + s, 'hand' + s)
        for f in FINGERS:
            for j in range(4):
                r = (0.0118 - 0.0013 * j, 0.0104 - 0.0011 * j) if f != 'thumb' else (0.0138 - 0.0015 * j, 0.0122 - 0.0013 * j)
                add(f'{f}{j}{s}', P[f'{f}{j}{s}'], r)
                link(f'{f}{j}{s}', f'{f}{j-1}{s}' if j else 'hand' + s)
        add('thigh' + s, P['thigh' + s], (0.098 * b, 0.100 * b))
        add('shin' + s, P['shin' + s], (0.066 * b, 0.068 * b))
        add('foot' + s, P['foot' + s], (0.052, 0.058))
        add('toe' + s, P['toe' + s], (0.040, 0.034))
        add('toeEnd' + s, P['toeEnd' + s], (0.030, 0.020))
        link('pelvis', 'thigh' + s); link('thigh' + s, 'shin' + s); link('shin' + s, 'foot' + s); link('foot' + s, 'toe' + s); link('toe' + s, 'toeEnd' + s)
    for (nm, sh, el, wr) in (extra_arms or []):
        add(nm + '_sh', sh, (0.050 * b, 0.050 * b)); add(nm + '_el', el, (0.040 * b, 0.040 * b)); add(nm + '_wr', wr, (0.030, 0.022))
        link('chest', nm + '_sh'); link(nm + '_sh', nm + '_el'); link(nm + '_el', nm + '_wr')
        # a simple mitt hand for the extra arms: three finger stubs
        wdir = (wr - el).normalized()
        for i, off in enumerate((-0.016, 0.0, 0.016)):
            add(f'{nm}_f{i}', wr + wdir * 0.075 + Vector((0, off, 0)), (0.011, 0.010)); link(f'{nm}_wr', f'{nm}_f{i}')
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(p) for p in verts], edges, [])
    o = new_obj(name, mesh)
    sk = o.modifiers.new('Skin', 'SKIN')
    sk.branch_smoothing = 0.6
    sk.use_smooth_shade = True
    select_only(o)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.object.skin_root_mark()      # root = the active/selected vertex; set below
    bpy.ops.object.mode_set(mode='OBJECT')
    for i, r in enumerate(radii):
        mesh.skin_vertices[0].data[i].radius = r
    mesh.skin_vertices[0].data[0].use_root = True
    sub = o.modifiers.new('Subsurf', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2
    return o


def apply_modifiers(o):
    select_only(o)
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def build_armature(P, extra_arms=None, name='Armature', sway_chains=None):
    """Bones from the same joints. `sway_chains`: {chain_name: [positions...]} for cloth/hair secondary-motion bones."""
    arm = bpy.data.armatures.new(name)
    ob = new_obj(name, arm)
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones

    def bone(n, a, b, parent=None, connect=False):
        e = eb.new(n)
        e.head = a
        e.tail = b
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
        bone('shoulder' + s, P['chest'] + Vector((0, 0, 0.12)), P['upperarm' + s], 'chest')
        bone('upperarm' + s, P['upperarm' + s], P['forearm' + s], 'shoulder' + s, True)
        bone('forearm' + s, P['forearm' + s], P['hand' + s], 'upperarm' + s, True)
        bone('hand' + s, P['hand' + s], P['hand' + s] + (P['hand' + s] - P['forearm' + s]).normalized() * 0.07, 'forearm' + s, True)
        for f in FINGERS:
            prev = 'hand' + s
            for j in range(3):
                bone(f'{f}{j}{s}', P[f'{f}{j}{s}'], P[f'{f}{j+1}{s}'], prev, j > 0)
                prev = f'{f}{j}{s}'
        bone('thigh' + s, P['thigh' + s], P['shin' + s], 'hips')
        bone('shin' + s, P['shin' + s], P['foot' + s], 'thigh' + s, True)
        bone('foot' + s, P['foot' + s], P['toe' + s], 'shin' + s, True)
        bone('toe' + s, P['toe' + s], P['toeEnd' + s], 'foot' + s, True)
    for (nm, sh, el, wr) in (extra_arms or []):
        bone(nm + '_upper', sh, el, 'chest')
        bone(nm + '_fore', el, wr, nm + '_upper', True)
        bone(nm + '_hand', wr, wr + (wr - el).normalized() * 0.09, nm + '_fore', True)
    for cname, (points, parent) in (sway_chains or {}).items():
        prev = parent
        for i in range(1, len(points)):
            bone(f'{cname}{i}', points[i - 1], points[i], prev, False)
            prev = f'{cname}{i}'
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def skin_to(body, arm):
    select_only(body)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def rigid_skin(obj, arm, bone_name, others=None):
    """Bind a rigid part (hair, eyes, buttons) 100% to one bone through a vertex group + Armature modifier; exports as a normal skinned mesh."""
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
    m = obj.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    obj.parent = arm


def join(objs, name):
    select_only(objs[0])
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def sphere(name, loc, scale, mat=None, seg=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1.0, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    if mat:
        assign(o, mat)
    return o


def cone(name, base, tip, r, mat=None, verts=8, r_tip=0.0):
    """A cone/tapered spike from `base` to `tip` (Vectors)."""
    d = tip - base
    L = d.length
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r_tip, depth=L, location=(base + tip) * 0.5)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.shade_smooth()
    if mat:
        assign(o, mat)
    return o


def tube(name, p0, p1, r, mat=None, verts=10):
    return cone(name, p0, p1, r, mat, verts, r_tip=r)


def stripe(name, p0, p1, w, thick, mat=None):
    """A thin flat strip between two points (face/body markings)."""
    d = p1 - p0
    bpy.ops.mesh.primitive_cube_add(size=1, location=(p0 + p1) * 0.5)
    o = bpy.context.object
    o.name = name
    o.scale = (w, thick, d.length)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if mat:
        assign(o, mat)
    return o


def weight_skirt(obj, arm, chain_prefix, count, z_top, z_bottom, segs=2):
    """Weight a skirt-like mesh to `count` sway chains by angle around the Z axis and to the chain's segments by height."""
    names = {}
    for i in range(count):
        for j in range(1, segs + 1):
            n = f'{chain_prefix}{i}_{j}'
            names[(i, j)] = obj.vertex_groups.new(name=n)
    hips = obj.vertex_groups.new(name='hips')
    for v in obj.data.vertices:
        co = v.co
        ang = (math.atan2(co.y, co.x) + math.tau) % math.tau
        t = max(0.0, min(1.0, (z_top - co.z) / max(1e-4, z_top - z_bottom)))
        pos = ang / math.tau * count
        i0 = int(pos) % count
        i1 = (i0 + 1) % count
        f = pos - int(pos)
        seg = 1 + min(segs - 1, int(t * segs))
        wchain = t
        for i, wi in ((i0, 1 - f), (i1, f)):
            if wchain > 0.02:
                names[(i, seg)].add([v.index], wi * wchain, 'REPLACE')
        hips.add([v.index], 1.0 - wchain, 'REPLACE')
    m = obj.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    obj.parent = arm


def skirt_mesh(name, z_top, z_bottom, r_top, r_bottom, segs=24, rings=6, front_gap=0.0):
    bm = bmesh.new()
    rows = []
    for r in range(rings + 1):
        t = r / rings
        z = z_top + (z_bottom - z_top) * t
        rad = r_top + (r_bottom - r_top) * t
        row = []
        for s in range(segs):
            a = s / segs * math.tau
            row.append(bm.verts.new((math.cos(a) * rad * 1.0, math.sin(a) * rad * 0.82, z)))
        rows.append(row)
    for r in range(rings):
        for s in range(segs):
            a, b = rows[r][s], rows[r][(s + 1) % segs]
            c, d = rows[r + 1][(s + 1) % segs], rows[r + 1][s]
            bm.faces.new((a, b, c, d))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = new_obj(name, me)
    select_only(o)
    bpy.ops.object.shade_smooth()
    sol = o.modifiers.new('Solid', 'SOLIDIFY')
    sol.thickness = 0.008
    bpy.ops.object.modifier_apply(modifier=sol.name)
    return o


def render_preview(path, loc=(0, -5.2, 1.0), look=(0, 0, 0.95), w=700, h=1000, samples=48, light=4.0, fov=26):
    sc = bpy.context.scene
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    sc.collection.objects.link(cam)
    cam.location = loc
    cam.data.angle = math.radians(fov)
    cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    for (n, l, e, col) in (('Key', (2.5, -3.0, 4.0), light, (1, 0.97, 0.92)), ('Fill', (-3.0, -2.0, 2.0), light * 0.4, (0.8, 0.88, 1)), ('Rim', (0, 3.0, 3.0), light * 0.7, (1, 1, 1))):
        ld = bpy.data.lights.new(n, 'AREA')
        ld.energy = e * 220
        ld.size = 3.0
        ld.color = col
        lo = bpy.data.objects.new(n, ld)
        sc.collection.objects.link(lo)
        lo.location = l
        lo.rotation_euler = (Vector((0, 0, 1.0)) - Vector(l)).to_track_quat('-Z', 'Y').to_euler()
    w_ = bpy.data.worlds.new('W')
    w_.use_nodes = True
    w_.node_tree.nodes['Background'].inputs['Color'].default_value = (0.09, 0.10, 0.13, 1)
    w_.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    sc.world = w_
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
def group_weights(obj):
    """{vertex index: {group name: weight}} for the object's vertex groups."""
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        out.append({names[g.group]: g.weight for g in v.groups})
    return out


def cut_region(body, name, bone_prefixes, min_weight=0.5, push=0.012, exclude=()):
    """Duplicate `body`, keep only the faces whose vertices are mostly weighted to the given bones, push them outward (a garment)."""
    dup = body.copy()
    dup.data = body.data.copy()
    dup.name = name
    bpy.context.scene.collection.objects.link(dup)
    dup.modifiers.clear()          # the copy inherited the body's Armature modifier; the garment gets exactly one, added by the caller
    w = group_weights(dup)
    bm = bmesh.new()
    bm.from_mesh(dup.data)
    dl = bm.verts.layers.deform.verify()
    names = {g.index: g.name for g in dup.vertex_groups}

    def share(v):
        s = 0.0
        for gi, wt in v[dl].items():
            n = names[gi]
            if any(n.startswith(p) for p in bone_prefixes) and not any(n.startswith(e) for e in exclude):
                s += wt
        return s

    drop = [f for f in bm.faces if sum(share(v) for v in f.verts) / len(f.verts) < min_weight]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * push
    bm.to_mesh(dup.data)
    bm.free()
    return dup


def solidify(obj, thickness=0.006, offset=-1):
    m = obj.modifiers.new('Solid', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier=m.name)


def smooth(obj, iterations=2, factor=0.5):
    m = obj.modifiers.new('Smooth', 'SMOOTH')
    m.iterations = iterations
    m.factor = factor
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier=m.name)


def pose_demo(arm, path, loc, look, **kw):
    """Proves the rig: raise an arm, bend an elbow and a knee, close the fingers into a fist, then render."""
    select_only(arm)
    bpy.ops.object.mode_set(mode='POSE')
    pb = arm.pose.bones
    for b in pb:
        b.rotation_mode = 'XYZ'

    def rot(name, x=0.0, y=0.0, z=0.0):
        if name in pb:
            pb[name].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    rot('upperarmL', 0, 0, -75)
    rot('forearmL', 0, 0, -50)
    rot('upperarmR', 55, 0, 25)
    rot('forearmR', 70, 0, 0)
    for f in FINGERS:
        for j in range(3):
            rot(f'{f}{j}R', 70 if f != 'thumb' else 35, 0, 0)
    rot('thighL', 55, 0, 0)
    rot('shinL', -70, 0, 0)
    rot('spine', -8, 0, 0)
    rot('head', 0, 0, 10)
    bpy.ops.object.mode_set(mode='OBJECT')
    render_preview(path, loc=loc, look=look, **kw)
