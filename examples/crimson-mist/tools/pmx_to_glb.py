"""PMX -> game-ready GLB in Blender (own importer, no add-on needed).
    blender -b -P tools/pmx_to_glb.py -- model.pmx out.glb [preview.png]
Simplifies the 300-550 bone MMD rig to ~40 core bones (humanoid names) + thinned sway chains (hair, coat, bag),
drops overlay/tear materials, downsizes textures to 1024, exports GLB with skinning."""
import math, os, re, sys
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmx

SCALE = 0.08
argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
preview = argv[2] if len(argv) > 2 else None
base = os.path.dirname(src)
m = pmx.load(src)
B = m['bones']

FINGERS = {'親指': 'Thumb', '人指': 'Index', '中指': 'Middle', '薬指': 'Ring', '小指': 'Little'}
CORE = {'全ての親': 'Root', 'master': 'Root', '腰': 'Hips', '下半身': 'Pelvis', '上半身': 'Spine', '上半身2': 'Chest', '首': 'Neck', '頭': 'Head'}
for jp, en in (('肩', 'Shoulder'), ('腕', 'UpperArm'), ('ひじ', 'LowerArm'), ('手首', 'Hand')):
    for side, s in (('左', 'L'), ('右', 'R')):
        CORE[side + jp] = f'{en}.{s}'
for side, s in (('左', 'L'), ('右', 'R')):
    for pre in ('', 'D'):  # the "D" bones carry the leg skin weights
        CORE.setdefault(f'{side}足{pre}', f'UpperLeg.{s}')
        CORE.setdefault(f'{side}ひざ{pre}', f'LowerLeg.{s}')
        CORE.setdefault(f'{side}足首{pre}', f'Foot.{s}')
    CORE[f'{side}つま先'] = f'Toes.{s}'
    for jp, en in FINGERS.items():
        for n in range(4):
            CORE[f'{side}{jp}{"０１２３"[n]}'] = f'{en}{n}.{s}'
            CORE[f'{side}{jp}{n}'] = f'{en}{n}.{s}'
# prefer the D (deform) leg bones when both exist
used = {}
for v in m['verts']:
    for j, w in zip(v[3], v[4]):
        if w > 0.001 and j >= 0:
            used[j] = used.get(j, 0) + 1
names = {}
for i, b in enumerate(B):
    jp = b['name']
    if jp in CORE:
        if CORE[jp] in names.values():  # duplicate target: keep whichever carries weights
            other = [k for k, v in names.items() if v == CORE[jp]][0]
            if used.get(i, 0) > used.get(other, 0):
                del names[other]
            else:
                continue
        names[i] = CORE[jp]
MERGE = re.compile(r'舌|歯|目|捩|補助|ダミー|手先|胸|握|拡|IK|Tongue|Eye')


def parent_chain(i):
    while i >= 0:
        yield i
        i = B[i]['parent']


kept = dict(names)
depth = {}
for i in sorted(used):
    if i in kept or MERGE.search(B[i]['name'] + B[i]['en']):
        continue
    d, p = 0, B[i]['parent']
    while p >= 0 and p not in kept and p not in names and p in depth and False:
        break
    # chain depth = number of non-core ancestors
    d = 0
    p = B[i]['parent']
    while p >= 0 and p not in names and not (p in used and MERGE.search(B[p]['name'] + B[p]['en'])):
        d += 1
        p = B[p]['parent']
    depth[i] = d
    if d % 3 == 0:
        kept[i] = re.sub(r'[^A-Za-z0-9_.]', '_', B[i]['en'] or '') or f'sway{i}'
        kept[i] = f'sway_{i}'


def target(i):
    """kept bone that receives the weights of bone i"""
    for p in parent_chain(i):
        if p in kept:
            return p
    return None


# --- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
verts = m['verts']
faces = m['faces']
mats = m['materials']
DROP = re.compile(r'tears|Ex$|Layers|hairshadow|cheek', re.I)
tri_mat, o = [], 0
for mi, mt in enumerate(mats):
    n = mt['count'] // 3
    tri_mat += [mi] * n
tris = [(faces[i * 3], faces[i * 3 + 2], faces[i * 3 + 1]) for i in range(len(faces) // 3)]  # y/z swap flips winding
keep_tri = [i for i, t in enumerate(tris) if not DROP.search(mats[tri_mat[i]]['name'])]
co = [Vector((v[0][0] * SCALE, v[0][2] * SCALE, v[0][1] * SCALE)) for v in verts]
uvs = [(v[2][0], 1 - v[2][1]) for v in verts]
mesh = bpy.data.meshes.new('body')
mesh.from_pydata(co, [], [tris[i] for i in keep_tri])
mesh.update()
uvl = mesh.uv_layers.new(name='UV')
for li, loop in enumerate(mesh.loops):
    uvl.data[li].uv = uvs[loop.vertex_index]
obj = bpy.data.objects.new(os.path.splitext(os.path.basename(dst))[0], mesh)
bpy.context.scene.collection.objects.link(obj)

# materials
slot = {}
for mi in sorted({tri_mat[i] for i in keep_tri}):
    mt = mats[mi]
    ma = bpy.data.materials.new(re.sub(r'[^A-Za-z0-9_]', '_', mt['name']) or f'm{mi}')
    ma.use_nodes = True
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (mt['diffuse'][0], mt['diffuse'][1], mt['diffuse'][2], 1)
    bsdf.inputs['Roughness'].default_value = 0.8
    ti = mt['tex']
    if 0 <= ti < len(m['textures']):
        p = os.path.join(base, m['textures'][ti].replace('\\', '/'))
        if os.path.exists(p):
            img = bpy.data.images.load(p)
            if max(img.size) > 1024:
                k = 1024 / max(img.size)
                img.scale(int(img.size[0] * k), int(img.size[1] * k))
            tex = ma.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = img
            ma.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            if re.search(r'hair|lash|brow|eye|mouth|glass|lens|tooth|teeth|crease|circle|star|heart', mt['name'], re.I) or mt['diffuse'][3] < 0.99:
                ma.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
                ma.blend_method = 'HASHED'
    if mt['diffuse'][3] < 0.99:
        bsdf.inputs['Alpha'].default_value = mt['diffuse'][3]
    obj.data.materials.append(ma)
    slot[mi] = len(obj.data.materials) - 1
for pi, ti in enumerate(keep_tri):
    mesh.polygons[pi].material_index = slot[tri_mat[ti]]
mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))

# armature (edit mode)
arm = bpy.data.armatures.new('Armature')
rig = bpy.data.objects.new('Armature', arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
kids = {}
for i in kept:
    p = target(B[i]['parent']) if B[i]['parent'] >= 0 else None
    kids.setdefault(p, []).append(i)
eb = {}
for i in sorted(kept, key=lambda k: len(list(parent_chain(k)))):
    b = arm.edit_bones.new(kept[i])
    head = Vector((B[i]['pos'][0], B[i]['pos'][2], B[i]['pos'][1])) * SCALE
    ch = kids.get(i, [])
    if ch:
        tp = Vector((B[ch[0]]['pos'][0], B[ch[0]]['pos'][2], B[ch[0]]['pos'][1])) * SCALE
    elif isinstance(B[i]['tail'], int) and B[i]['tail'] >= 0:
        t = B[B[i]['tail']]['pos']
        tp = Vector((t[0], t[2], t[1])) * SCALE
    else:
        tp = head + Vector((0, 0, -0.03))
    if (tp - head).length < 0.01:
        tp = head + Vector((0, 0, 0.02))
    b.head, b.tail = head, tp
    eb[i] = b
for i, b in eb.items():
    p = target(B[i]['parent']) if B[i]['parent'] >= 0 else None
    if p is not None and p in eb:
        b.parent = eb[p]
bpy.ops.object.mode_set(mode='OBJECT')

# weights
for i in kept:
    obj.vertex_groups.new(name=kept[i])
for vi, v in enumerate(verts):
    acc = {}
    for j, w in zip(v[3], v[4]):
        if w > 0.001 and j >= 0:
            t = target(j)
            if t is not None:
                acc[t] = acc.get(t, 0) + w
    top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
    s = sum(w for _, w in top) or 1
    for t, w in top:
        obj.vertex_groups[kept[t]].add([vi], w / s, 'REPLACE')
obj.parent = rig
mod = obj.modifiers.new('Armature', 'ARMATURE')
mod.object = rig
print('BONES', len(kept), 'of', len(B), 'TRIS', len(keep_tri), 'MATS', len(obj.data.materials))

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='AUTO', export_yup=True,
                          export_skins=True, export_materials='EXPORT', export_apply=False)
print('SAVED', dst, os.path.getsize(dst) // 1024, 'KB')

if preview:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 12
    sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 600, 800
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.82, 0.9, 1)
    sc.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    for k, (yaw, name) in enumerate(((0, 'front'), (180, 'back'))):
        d = 4.2
        cam.location = (math.sin(math.radians(yaw)) * -d, math.cos(math.radians(yaw)) * -d, 0.85)
        look = Vector((0, 0, 0.8)) - cam.location
        cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = preview.replace('.png', f'_{name}.png')
        bpy.ops.render.render(write_still=True)
