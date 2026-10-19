"""Render rest / posed / bones sheet of a rigged .blend:  blender -b file.blend -P tools/pose_sheet.py -- out.png"""
import bpy, sys, math
from mathutils import Vector, Euler
out = sys.argv[sys.argv.index('--')+1]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c); mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
ctr = (mn+mx)/2; h = mx.z-mn.z
bpy.ops.object.light_add(type='SUN', location=(2,-4,4)); bpy.context.object.data.energy = 2.4
w = bpy.data.worlds.new('w'); w.use_nodes = True; bpy.context.scene.world = w
w.node_tree.nodes['Background'].inputs[0].default_value = (.5,.5,.53,1)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = h*1.2
cam.location = (ctr.x, ctr.y-10, ctr.z); cam.rotation_euler = (math.pi/2, 0, 0)
s = bpy.context.scene; s.render.engine = 'BLENDER_EEVEE_NEXT'; s.render.resolution_x = 560; s.render.resolution_y = 800
bpy.context.view_layer.objects.active = arm
def rot(name, e):
    pb = arm.pose.bones.get(name)
    if pb: pb.rotation_mode = 'XYZ'; pb.rotation_euler = Euler(e)
def clear():
    for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0,0,0)
shots = []
def snap(tag, bones_vis=False):
    arm.show_in_front = bones_vis; arm.data.display_type = 'STICK' if bones_vis else 'OCTAHEDRAL'
    arm.hide_viewport = not bones_vis; arm.hide_render = not bones_vis
    s.render.filepath = f'/tmp/cm/_p_{tag}.png'; bpy.ops.render.render(write_still=True); shots.append(s.render.filepath)
clear(); snap('rest'); snap('bones', True)
# pose: raise arm, fist, bend knee, crouch
clear()
for f in ('thumb','index','middle','ring','pinky'):
    for j in range(3):
        for sd in 'LR':
            rot(f'{f}{j}{sd}', (0, 0, 0))
rot('upperarmL', (0, 0, math.radians(55))); rot('forearmL', (0, 0, math.radians(35)))
rot('upperarmR', (0, 0, math.radians(-30)))
rot('thighL', (math.radians(-60), 0, 0)); rot('shinL', (math.radians(90), 0, 0))
rot('spine', (math.radians(12), 0, 0)); rot('head', (0, 0, math.radians(15)))
snap('pose')
clear()
for f in ('thumb','index','middle','ring','pinky'):
    for j in range(3):
        for sd in 'LR':
            rot(f'{f}{j}{sd}', (math.radians(-70), 0, 0) if f!='thumb' else (math.radians(-40), 0, 0))
rot('forearmL', (0, math.radians(-30), 0))
snap('fist')
print('SHOTS', ' '.join(shots))
