"""Join a generated head+chest+arms bust to a generated full body at the belt.

    blender -b -P tools/graft_bust.py -- whole.glb bust.glb out_base belt_z_whole [belt_frac_from_top_of_bust]

The two meshes come from the same reference drawing, so skin, neck and shirt are one continuous surface in the bust and the seam falls in
the belt, where both sides carry the same cloth. The bust is scaled so its arm span equals the body's, centred, and its front aligned with
the body's at the belt. Everything above the belt is taken from the bust, everything below from the body; the result is one object."""
import bpy, bmesh, sys, os
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index('--') + 1:]
whole_p, bust_p, base = a[0], a[1], a[2]
belt_frac = float(a[3]) if len(a) > 3 else 0.725      # belt centre as a fraction of the bust's height, measured from its top
bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    ms = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in ms:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world.identity()
    for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    ms[0].name = name
    return ms[0]


def ext(o):
    xs = [v.co.x for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    zs = [v.co.z for v in o.data.vertices]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


whole = load(whole_p, 'lower')
bust = load(bust_p, 'upper')
(wx0, wx1), (wy0, wy1), (wz0, wz1) = ext(whole)
(bx0, bx1), (by0, by1), (bz0, bz1) = ext(bust)
s = (wx1 - wx0) / (bx1 - bx0)                           # arm span match
bust.data.transform(Matrix.Diagonal((s, s, s, 1.0)))
(bx0, bx1), (by0, by1), (bz0, bz1) = ext(bust)
# the head top of the bust sits on the head top of the body: that fixes the height; the belt then lands where the drawing puts it
bust.data.transform(Matrix.Translation(Vector((-(bx0 + bx1) / 2 + (wx0 + wx1) / 2, 0, wz1 - bz1))))
(bx0, bx1), (by0, by1), (bz0, bz1) = ext(bust)
belt_z = bz1 - belt_frac * (bz1 - bz0)
# match the front of the two meshes at the belt line
def front_y(o, z):
    ys = [v.co.y for v in o.data.vertices if abs(v.co.z - z) < 0.03 and abs(v.co.x) < 0.25]
    return min(ys), max(ys)
wf0, wf1 = front_y(whole, belt_z)
bf0, bf1 = front_y(bust, belt_z)
bust.data.transform(Matrix.Translation(Vector((0, ((wf0 + wf1) - (bf0 + bf1)) / 2, 0))))
print('BELT z=%.3f scale=%.3f' % (belt_z, s))


def cut(o, z, keep_above):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=Vector((0, 0, z)), plane_no=Vector((0, 0, 1)),
                           clear_inner=keep_above, clear_outer=not keep_above)
    bm.to_mesh(o.data)
    bm.free()


cut(bust, belt_z, keep_above=True)
cut(whole, belt_z, keep_above=False)
bpy.ops.object.select_all(action='DESELECT')
bust.select_set(True)
whole.select_set(True)
bpy.context.view_layer.objects.active = whole
bpy.ops.object.join()
whole.name = 'body'
for p in whole.data.polygons:
    p.use_smooth = True
out = os.path.join(os.path.dirname(os.path.abspath(whole_p)), base)
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', export_image_format='JPEG', export_yup=True)
print('BUSTGRAFT', base)
