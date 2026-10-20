"""Turn the generated fist into game assets fist_L.glb / fist_R.glb (origin = wrist, knuckles toward +X for the left hand).

    blender -b -P tools/make_fist_asset.py -- raw/fist_hand_tv.glb models  [fist_width_units=0.092] [tris=7000]

The long axis of the mesh (forearm -> fist) is found by PCA; the fatter end is the fist. The mesh is rotated so that axis is +X with the
fist at +X, scaled so the knuckle row is `fist_width` wide (the body's hand is ~0.09 wide in the same units), and moved so the wrist (the
mesh end with the thin forearm cut) sits at the origin. The right hand is the mirror image."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
import numpy as np

a = sys.argv[sys.argv.index('--') + 1:]
src, outdir = a[0], a[1]
width = float(a[2]) if len(a) > 2 else 0.092
tris = int(a[3]) if len(a) > 3 else 7000
bpy.ops.wm.read_factory_settings(use_empty=True)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
obj = [o for o in bpy.data.objects if o not in before and o.type == 'MESH'][0]
mw = obj.matrix_world.copy()
obj.parent = None
obj.data.transform(mw)
obj.matrix_world.identity()
for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)
me = obj.data
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5)
bm.to_mesh(me); bm.free()
# decimate
bpy.context.view_layer.objects.active = obj
d = obj.modifiers.new('d', 'DECIMATE'); d.ratio = min(1.0, tris / max(1, sum(len(p.vertices) - 2 for p in me.polygons)))
bpy.ops.object.modifier_apply(modifier='d')
V = np.array([v.co[:] for v in me.vertices])
c = V.mean(0)
u, s, vt = np.linalg.svd(V - c, full_matrices=False)
axis = vt[0]
t = (V - c) @ axis
# the fatter end (larger perpendicular spread among the extreme 15%) is the fist
lo, hi = np.percentile(t, 10), np.percentile(t, 90)
def spread(mask):
    P = (V[mask] - c) - np.outer(t[mask], axis)
    return np.linalg.norm(P - P.mean(0), axis=1).mean()
if spread(t > hi) > spread(t < lo):
    axis = -axis
    t = -t
# rotation taking `axis` to +X, then spin about X so the thumb side is up (+Z): take the mean of the 'thumb' = farthest bulge above the axis
ax = Vector(axis.tolist())
R = ax.rotation_difference(Vector((1, 0, 0))).to_matrix().to_4x4()
me.transform(Matrix.Translation(-Vector(c.tolist())))
me.transform(R)
Vf = np.array([v.co[:] for v in me.vertices])
fist_part = Vf[Vf[:, 0] > np.percentile(Vf[:, 0], 70)]
# knuckles face down (-Z in the T-pose, palm down): rotate about X so that the mean of the fist's offset points to -Z
off = fist_part[:, 1:].mean(0)
ang = math.atan2(off[1], off[0])
me.transform(Matrix.Rotation(-ang - math.pi / 2, 4, 'X'))
Vf = np.array([v.co[:] for v in me.vertices])
fist_x = Vf[:, 0] > np.percentile(Vf[:, 0], 75)
w = (Vf[fist_x, 1].max() - Vf[fist_x, 1].min())
k = width / max(w, 1e-6)
me.transform(Matrix.Diagonal((k, k, k, 1.0)))
Vf = np.array([v.co[:] for v in me.vertices])
wrist_x = np.percentile(Vf[:, 0], 28)
me.transform(Matrix.Translation(Vector((-wrist_x, 0, 0))))
# keep from slightly behind the wrist to the knuckles
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=Vector((-0.03, 0, 0)), plane_no=Vector((1, 0, 0)), clear_inner=True, clear_outer=False)
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
obj.name = 'fist'
os.makedirs(outdir, exist_ok=True)
def export(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='JPEG', export_yup=True)
export(os.path.join(outdir, 'fist_L.glb'))
# mirror for the right hand
bm = bmesh.new(); bm.from_mesh(me)
for v in bm.verts: v.co.x = -v.co.x
bmesh.ops.reverse_faces(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
export(os.path.join(outdir, 'fist_R.glb'))
print('FISTASSET scale', round(k, 4), 'tris', sum(len(p.vertices) - 2 for p in me.polygons))
