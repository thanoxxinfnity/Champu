"""Meguna (Sukuna in Megumi's body) for the game, from kesaaaa2's "Shinjuku Showdown Megumi (Sukuna)" Unity package.

The package FBX is already rigged and weighted by its author (Hips/Spine/.../fingers, plus DyT_* dynamic bones on the haori hem,
sleeves, trouser hems, hood and hair). This script keeps that rig and only adapts it to the game:
  * outfit = Gi + Haori (the School uniform and Mahoraga wheel are dropped)
  * the inverted-hull outline faces (every "Material.00x" slot) are removed: half the triangles, and the game draws no outlines
  * the face/eye/jaw bones are folded into Head (their weights are added to Head) and leaf "_end" bones are removed,
    except the ones that end a DyT chain (they give the last cloth bone its tip)
  * body bones get the game's names (hips, upperarmL, index0L ...); each DyT chain becomes sway_<piece>_<n> for ClothSway
  * textures are taken from the package by the Unity material slots (prefab) and shrunk to 1024 px JPEG
  * materials are a Background shader so they export as KHR_materials_unlit (the source is flat anime shading)

Usage: blender -b -P prep_meguna.py -- "<package Assets folder>" out.glb [preview.png]
"""
import bpy, bmesh, sys, os, re, math
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = args[0], args[1]
PREVIEW = args[2] if len(args) > 2 else None
FBX = os.path.join(SRC, "Shinjuku Showdown Megumi (Sukuna).fbx")
TMP = os.path.join(os.path.dirname(os.path.abspath(OUT)), "_meguna_tex")
os.makedirs(TMP, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=FBX)

# (object, material slot) -> package texture; slots not listed are the outline shell
TEX = {("Body", 0): "Body", ("Hands", 0): "Body", ("Skin.002", 0): "Body", ("Skin.002", 1): "Face",
       ("Clothes", 0): "Feet", ("Clothes", 1): "Gi", ("Clothes", 2): "Pants",
       ("Haori", 0): "Haori", ("Hair", 0): "Hair", ("Eyes", 0): "Eyes", ("Eyes", 1): "Eyes"}
KEEP = {"Body", "Hands", "Skin.002", "Clothes", "Haori", "Hair", "Eyes"}
RENAME_MESH = {"Skin.002": "Head"}

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name not in KEEP or o.type not in ('MESH', 'ARMATURE'):
        bpy.data.objects.remove(o, do_unlink=True)

# ---- textures and materials -------------------------------------------------------------------------------------------
mats = {}
def material(tex):
    if tex in mats:
        return mats[tex]
    src = bpy.data.images.load(os.path.join(SRC, tex + ".png"))
    if max(src.size) > 1024:
        src.scale(1024, 1024)
    path = os.path.join(TMP, tex.lower() + ".jpg")
    src.filepath_raw = path
    src.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 88
    src.save_render(path)
    bpy.data.images.remove(src)
    img = bpy.data.images.load(path)
    m = bpy.data.materials.new("meguna_" + tex.lower())
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeBackground")    # Background -> KHR_materials_unlit
    ti = nt.nodes.new("ShaderNodeTexImage")
    ti.image = img
    nt.links.new(ti.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    mats[tex] = m
    return m

for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    keep_slots = [i for i in range(len(me.materials)) if (o.name, i) in TEX]
    gone = [f for f in bm.faces if f.material_index not in keep_slots]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    # one material per texture: remap slots
    new_slots = []
    remap = {}
    for i in keep_slots:
        t = TEX[(o.name, i)]
        if t not in new_slots:
            new_slots.append(t)
        remap[i] = new_slots.index(t)
    for f in bm.faces:
        f.material_index = remap[f.material_index]
    me.materials.clear()          # (clearing slots resets face indices, so it goes before the bmesh is written back)
    for t in new_slots:
        me.materials.append(material(t))
    bm.to_mesh(me)
    bm.free()
    o.name = RENAME_MESH.get(o.name, o.name)
    print("MESH", o.name, len(me.polygons), sum(len(p.vertices) - 2 for p in me.polygons), "tris", new_slots)

# ---- bones ------------------------------------------------------------------------------------------------------------
bones = arm.data.bones
def descendants(name):
    out, todo = [], [bones[name]]
    while todo:
        b = todo.pop()
        out.append(b.name)
        todo.extend(b.children)
    return out

fold_into_head = set(descendants("Face")) | set(descendants("Eye_L")) | set(descendants("Eye_R"))
fold_into_head |= {b.name for b in bones if b.name == "Ring"}
dyt_tips = {b.name for b in bones if b.name.endswith("_end") and b.parent and b.parent.name.startswith("DyT_")}
drop_leaf = {b.name for b in bones if b.name.endswith("_end") and b.name not in dyt_tips and b.name not in fold_into_head}

# weights of folded bones go to Head (or the parent for dropped leaves)
def merge_weights(src, dst):
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        g = o.vertex_groups.get(src)
        if g is None:
            continue
        d = o.vertex_groups.get(dst) or o.vertex_groups.new(name=dst)
        for v in o.data.vertices:
            for ge in v.groups:
                if ge.group == g.index and ge.weight > 0:
                    d.add([v.index], ge.weight, 'ADD')
        o.vertex_groups.remove(g)

parent_of = {b.name: (b.parent.name if b.parent else None) for b in bones}
for n in fold_into_head:
    merge_weights(n, "Head")
for n in drop_leaf:
    merge_weights(n, parent_of[n])

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
for n in fold_into_head | drop_leaf:
    if n in eb:
        eb.remove(eb[n])
bpy.ops.object.mode_set(mode='OBJECT')

MAIN = {"Hips": "hips", "Spine": "spine", "Chest": "chest", "Neck": "neck", "Head": "head"}
for side, s in (("Left", "L"), ("Right", "R")):
    MAIN.update({f"{side} shoulder": f"shoulder{s}", f"{side} arm": f"upperarm{s}", f"{side} elbow": f"forearm{s}",
                 f"{side} wrist": f"hand{s}", f"{side} leg": f"thigh{s}", f"{side} knee": f"shin{s}",
                 f"{side} ankle": f"foot{s}", f"{side} toe": f"toe{s}"})
    for j in range(3):
        MAIN[f"Thumb{j}_{s}"] = f"thumb{j}{s}"
    for src, dst in (("IndexFinger", "index"), ("MiddleFinger", "middle"), ("RingFinger", "ring"), ("LittleFinger", "pinky")):
        for j in range(3):
            MAIN[f"{src}{j + 1}_{s}"] = f"{dst}{j}{s}"

# cloth chains: a DyT root (or the two belt-tail chains BoneNNN under the spine) walked through single children
def chain_from(b):
    out = [b]
    while len(out[-1].children) == 1:
        out.append(out[-1].children[0])
    return out

chains = []
for b in bones:
    if b.name.startswith("DyT_") and not (b.parent and b.parent.name.startswith("DyT_")):
        chains.append(chain_from(b))
    elif re.fullmatch(r"Bone\d+", b.name) and not (b.parent and re.fullmatch(r"Bone\d+", b.parent.name)):
        chains.append(chain_from(b))
used = set()
for c in chains:
    root = c[0].name
    if root.startswith("DyT_"):
        key = re.sub(r"[^A-Za-z]", "", root[4:].replace(".merge", "m").rstrip("0123456789"))
    else:
        key = "belt"
    base, k = key, 2
    while key in used:
        key = f"{base}{k}"
        k += 1
    used.add(key)
    for j, cb in enumerate(c):
        MAIN[cb.name] = f"sway_{key}_{j}"

for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    for g in o.vertex_groups:
        if g.name in MAIN:
            g.name = MAIN[g.name]
for b in list(bones):
    if b.name in MAIN:
        b.name = MAIN[b.name]
print("BONES", len(bones), "chains", len(chains), sorted(u for u in used))

# ---- export -----------------------------------------------------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_skins=True, export_yup=True, export_animations=False,
                          export_image_format='JPEG', export_morph=False, use_selection=False)
print("WROTE", OUT, os.path.getsize(OUT))

if PREVIEW:
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = 500, 900
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.15, 0.18, 1)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.0
    cam.location = (0, -6, 0.95)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    sc.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
