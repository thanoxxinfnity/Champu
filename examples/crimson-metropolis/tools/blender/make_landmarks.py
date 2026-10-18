"""Builds the island's landmark models procedurally in Blender and exports one GLB each.
Run:  blender -b -P tools/blender/make_landmarks.py -- assets/island
Everything is made of beveled primitives with PBR colours, so no image generation (and no credits) is needed.
Models face +Z, stand on y=0 (Blender Z up, exported Y up) and are sized in metres."""
import bpy, bmesh, math, sys, os
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "assets/island"
os.makedirs(out, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.8, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 2.0
    return m


def box(name, size, loc, m, bevel=0.04, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        md = o.modifiers.new("b", 'BEVEL'); md.width = bevel; md.segments = 2
        bpy.ops.object.modifier_apply(modifier="b")
    o.data.materials.append(m)
    return o


def cyl(name, r1, r2, h, loc, m, verts=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    bpy.ops.object.shade_smooth()
    o.data.materials.append(m)
    return o


def export(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, name + ".glb"), export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    print("exported", name)


# ── materials ──
def palette():
    return dict(
        brick=mat("brick", (0.55, 0.28, 0.2), 0.9), stone=mat("stone", (0.6, 0.58, 0.54), 0.9),
        roof=mat("roof", (0.45, 0.16, 0.12), 0.7), white=mat("white", (0.93, 0.92, 0.88), 0.6),
        dark=mat("dark", (0.07, 0.07, 0.08), 0.5, 0.4), wood=mat("wood", (0.42, 0.28, 0.17), 0.85),
        metal=mat("metal", (0.55, 0.57, 0.6), 0.45, 0.8), rust=mat("rust", (0.45, 0.22, 0.12), 0.85, 0.3),
        glass=mat("glass", (0.25, 0.4, 0.5), 0.1, 0.1), red=mat("red", (0.7, 0.08, 0.08), 0.6),
        lamp=mat("lamp", (1, 0.85, 0.5), 0.3, 0, (1, 0.75, 0.3)),
    )


def clock_tower():
    reset(); p = palette()
    box("base", (7, 7, 14), (0, 0, 7), p["stone"], 0.12)
    box("belt", (7.6, 7.6, 0.6), (0, 0, 14.2), p["brick"], 0.08)
    box("clockbox", (6.2, 6.2, 6.5), (0, 0, 17.6), p["brick"], 0.1)
    for ang in range(4):
        a = ang * math.pi / 2
        d = Vector((math.sin(a), -math.cos(a), 0)) * 3.2
        for nm, r, m_, z in (("face", 2.4, p["white"], 17.6), ):
            c = cyl(nm, r, r, 0.2, (d.x, d.y, z), m_, 32, rot=(math.pi / 2, 0, a))
        for hl, rot_z in ((1.7, 0.4), (1.2, 2.2)):
            h = box("hand", (0.14, 0.1, hl), (d.x * 1.03, d.y * 1.03, 17.6), p["dark"], 0, rot=(0, 0, a))
            h.rotation_euler = (math.pi / 2 + rot_z * 0.0, rot_z, a)
    box("crown", (6.8, 6.8, 0.6), (0, 0, 21.2), p["stone"], 0.08)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=4.6, radius2=0.1, depth=6, location=(0, 0, 24.5), rotation=(0, 0, math.pi / 4))
    r = bpy.context.object; r.data.materials.append(p["roof"])
    cyl("spire", 0.12, 0.05, 3, (0, 0, 29), p["metal"], 8)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("pillar", (0.7, 0.7, 14), (sx * 3.3, sy * 3.3, 7), p["brick"], 0.05)
    export("clock_tower")


def windmill():
    reset(); p = palette()
    cyl("body", 3.2, 2.0, 11, (0, 0, 5.5), p["white"], 16)
    cyl("cap", 2.4, 0.2, 3.2, (0, 0, 12.6), p["roof"], 16)
    box("door", (1.1, 0.3, 2.2), (0, -2.9, 1.1), p["wood"], 0.03)
    for z in (4, 7.5):
        box("win", (0.7, 0.2, 1.0), (0, -2.35 + (7.5 - z) * 0.03, z), p["dark"], 0.02)
    cyl("hub", 0.5, 0.5, 1.2, (0, -3.0, 11.2), p["dark"], 12, rot=(math.pi / 2, 0, 0))
    blades = []
    for i in range(4):
        a = i * math.pi / 2
        b = box("blade", (0.7, 0.15, 8.5), (0, -3.6, 11.2), p["wood"], 0.02)
        b.location = (math.sin(a) * 4.5, -3.6, 11.2 + math.cos(a) * 4.5)
        b.rotation_euler = (0, a, 0)
        sail = box("sail", (2.2, 0.08, 6.4), (0, -3.7, 11.2), p["white"], 0.0)
        sail.location = (math.sin(a) * 4.9 + math.cos(a) * 1.2, -3.7, 11.2 + math.cos(a) * 4.9 - math.sin(a) * 1.2)
        sail.rotation_euler = (0, a, 0)
        blades += [b, sail]
    # Join the blades and hub into one object named Blades so the game can spin it.
    bpy.ops.object.select_all(action='DESELECT')
    for o in blades + [bpy.data.objects["hub"]]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = blades[0]
    bpy.ops.object.join()
    bpy.context.object.name = "Blades"
    # keep the mesh in model space (origin at 0,0,0); the game spins it round the hub, which is at (0, 11.2, 3.6) in Godot axes
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    export("windmill")


def factory():
    reset(); p = palette()
    box("hall", (30, 18, 9), (0, 0, 4.5), p["brick"], 0.1)
    for i in range(4):
        x = -11.25 + i * 7.5
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0, 9.6))
        s = bpy.context.object
        s.scale = (7.5, 18, 1.8)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        s.data.materials.append(p["metal"])
        s.rotation_euler = (0, math.radians(-14), 0)
        box("skylight", (0.15, 16, 1.6), (x + 3.6, 0, 10.2), p["glass"], 0)
    for x in (-8, 8):
        box("door", (4, 0.3, 5), (x, -9.1, 2.5), p["metal"], 0.05)
    for x in (-3, 3):
        box("win", (2.0, 0.2, 1.4), (x, -9.05, 5.8), p["glass"], 0.04)
    for x, h in ((13, 26), (16, 22)):
        cyl("chimney", 1.4, 0.9, h, (x, 6, h / 2), p["brick"], 20)
        cyl("band", 1.45, 1.45, 0.5, (x, 6, h - 1.0), p["white"], 20)
    box("tank", (6, 6, 8), (-16, 7, 4), p["rust"], 0.1)
    cyl("pipe", 0.45, 0.45, 16, (-8, 9.3, 7.5), p["metal"], 12, rot=(0, math.pi / 2, 0))
    export("factory")


def container(name, color):
    reset(); p = palette()
    m = mat(name + "_m", color, 0.55, 0.25)
    box("shell", (6.06, 2.44, 2.59), (0, 0, 1.3), m, 0.03)
    for i in range(-5, 6):
        box("rib", (0.08, 2.5, 2.5), (i * 0.55, 0, 1.3), m, 0.0)
    box("door", (0.1, 2.3, 2.4), (3.04, 0, 1.3), p["metal"], 0.02)
    export(name)


def hut():
    reset(); p = palette()
    box("floor", (5.4, 4.6, 0.5), (0, 0, 0.55), p["wood"], 0.03)
    box("walls", (5, 4.2, 2.6), (0, 0, 2.0), p["wood"], 0.06)
    for sx in (-2.4, 2.4):
        for sy in (-2.0, 2.0):
            box("post", (0.3, 0.3, 1.0), (sx, sy, 0.3), p["stone"], 0.02)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=4.3, radius2=0.2, depth=2.2, location=(0, 0, 4.4), rotation=(0, 0, math.pi / 4))
    r = bpy.context.object; r.scale = (1.0, 0.85, 1.0); r.data.materials.append(p["roof"])
    box("door", (1.1, 0.12, 2.0), (0, -2.12, 1.8), p["dark"], 0.02)
    box("steps", (1.6, 0.8, 0.3), (0, -2.8, 0.2), p["wood"], 0.02)
    for x in (-1.6, 1.6):
        box("win", (0.9, 0.12, 0.9), (x, -2.12, 2.3), p["glass"], 0.02)
        box("frame", (1.1, 0.14, 1.1), (x, -2.1, 2.3), p["white"], 0.0)
    box("chimney", (0.7, 0.7, 2), (1.6, 0.8, 5.0), p["stone"], 0.03)
    export("hut")


def watchtower():
    reset(); p = palette()
    for sx in (-1, 1):
        for sy in (-1, 1):
            b = box("leg", (0.35, 0.35, 11), (sx * 1.7, sy * 1.7, 5.5), p["wood"], 0.02)
            b.rotation_euler = (sy * 0.04, -sx * 0.04, 0)
    for z in (3, 6, 9):
        for ax in (0, 1):
            box("brace", (3.4, 0.2, 0.2) if ax == 0 else (0.2, 3.4, 0.2), (0, 1.7 if ax == 0 else 0, z), p["wood"], 0)
            box("brace", (3.4, 0.2, 0.2) if ax == 0 else (0.2, 3.4, 0.2), (0, -1.7 if ax == 0 else 0, z), p["wood"], 0)
    box("deck", (4.2, 4.2, 0.3), (0, 0, 11.1), p["wood"], 0.02)
    for s in (-1, 1):
        box("rail", (4.2, 0.12, 1.0), (0, s * 2.05, 11.8), p["wood"], 0)
        box("rail", (0.12, 4.2, 1.0), (s * 2.05, 0, 11.8), p["wood"], 0)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=3.6, radius2=0.1, depth=2.2, location=(0, 0, 14.1), rotation=(0, 0, math.pi / 4))
    bpy.context.object.data.materials.append(p["roof"])
    for sx in (-1.9, 1.9):
        for sy in (-1.9, 1.9):
            box("rpost", (0.2, 0.2, 2.6), (sx, sy, 12.6), p["wood"], 0)
    export("watchtower")


def lighthouse():
    reset(); p = palette()
    for i, z in enumerate((0, 4, 8, 12)):
        cyl("seg", 3.0 - i * 0.35, 2.65 - i * 0.35, 4, (0, 0, z + 2), p["white"] if i % 2 == 0 else p["red"], 24)
    cyl("gallery", 2.4, 2.4, 0.4, (0, 0, 16.2), p["dark"], 24)
    cyl("lantern", 1.3, 1.3, 2.4, (0, 0, 17.6), p["lamp"], 20)
    cyl("cap", 1.7, 0.1, 1.8, (0, 0, 19.7), p["red"], 20)
    box("door", (1.0, 0.3, 2.0), (0, -3.0, 1.0), p["wood"], 0.03)
    export("lighthouse")


clock_tower(); windmill(); factory()
container("container_blue", (0.1, 0.25, 0.55)); container("container_orange", (0.85, 0.4, 0.1)); container("container_green", (0.15, 0.4, 0.25))
hut(); watchtower(); lighthouse()
