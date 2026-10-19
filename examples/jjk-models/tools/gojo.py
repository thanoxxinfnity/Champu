"""Gojo Satoru-inspired fan model: tall, white spiky hair, black blindfold, dark high-collared Jujutsu-school uniform."""
import os, sys, math
sys.path.insert(0, os.path.dirname(__file__))
from base import *

HERE = os.path.dirname(os.path.dirname(__file__))
TEX = os.path.join(HERE, 'textures')


def t(n):
    return os.path.join(TEX, n)


def build(blindfold=True, out_dir=None, preview=None):
    reset()
    H = 1.90
    k = H / 1.80
    P = joints(H, shoulder=0.215, hip=0.100)
    # ── materials
    skin = principled('Skin', (0.93, 0.78, 0.69), 0.55, tex=t('skin.png'), sss=0.15)
    uniform = principled('Uniform', (0.1, 0.12, 0.22), 0.7, tex=t('uniform_navy.png'), normal=t('fabric_n.png'))
    pants = principled('Pants', (0.06, 0.06, 0.08), 0.75, tex=t('pants_black.png'), normal=t('fabric_n.png'))
    hairm = principled('Hair', (0.95, 0.96, 1.0), 0.45, tex=t('hair_white.png'))
    blind = principled('Blindfold', (0.03, 0.03, 0.04), 0.7, tex=t('blindfold.png'), normal=t('fabric_n.png'))
    gold = principled('GoldButton', (0.85, 0.65, 0.2), 0.3, metal=1.0)
    shoe = principled('Shoe', (0.05, 0.05, 0.06), 0.4)
    sole = principled('Sole', (0.85, 0.85, 0.85), 0.8)
    eyem = principled('Eye', (1, 1, 1), 0.2, tex=t('iris_blue.png'), emit=(0.35, 0.65, 1.0), emit_strength=0.8)
    white = principled('Sclera', (0.96, 0.96, 0.98), 0.25)
    lash = principled('Lash', (0.8, 0.82, 0.9), 0.6)
    mouthm = principled('Mouth', (0.45, 0.2, 0.2), 0.6)

    # ── body, armature, skinning
    body = body_mesh(P, bulk=1.12, shoulder_w=1.12)
    apply_modifiers(body)
    assign(body, skin)
    box_uv(body, 0.9)
    sway = {}
    cnt = 12
    chains = {}
    for i in range(cnt):
        a = i / cnt * math.tau
        pts = []
        for j in range(3):
            r = 0.17 + 0.03 * j
            z = (1.00 - 0.16 * j) * k
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r * 0.82, z)))
        chains[f'skirt{i}_'] = ([p for p in pts], 'hips')
    arm = build_armature(P, sway_chains=chains)
    # sway bones were named skirt{i}__1 etc. — rename to the pattern weight_skirt expects
    skin_to(body, arm)

    # ── head
    c = P['head'] + Vector((0, 0, 0.115 * k))
    c = c - Vector((0, 0, 0.012))
    head = sphere('Head', c, (0.106, 0.116, 0.127), skin, 32, 24)
    # chin: pull the lower front vertices down and forward
    bm = bmesh.new(); bm.from_mesh(head.data)
    for v in bm.verts:
        dz = (v.co.z) / 0.118
        if dz < -0.35 and v.co.y < 0:
            f = (-0.35 - dz) / 0.65
            v.co.z -= 0.034 * f
            v.co.y -= 0.02 * f
            v.co.x *= 1.0 - 0.28 * f
    bm.to_mesh(head.data); bm.free()
    smooth(head, 2, 0.4)
    box_uv(head, 0.4)
    ex = 0.037
    ey = -0.088
    ez = c.z + 0.008
    eyes = []
    for sx in (-1, 1):
        sc_ = sphere('EyeBall', (sx * ex, ey + 0.004, ez), (0.0215, 0.012, 0.0215), white, 20, 14)
        ir = bpy.data.objects.new('Iris', bpy.data.meshes.new('Iris'))
        bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, radius=0.0185, segments=24); bm.to_mesh(ir.data); bm.free()
        bpy.context.scene.collection.objects.link(ir)
        ir.location = (sx * ex, ey - 0.0095, ez)
        ir.rotation_euler = (math.radians(90), 0, 0)
        assign(ir, eyem)
        select_only(ir); bpy.ops.object.shade_smooth()
        uvs = ir.data.uv_layers.new(name='UV')
        for loop in ir.data.loops:
            co = ir.data.vertices[loop.vertex_index].co
            uvs.data[loop.index].uv = (0.5 + co.x / 0.037, 0.5 + co.y / 0.037)
        eyes += [sc_, ir]
        # upper lash line and brow
        eyes.append(stripe('Lash', Vector((sx * (ex - 0.026), ey - 0.012, ez + 0.022)), Vector((sx * (ex + 0.026), ey - 0.012, ez + 0.024)), 0.003, 0.003, lash))
        eyes.append(stripe('Brow', Vector((sx * (ex - 0.03), ey - 0.01, ez + 0.050)), Vector((sx * (ex + 0.032), ey - 0.008, ez + 0.057)), 0.004, 0.004, hairm))
    nose = cone('Nose', Vector((0, ey + 0.002, ez - 0.045)), Vector((0, ey - 0.026, ez - 0.062)), 0.011, skin, 8)
    mouth = stripe('Mouth', Vector((-0.024, ey - 0.003, ez - 0.092)), Vector((0.024, ey - 0.003, ez - 0.092)), 0.004, 0.003, mouthm)
    ears = [sphere('Ear', (sx * 0.098, -0.005, ez - 0.012), (0.012, 0.022, 0.032), skin, 12, 8) for sx in (-1, 1)]
    face_parts = join(eyes + [nose, mouth] + ears, 'Face')
    face_parts.data.materials.clear()
    # one multi-material object would be ideal; keep eyes/lash as separate objects instead
    # (join above merged materials by object order: the first object's material list is kept — rebuild per part below)
    bpy.data.objects.remove(face_parts, do_unlink=True)

    parts = []
    def keep(o, bone='head'):
        rigid_skin(o, arm, bone)
        parts.append(o)
        return o
    keep(head)
    for sx in (-1, 1):
        keep(sphere('EyeBall', (sx * ex, ey + 0.004, ez), (0.0215, 0.012, 0.0215), white, 20, 14))
        ir = bpy.data.objects.new('Iris', bpy.data.meshes.new('Iris'))
        bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, radius=0.0185, segments=24); bm.to_mesh(ir.data); bm.free()
        bpy.context.scene.collection.objects.link(ir)
        ir.location = (sx * ex, ey - 0.0095, ez)
        ir.rotation_euler = (math.radians(90), 0, 0)
        select_only(ir); bpy.ops.object.transform_apply(location=False, rotation=True, scale=False); bpy.ops.object.shade_smooth()
        assign(ir, eyem)
        uvs = ir.data.uv_layers.new(name='UV')
        for loop in ir.data.loops:
            co = ir.data.vertices[loop.vertex_index].co
            uvs.data[loop.index].uv = (0.5 + co.x / 0.037, 0.5 + co.z / 0.037 if abs(co.z) > 1e-6 else 0.5 + co.y / 0.037)
        keep(ir)
        keep(stripe('Lash', Vector((sx * (ex - 0.026), ey - 0.012, ez + 0.022)), Vector((sx * (ex + 0.026), ey - 0.012, ez + 0.024)), 0.003, 0.003, lash))
        keep(stripe('Brow', Vector((sx * (ex - 0.03), ey - 0.01, ez + 0.050)), Vector((sx * (ex + 0.032), ey - 0.008, ez + 0.057)), 0.004, 0.004, hairm))
        keep(sphere('Ear', (sx * 0.098, -0.005, ez - 0.012), (0.012, 0.022, 0.032), skin, 12, 8))
    keep(cone('Nose', Vector((0, ey + 0.002, ez - 0.045)), Vector((0, ey - 0.026, ez - 0.062)), 0.011, skin, 8))
    keep(stripe('Mouth', Vector((-0.024, ey - 0.003, ez - 0.092)), Vector((0.024, ey - 0.003, ez - 0.092)), 0.004, 0.003, mouthm))

    # ── hair: spikes over the skull, bangs forward
    spikes = []
    rng = __import__('random'); rng.seed(11)
    for i in range(260):
        th = rng.uniform(0.0, math.tau)
        ph = math.acos(rng.uniform(0.15, 1.0))          # 0 = top of head
        dirv = Vector((math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph)))
        if dirv.z < 0.15:
            continue
        base = c + Vector((dirv.x * 0.097, dirv.y * 0.105, dirv.z * 0.115))
        tilt = Vector((dirv.x * 0.9, dirv.y * 0.9 + 0.35, dirv.z * 1.25 + 0.25)).normalized()
        if dirv.y < -0.35 and dirv.z < 0.8:
            tilt = Vector((dirv.x * 0.8, -0.55, -0.1)).normalized()      # fringe falls forward over the forehead
        L = rng.uniform(0.07, 0.15) * (1.2 if dirv.z > 0.8 else 1.0)
        spikes.append(cone('Spike', base - tilt * 0.01, base + tilt * L, rng.uniform(0.014, 0.022), hairm, 6))
    # a scalp cap so no skin shows between the spikes
    cap = sphere('HairCap', c + Vector((0, 0.012, 0.012)), (0.113, 0.121, 0.132), hairm, 28, 18)
    bm = bmesh.new(); bm.from_mesh(cap.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.005 or (v.co.y < -0.035 and v.co.z < 0.045)], context='VERTS')
    bm.to_mesh(cap.data); bm.free()
    spikes.append(cap)
    hair = join(spikes, 'Hair')
    assign(hair, hairm)
    smart_uv(hair, 0.01)
    keep(hair)

    # ── blindfold (or open eyes)
    band = None
    if blindfold:
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=1.0, depth=1.0, location=(0, 0, ez + 0.005))
        band = bpy.context.object; band.name = 'Blindfold'
        band.scale = (0.104, 0.116, 0.036)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        # open top/bottom, thicken
        bm = bmesh.new(); bm.from_mesh(band.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.normal.z) > 0.9], context='FACES')
        bm.to_mesh(band.data); bm.free()
        solidify(band, 0.006, 1)
        assign(band, blind); box_uv(band, 0.3)
        select_only(band); bpy.ops.object.shade_smooth()
        keep(band)

    # ── clothes cut from the weighted body
    jacket = cut_region(body, 'Jacket', ('hips', 'spine', 'chest', 'shoulder', 'upperarm', 'forearm', 'neck'), 0.30, 0.014)
    # trim the jacket below the waist: remove vertices lower than the hip line
    bm = bmesh.new(); bm.from_mesh(jacket.data)
    low = [v for v in bm.verts if v.co.z < 0.93 * k]
    bmesh.ops.delete(bm, geom=low, context='VERTS')
    bm.to_mesh(jacket.data); bm.free()
    solidify(jacket, 0.008, 1)
    assign(jacket, uniform); box_uv(jacket, 0.55)
    pantsm = cut_region(body, 'Pants', ('hips', 'thigh', 'shin'), 0.5, 0.012)
    bm = bmesh.new(); bm.from_mesh(pantsm.data)
    high = [v for v in bm.verts if v.co.z > 1.0 * k]
    bmesh.ops.delete(bm, geom=high, context='VERTS')
    bm.to_mesh(pantsm.data); bm.free()
    solidify(pantsm, 0.008, 1)
    assign(pantsm, pants); box_uv(pantsm, 0.55)
    shoes = cut_region(body, 'Shoes', ('foot', 'toe'), 0.6, 0.016)
    solidify(shoes, 0.01, 1)
    assign(shoes, shoe); box_uv(shoes, 0.5)
    for o in (jacket, pantsm, shoes):
        o.modifiers.new('Armature', 'ARMATURE').object = arm
        o.parent = arm
        parts.append(o)
    # high collar
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.078, depth=0.075, location=(0, 0.004, 1.545 * k))
    collar = bpy.context.object; collar.name = 'Collar'
    bm = bmesh.new(); bm.from_mesh(collar.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.normal.z) > 0.9], context='FACES')
    front = [f for f in bm.faces if f.calc_center_median().y < -0.07 and abs(f.calc_center_median().x) < 0.012]
    bmesh.ops.delete(bm, geom=front, context='FACES')
    bm.to_mesh(collar.data); bm.free()
    solidify(collar, 0.012, 1)
    assign(collar, uniform); box_uv(collar, 0.4)
    select_only(collar); bpy.ops.object.shade_smooth()
    rigid_skin(collar, arm, 'neck'); parts.append(collar)
    # buttons down the front opening
    for i in range(5):
        z = (1.42 - i * 0.075) * k
        bt = sphere('Button', (0.0, -0.118 + (0.006 if i > 2 else 0.0), z), (0.0085, 0.006, 0.0085), gold, 12, 8)
        rigid_skin(bt, arm, 'chest' if i < 3 else 'spine'); parts.append(bt)
    # long jacket skirt on sway bones
    skirt = skirt_mesh('JacketSkirt', 1.03 * k, 0.68 * k, 0.178 * k, 0.205 * k, 24, 6)
    assign(skirt, uniform); box_uv(skirt, 0.55)
    weight_skirt(skirt, arm, 'skirt', cnt, 1.03 * k, 0.68 * k, 2)
    parts.append(skirt)
    # cleanup: the cut/bound body stays visible under the clothes (hands, neck, face skin)
    parts.append(body)

    # ── export
    out_dir = out_dir or os.path.join(HERE, 'models')
    os.makedirs(out_dir, exist_ok=True)
    name = 'gojo_blindfold' if blindfold else 'gojo_open_eyes'
    if preview:
        render_preview(preview, loc=(0, -6.2, 1.0), look=(0, 0, 0.98))
        render_preview(preview.replace('.png', '_face.png'), loc=(0, -1.6, 1.78 * k * 0.96), look=(0, 0, 1.76 * k * 0.97), w=700, h=700, fov=30)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, name + '.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, name + '.glb'), export_format='GLB', export_apply=False, export_skins=True, export_image_format='JPEG', export_jpeg_quality=88)
    print('EXPORTED', name, len(parts))
    if blindfold:
        pose_demo(arm, '/tmp/cm/jjk/gojo_pose.png', (0, -6.2, 1.0), (0, 0, 0.98))


if __name__ == '__main__':
    which = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'both'
    if which in ('both', 'blindfold'):
        build(True, preview='/tmp/cm/jjk/gojo.png')
    if which in ('both', 'open'):
        build(False, preview='/tmp/cm/jjk/gojo_open.png')
