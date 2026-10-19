"""Ryomen Sukuna-inspired fan model: tall and broad, pink swept-back hair, black face/body markings, two pairs of red eyes,
two pairs of arms, an open pale kimono with a dark sash and a long skirt."""
import os, sys, math
sys.path.insert(0, os.path.dirname(__file__))
from base import *

HERE = os.path.dirname(os.path.dirname(__file__))
TEX = os.path.join(HERE, 'textures')


def t(n):
    return os.path.join(TEX, n)


def build(out_dir=None, preview=None):
    reset()
    H = 2.0
    k = H / 1.80
    P = joints(H, shoulder=0.245, hip=0.108)
    skin = principled('Skin', (0.89, 0.72, 0.63), 0.55, tex=t('skin_sukuna.png'), sss=0.12)
    kim = principled('Kimono', (0.9, 0.89, 0.87), 0.8, tex=t('kimono.png'), normal=t('fabric_n.png'))
    sash = principled('Sash', (0.08, 0.07, 0.09), 0.7, tex=t('sash_black.png'), normal=t('fabric_n.png'))
    hairm = principled('Hair', (0.95, 0.45, 0.6), 0.45, tex=t('hair_pink.png'))
    ink = principled('Ink', (0.02, 0.015, 0.02), 0.5)
    eyem = principled('Eye', (1, 1, 1), 0.2, tex=t('iris_red.png'), emit=(1.0, 0.1, 0.1), emit_strength=1.4)
    white = principled('Sclera', (0.12, 0.02, 0.02), 0.25)       # Sukuna's sclera is dark
    mouthm = principled('Mouth', (0.3, 0.05, 0.07), 0.5)
    teeth = principled('Teeth', (0.95, 0.93, 0.85), 0.4)
    sandal = principled('Sandal', (0.12, 0.08, 0.06), 0.6)

    extra = [('armL2', Vector((0.17, 0.0, 1.30)) * k, Vector((0.29, -0.06, 1.10)) * k, Vector((0.25, -0.15, 0.97)) * k),
             ('armR2', Vector((-0.17, 0.0, 1.30)) * k, Vector((-0.29, -0.06, 1.10)) * k, Vector((-0.25, -0.15, 0.97)) * k)]
    body = body_mesh(P, bulk=1.2, shoulder_w=1.18, extra_arms=extra)
    apply_modifiers(body)
    assign(body, skin); box_uv(body, 0.9)
    cnt = 14
    chains = {}
    for i in range(cnt):
        a = i / cnt * math.tau
        pts = []
        for j in range(4):
            r = 0.19 + 0.045 * j
            z = (1.00 - 0.22 * j) * k
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r * 0.85, z)))
        chains[f'skirt{i}_'] = (pts, 'hips')
    arm = build_armature(P, extra_arms=extra, sway_chains=chains)
    skin_to(body, arm)
    parts = [body]

    def keep(o, bone='head'):
        rigid_skin(o, arm, bone)
        parts.append(o)
        return o

    # head
    c = P['head'] + Vector((0, 0, 0.11 * k)) - Vector((0, 0, 0.012))
    head = sphere('Head', c, (0.108, 0.118, 0.13), skin, 32, 24)
    bm = bmesh.new(); bm.from_mesh(head.data)
    for v in bm.verts:
        dz = v.co.z / 0.13
        if dz < -0.3 and v.co.y < 0:
            f = (-0.3 - dz) / 0.7
            v.co.z -= 0.04 * f; v.co.y -= 0.024 * f; v.co.x *= 1.0 - 0.3 * f
    bm.to_mesh(head.data); bm.free()
    smooth(head, 2, 0.4); box_uv(head, 0.4)
    keep(head)
    ey = -0.092
    ez = c.z + 0.012
    for sx in (-1, 1):
        for row, (dz_, sc, off) in enumerate(((0.0, 1.0, 0.040), (-0.052, 0.9, 0.042))):
            keep(sphere('EyeBall', (sx * off, ey + 0.004, ez + dz_), (0.021 * sc, 0.012, 0.0175 * sc), white, 18, 12))
            ir = bpy.data.objects.new('Iris', bpy.data.meshes.new('Iris'))
            bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, radius=0.0165 * sc, segments=24); bm.to_mesh(ir.data); bm.free()
            bpy.context.scene.collection.objects.link(ir)
            ir.location = (sx * off, ey - 0.0095, ez + dz_)
            ir.rotation_euler = (math.radians(90), 0, 0)
            select_only(ir); bpy.ops.object.transform_apply(location=False, rotation=True, scale=False); bpy.ops.object.shade_smooth()
            assign(ir, eyem)
            uvs = ir.data.uv_layers.new(name='UV')
            for loop in ir.data.loops:
                co = ir.data.vertices[loop.vertex_index].co
                uvs.data[loop.index].uv = (0.5 + co.x / (0.033 * sc), 0.5 + co.z / (0.033 * sc))
            keep(ir)
        keep(stripe('Brow', Vector((sx * 0.012, ey - 0.012, ez + 0.040)), Vector((sx * 0.072, ey - 0.002, ez + 0.056)), 0.008, 0.006, ink))
        keep(sphere('Ear', (sx * 0.108, -0.005, ez - 0.015), (0.012, 0.024, 0.036), skin, 12, 8))
        # cheek markings under the eyes
        keep(stripe('Mark', Vector((sx * 0.018, ey - 0.006, ez - 0.092)), Vector((sx * 0.082, ey + 0.02, ez - 0.08)), 0.012, 0.004, ink))
        keep(stripe('Mark', Vector((sx * 0.018, ey - 0.003, ez - 0.108)), Vector((sx * 0.074, ey + 0.026, ez - 0.098)), 0.012, 0.004, ink))
    keep(cone('Nose', Vector((0, ey + 0.002, ez - 0.05)), Vector((0, ey - 0.026, ez - 0.066)), 0.0115, skin, 8))
    keep(stripe('Mouth', Vector((-0.03, ey - 0.002, ez - 0.128)), Vector((0.03, ey - 0.002, ez - 0.128)), 0.005, 0.003, mouthm))
    keep(stripe('ChinMark', Vector((0, ey + 0.006, ez - 0.14)), Vector((0, ey + 0.012, ez - 0.17)), 0.012, 0.004, ink))
    keep(stripe('ForeheadMark', Vector((0, ey + 0.008, ez + 0.075)), Vector((0, ey + 0.002, ez + 0.1)), 0.01, 0.004, ink))

    # hair: pink spikes swept up and back with a shaved-looking side
    import random
    rng = random.Random(21)
    spikes = []
    for i in range(230):
        th = rng.uniform(0.0, math.tau)
        ph = math.acos(rng.uniform(0.2, 1.0))
        d = Vector((math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph)))
        if d.z < 0.2:
            continue
        base = c + Vector((d.x * 0.105, d.y * 0.115, d.z * 0.125))
        tilt = Vector((d.x * 0.55, d.y * 0.6 + 0.65, d.z * 0.9 + 0.2)).normalized()        # swept back
        L = rng.uniform(0.05, 0.13) * (1.3 if d.z > 0.7 else 0.8)
        spikes.append(cone('Spike', base - tilt * 0.01, base + tilt * L, rng.uniform(0.013, 0.021), hairm, 6))
    cap = sphere('HairCap', c + Vector((0, 0.012, 0.014)), (0.113, 0.122, 0.134), hairm, 28, 18)
    bm = bmesh.new(); bm.from_mesh(cap.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.015 or (v.co.y < -0.04 and v.co.z < 0.05)], context='VERTS')
    bm.to_mesh(cap.data); bm.free()
    spikes.append(cap)
    hair = join(spikes, 'Hair'); assign(hair, hairm); smart_uv(hair, 0.01); keep(hair)

    # kimono: upper garment cut from the weighted body (open at the chest, wide sleeves), a sash and a long skirt
    top = cut_region(body, 'KimonoTop', ('hips', 'spine', 'chest', 'shoulder', 'upperarm', 'forearm', 'neck'), 0.30, 0.026)
    bm = bmesh.new(); bm.from_mesh(top.data)
    low = [v for v in bm.verts if v.co.z < 0.93 * k]
    chest_open = [f for f in bm.faces if f.calc_center_median().y < -0.02 and abs(f.calc_center_median().x) < 0.085 and 1.0 * k < f.calc_center_median().z < 1.52 * k]
    bmesh.ops.delete(bm, geom=chest_open, context='FACES')
    bmesh.ops.delete(bm, geom=low, context='VERTS')
    bm.to_mesh(top.data); bm.free()
    for o in (top,):
        solidify(o, 0.008, 1); assign(o, kim); box_uv(o, 0.55)
        o.modifiers.new('Armature', 'ARMATURE').object = arm
        o.parent = arm
        parts.append(o)
    skirt = skirt_mesh('Skirt', 1.02 * k, 0.16 * k, 0.185 * k, 0.40 * k, 28, 8)
    assign(skirt, kim); box_uv(skirt, 0.6)
    weight_skirt(skirt, arm, 'skirt', cnt, 1.02 * k, 0.16 * k, 3)
    parts.append(skirt)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.175 * k, minor_radius=0.045, major_segments=40, minor_segments=12, location=(0, 0, 1.02 * k))
    belt = bpy.context.object; belt.name = 'Sash'; belt.scale = (1.0, 0.85, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(belt, sash); box_uv(belt, 0.4); select_only(belt); bpy.ops.object.shade_smooth()
    rigid_skin(belt, arm, 'hips'); parts.append(belt)
    # collar edge trim and a second mouth on the stomach
    mouth2 = sphere('StomachMouth', (0, -0.115 * 1.0, 1.12 * k), (0.045, 0.008, 0.022), mouthm, 16, 10)
    keep(mouth2, 'spine')
    keep(stripe('Teeth', Vector((-0.04, -0.12, 1.12 * k + 0.004)), Vector((0.04, -0.12, 1.12 * k + 0.004)), 0.004, 0.002, teeth), 'spine')

    # markings: bands round the arms, diagonal lines over the chest and abdomen
    for s, sx in (('L', 1), ('R', -1)):
        for z0, bone_ in ((0.62, 'upperarm'), (0.40, 'forearm')):
            a = P['upperarm' + s]; b = P['forearm' + s]
            tpos = a.lerp(b, 0.4 + 0.2 * (z0 < 0.5)) if bone_ == 'upperarm' else P['forearm' + s].lerp(P['hand' + s], 0.45)
            ring = cone('Band', tpos - Vector((0, 0, 0.012)), tpos + Vector((0, 0, 0.012)), 0.056 * 1.25 if bone_ == 'upperarm' else 0.049 * 1.25, ink, 24, r_tip=0.056 * 1.25 if bone_ == 'upperarm' else 0.049 * 1.25)
            keep(ring, bone_ + s)
        keep(stripe('ChestLine', Vector((sx * 0.02, -0.12, 1.38 * k)), Vector((sx * 0.13, -0.095, 1.28 * k)), 0.014, 0.004, ink), 'chest')
        keep(stripe('ChestLine', Vector((sx * 0.02, -0.125, 1.30 * k)), Vector((sx * 0.12, -0.10, 1.22 * k)), 0.014, 0.004, ink), 'chest')
    out_dir = out_dir or os.path.join(HERE, 'models')
    os.makedirs(out_dir, exist_ok=True)
    if preview:
        render_preview(preview, loc=(0, -6.6, 1.05), look=(0, 0, 1.02))
        render_preview(preview.replace('.png', '_face.png'), loc=(0, -1.7, 1.95 * 0.96), look=(0, 0, 1.92 * 0.97), w=700, h=700, fov=30)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, 'sukuna.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, 'sukuna.glb'), export_format='GLB', export_skins=True, export_image_format='JPEG', export_jpeg_quality=88)
    print('EXPORTED sukuna', len(parts))
    pose_demo(arm, '/tmp/cm/jjk/sukuna_pose.png', (0, -6.6, 1.05), (0, 0, 1.02))


if __name__ == '__main__':
    build(preview='/tmp/cm/jjk/sukuna.png')
