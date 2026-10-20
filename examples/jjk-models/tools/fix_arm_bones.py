"""Re-seat the arm bones on the mesh's own arm centre line (the fitted joints sat well above/below the arms in the T-pose).

    blender -b models/gojo_whole.blend -P tools/fix_arm_bones.py

Fits z(x) and y(x) of the bare arm from the body mesh, then moves shoulder end / elbow / wrist / hand tail (both sides) onto it.
Everything parented below the hand (fingers) moves with the wrist. Skin weights are by bone name, so the rest pose does not change."""
import bpy, numpy as np
from mathutils import Vector

arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.split('_')[0] in ('body',) or o.name == 'body'][0]
vs = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices])
xs, zs, ys = [], [], []
for x0 in np.arange(0.30, 0.64, 0.02):
    s = vs[(vs[:, 0] > x0) & (vs[:, 0] < x0 + 0.02)]
    if len(s) > 20 and s[:, 2].max() - s[:, 2].min() < 0.2:
        xs.append(x0 + 0.01); zs.append(s[:, 2].mean()); ys.append(s[:, 1].mean())
pz, py = np.polyfit(xs, zs, 1), np.polyfit(xs, ys, 1)
line = lambda x: Vector((x, float(np.polyval(py, x)), float(np.polyval(pz, x))))
print('ARMLINE z slope', round(pz[0], 3), 'n', len(xs))

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
for side, sg in (('L', 1), ('R', -1)):
    f = lambda x: (lambda p: Vector((sg * p.x, p.y, p.z)))(line(abs(x)))
    sh, ua, fa, ha = (eb[n + side] for n in ('shoulder', 'upperarm', 'forearm', 'hand'))
    root, elbow, wrist = abs(ua.head.x), abs(fa.head.x), abs(ha.head.x)
    tip = abs(ha.tail.x)
    old_wrist = ha.head.copy()
    new_root, new_elbow, new_wrist, new_tip = f(sg * root), f(sg * elbow), f(sg * wrist), f(sg * tip)
    delta = new_wrist - old_wrist
    kids = []
    def walk(b):
        for c in b.children:
            kids.append(c); walk(c)
    walk(ha)
    for k in kids:
        k.head += delta; k.tail += delta
    sh.tail = new_root; ua.head = new_root; ua.tail = new_elbow
    fa.head = new_elbow; fa.tail = new_wrist; ha.head = new_wrist; ha.tail = new_tip
    print(side, 'wrist moved by', [round(x, 3) for x in delta], 'fingers moved', len(kids))
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.wm.save_mainfile()
bpy.ops.export_scene.gltf(filepath=bpy.data.filepath.replace('.blend', '.glb'), export_format='GLB', export_skins=True, export_yup=True, export_image_format='JPEG')
print('ARMFIX done')
