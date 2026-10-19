"""Render GTA-loading-screen style key art from the rigged character models.

    blender -b -P tools/poster_render.py -- out_dir

Six shots (hero Gojo, hero Sukuna, face-off, two face close-ups, wide low-angle). Characters are posed through their armature (arms
raised, stance, leaning). Each frame is rendered with a warm/cool two-colour rim light and a flat coloured background, then
tools/poster_grade.py gives it the poster treatment (posterise, halftone, tint, border)."""
import bpy, sys, os, math
from mathutils import Vector, Euler

out_dir = sys.argv[sys.argv.index('--') + 1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(out_dir, exist_ok=True)
FILES = {'gojo': 'models/gojo_whole.glb', 'sukuna': 'models/sukuna_FINAL.glb'}


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'BLENDER_EEVEE_NEXT'
    s.render.resolution_x, s.render.resolution_y = 1600, 900
    s.view_settings.look = 'None'
    s.render.film_transparent = True
    s.render.image_settings.color_mode = 'RGBA'
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    bpy.context.scene.world = w
    return s


def add_char(name, x, yaw, pose):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, FILES[name]))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    top = [o for o in new if o.parent is None]
    holder = bpy.data.objects.new('h_' + name, None)
    bpy.context.scene.collection.objects.link(holder)
    for o in top:
        o.parent = holder
    holder.location = (x, 0, 0)
    holder.rotation_euler = (0, 0, math.radians(yaw))
    for bn, e in pose.items():
        pb = arm.pose.bones.get(bn)
        if pb:
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = Euler([math.radians(v) for v in e])
    return holder


def light(color_key, color_rim, bg):
    w = bpy.context.scene.world
    w.node_tree.nodes['Background'].inputs[0].default_value = (*bg, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 2.2
    for loc, col, en in (((-3, -4, 3), color_key, 4.0), ((4, 3, 2), color_rim, 6.0)):
        bpy.ops.object.light_add(type='SUN', location=loc)
        L = bpy.context.object
        L.data.color = col
        L.data.energy = en * 1.8
        L.rotation_euler = (Vector((0, 0, 1.0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def camera(loc, look, lens=50):
    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c'))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.data.lens = lens
    cam.location = loc
    cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def shoot(name):
    bpy.context.scene.render.filepath = os.path.join(out_dir, name + '.png')
    bpy.ops.render.render(write_still=True)


ARMS_UP = {'upperarmL': (0, 0, 70), 'upperarmR': (0, 0, -70), 'forearmL': (0, 0, 25), 'forearmR': (0, 0, -25)}
GUARD = {'upperarmL': (0, 40, 40), 'upperarmR': (0, -40, -40), 'forearmL': (0, 0, 70), 'forearmR': (0, 0, -70), 'spine': (8, 0, 0)}
STRIKE = {'upperarmR': (0, -70, -20), 'forearmR': (0, 0, -10), 'spine': (5, 0, -10), 'upperarmL': (0, 20, 50)}

# 1 Gojo hero, low angle
fresh(); g = add_char('gojo', 0, 0, ARMS_UP); light((1, 0.9, 0.7), (0.3, 0.5, 1.0), (0.06, 0.08, 0.2)); camera((0, -6.5, 0.0), (0, 0, 0.0), 35); shoot('01_gojo_hero')
# 2 Sukuna hero
fresh(); s_ = add_char('sukuna', 0, 0, GUARD); light((1, 0.5, 0.4), (0.9, 0.2, 0.2), (0.2, 0.03, 0.04)); camera((0, -6.5, 0.0), (0, 0, 0.0), 35); shoot('02_sukuna_hero')
# 3 face-off
fresh(); add_char('gojo', -1.1, -90, STRIKE); add_char('sukuna', 1.1, 90, GUARD); light((0.9, 0.8, 1.0), (1.0, 0.3, 0.3), (0.08, 0.06, 0.16)); camera((0, -7.2, 0.0), (0, 0, 0.0), 36); shoot('03_faceoff')
# 4 Gojo face
fresh(); add_char('gojo', 0, -15, {}); light((1, 0.95, 0.9), (0.2, 0.6, 1.0), (0.05, 0.1, 0.25)); camera((0.25, -2.2, 0.78), (0, 0, 0.78), 70); shoot('04_gojo_face')
# 5 Sukuna face
fresh(); add_char('sukuna', 0, 15, {}); light((1, 0.8, 0.7), (1.0, 0.2, 0.1), (0.15, 0.02, 0.03)); camera((-0.25, -2.2, 0.78), (0, 0, 0.78), 70); shoot('05_sukuna_face')
# 6 wide dutch angle
fresh(); add_char('gojo', -1.3, -55, STRIKE); add_char('sukuna', 1.3, 125, STRIKE); light((0.8, 0.9, 1.0), (1.0, 0.4, 0.2), (0.1, 0.05, 0.12)); camera((0, -7.5, -0.7), (0, 0, 0.1), 36); shoot('06_clash')
print('POSTERS', out_dir)
