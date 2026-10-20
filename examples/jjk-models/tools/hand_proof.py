"""Hand close-up, open vs fist, plus a finger/toe bone count:  blender -b models/x.blend -P tools/hand_proof.py -- out.png"""
import bpy, sys, math
from mathutils import Vector, Euler
out = sys.argv[sys.argv.index('--') + 1]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
names = [b.name for b in arm.data.bones]
fing = [n for n in names if any(n.startswith(f) for f in ('thumb', 'index', 'middle', 'ring', 'pinky'))]
toes = [n for n in names if n.startswith('toe')]
print('BONES total', len(names), 'finger', len(fing), 'toe', len(toes), 'sway', len([n for n in names if n.startswith('sway')]))
hand = arm.matrix_world @ arm.data.bones['handL'].head_local
arm.hide_render = True
w = bpy.data.worlds.new('w'); w.use_nodes = True; bpy.context.scene.world = w; w.node_tree.nodes['Background'].inputs[0].default_value = (.55, .55, .6, 1)
bpy.ops.object.light_add(type='SUN', location=(2, -4, 4)); bpy.context.object.data.energy = 3
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 0.38
cam.location = (hand.x + 0.06, hand.y - 5, hand.z + 0.02); cam.rotation_euler = (math.pi / 2, 0, 0)
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE_NEXT'; sc.render.resolution_x = 520; sc.render.resolution_y = 420
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import hand_pose
for tag, nm in (('open', 'open'), ('half', 'guard'), ('fist', 'fist')):
    hand_pose.clear_pose(arm)
    hand_pose.pose_hand(arm, 'L', nm)
    sc.render.filepath = f'/tmp/cm/_h_{tag}.png'; bpy.ops.render.render(write_still=True)
