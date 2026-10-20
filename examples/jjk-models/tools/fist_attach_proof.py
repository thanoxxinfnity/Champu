"""Proof render: closed-fist mesh (models/fist_L.glb) placed on the forearm line with the hand and finger bones collapsed.

    blender -b models/gojo_whole.blend -P tools/fist_attach_proof.py -- L out.png"""
import bpy, sys, math
sys.path.insert(0, '/home/user/Champu/examples/jjk-models/tools')
import hand_pose
from mathutils import Vector, Matrix
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
side = sys.argv[sys.argv.index('--')+1]  # L or R
out = sys.argv[sys.argv.index('--')+2]
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=f'/home/user/Champu/examples/jjk-models/models/fist_{side}.glb')
fist = [o for o in bpy.data.objects if o not in before and o.type == 'MESH'][0]
for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']: bpy.data.objects.remove(o, do_unlink=True)
fist.parent = None
mw = fist.matrix_world.copy(); fist.data.transform(mw); fist.matrix_world.identity()
b = arm.data.bones['hand'+side]
print('BONE', b.head_local, b.tail_local, 'len', b.length)
bb = fist.bound_box; xs=[v[0] for v in bb]; ys=[v[1] for v in bb]; zs=[v[2] for v in bb]
print('FIST bbox', min(xs),max(xs),min(ys),max(ys),min(zs),max(zs))
hand_pose.clear_pose(arm)
pf = b.parent.name
fw = (arm.matrix_world @ b.tail_local) - (arm.matrix_world @ b.head_local)
# direction from forearm end through hand head so the fist continues the arm line
head = arm.matrix_world @ b.head_local
fdir = (head - (arm.matrix_world @ b.parent.head_local)).normalized()
print('FDIR', fdir, 'bonedir', fw.normalized())
up = Vector((0,0,1)); up = (up - fdir*up.dot(fdir)).normalized()
side_v = up.cross(fdir)
# asset: x forward, z up, y = z cross x
basis = Matrix(((fdir.x, -side_v.x, up.x),(fdir.y, -side_v.y, up.y),(fdir.z, -side_v.z, up.z))).to_4x4()
Wm = Matrix.Translation(head - fdir*0.015 + up*0.0) @ basis @ Matrix.Scale(0.8,4)
fist.parent = arm; fist.parent_type='BONE'; fist.parent_bone = pf
fist.matrix_world = Wm
bpy.context.view_layer.update()
for pb in arm.pose.bones:
    n = pb.name
    if n.endswith(side) and n[:5] in ('thumb','index','middl','ring0','ring1','ring2','pinky','hand'+side[:0]) or n=='hand'+side:
        pb.scale=(0.001,)*3
bpy.context.view_layer.update()
arm.hide_render=True
w=bpy.data.worlds.new('w'); w.use_nodes=True; bpy.context.scene.world=w; w.node_tree.nodes['Background'].inputs[0].default_value=(.55,.55,.6,1)
bpy.ops.object.light_add(type='SUN', location=(2,-4,4)); bpy.context.object.data.energy=3
hand = arm.matrix_world @ b.head_local
cam=bpy.data.objects.new('c', bpy.data.cameras.new('c')); bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=0.6; cam.location=(hand.x+(0.1 if side=='L' else -0.1), hand.y-5, hand.z); cam.rotation_euler=(math.pi/2,0,0)
sc=bpy.context.scene; sc.render.engine='BLENDER_EEVEE_NEXT'; sc.render.resolution_x=700; sc.render.resolution_y=560
sc.render.filepath=out; bpy.ops.render.render(write_still=True)
ws=[fist.matrix_world @ Vector(c) for c in fist.bound_box]
print('WORLD', [round(min(v[i] for v in ws),3) for i in range(3)], [round(max(v[i] for v in ws),3) for i in range(3)])
print('PB', arm.pose.bones['hand'+side].matrix.to_3x3().col[1], arm.pose.bones['hand'+side].matrix.to_3x3().col[2])
print('ARMW', arm.matrix_world.to_scale(), arm.scale)
