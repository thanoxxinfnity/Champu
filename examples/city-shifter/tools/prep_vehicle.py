"""Generated car model (with its wheels baked in) -> a body without wheels + where the four wheels were, so the game can mount real rolling tyres.
    blender -b -P tools/prep_vehicle.py -- in.glb out.glb out.json yaw_deg tire_radius_frac tris tex_px
The model is turned (yaw about the vertical) so its front points to Blender +Y (= glTF -Z, the game's forward), scaled to length 1, put on the floor and centred.
The wheels are found where the tyres touch the floor (the lowest vertices at the outer sides, split into front and rear by the biggest gap); every face that
lies inside the wheel's cylinder on the outer part of the car is cut away. JSON: {"w": width, "h": height, "r": wheel radius, "wheels": [[x, y, z] x4]} in units of the body length."""
import json, math, os, sys
import bmesh, bpy
from mathutils import Matrix, Vector

a = sys.argv[sys.argv.index('--') + 1:]
src, dst, jdst = a[0], a[1], a[2]
yaw, rfrac, tris, tex = float(a[3]), float(a[4]), int(a[5]), int(a[6])
opt = {a[i][2:]: float(a[i + 1]) for i in range(7, len(a) - 1) if a[i].startswith('--')}      # --front y --rear y --r radius: measured by eye when the texture fools the detector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ms = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in ms:
    o.select_set(True)
bpy.context.view_layer.objects.active = ms[0]
if len(ms) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o != ob:
        bpy.data.objects.remove(o, do_unlink=True)
me = ob.data


def box():
    vs = [v.co for v in me.vertices]
    return Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))), Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))


me.transform(Matrix.Rotation(math.radians(yaw), 4, 'Z'))
mn, mx = box()
if (mx.x - mn.x) > (mx.y - mn.y):
    me.transform(Matrix.Rotation(math.radians(90), 4, 'Z'))
mn, mx = box()
L = mx.y - mn.y
me.transform(Matrix.Translation(Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))))
me.transform(Matrix.Scale(1.0 / L, 4))
me.update()
mn, mx = box()
W, H = mx.x - mn.x, mx.z - mn.z
r = rfrac
import numpy as np
# per-vertex brightness of the base-colour texture: tyres are the dark rubber at the outer low sides
lum = np.ones(len(me.vertices))
img = None
for ma in me.materials:
    if ma and ma.use_nodes:
        for nd in ma.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and any(l.from_node == nd and l.to_socket.name == 'Base Color' for l in ma.node_tree.links):
                img = nd.image
if img is not None and me.uv_layers:
    w, h = img.size
    px = np.array(img.pixels[:]).reshape(h, w, 4)
    uv = me.uv_layers[0].data
    seen = set()
    for lp in me.loops:
        if lp.vertex_index in seen:
            continue
        seen.add(lp.vertex_index)
        u, v = uv[lp.index].uv
        c = px[min(h - 1, max(0, int(v * h))), min(w - 1, max(0, int(u * w)))]
        lum[lp.vertex_index] = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
xc = 0.0
dark = [v.co for v in me.vertices if lum[v.index] < 0.22 and abs(v.co.x) > 0.3 * W and v.co.z < 0.3 * H]
if len(dark) < 30:
    sys.exit('no tyres found in the texture')
# the axles: the two biggest peaks of the dark outer low vertices along the length
hist = np.zeros(110)
for c in dark:
    hist[min(109, max(0, int((c.y + 0.55) * 100)))] += 1
hist = np.convolve(hist, np.ones(5) / 5.0, mode='same')
p1 = int(np.argmax(hist))
masked = hist.copy()
masked[max(0, p1 - 14):p1 + 15] = 0
p2 = int(np.argmax(masked))
axles = sorted([p1 / 100.0 - 0.55 + 0.005, p2 / 100.0 - 0.55 + 0.005], reverse=True)
if 'front' in opt and 'rear' in opt:
    axles = [opt['front'], opt['rear']]
wheels = []
radii = []
tws = []
for yc in axles:
    for sx in (-1, 1):
        sel = [c for c in dark if c.x * sx > 0 and abs(c.y - yc) < 0.06]
        xv = sorted(abs(c.x) for c in sel) or [0.3 * W]
        zs = sorted(c.z for c in sel) or [0.0, 2 * r]
        rr = min(max((zs[int(len(zs) * 0.95)] - zs[0]) / 2.0, r * 0.8), r * 1.35)
        wheels.append((sx * xv[len(xv) // 2], yc, rr))
        radii.append(rr)
        tws.append(max(0.03, (xv[int(len(xv) * 0.95)] - xv[int(len(xv) * 0.05)]) / 2.0 + 0.01))
r = opt.get('r', sorted(radii)[len(radii) // 2])
xc = sorted(abs(w[0]) for w in wheels)[len(wheels) // 2]
wheels = [(w[0], w[1], r) for w in wheels]
tw = max(0.02, sorted(tws)[len(tws) // 2])      # half the tyre width
bm = bmesh.new()
bm.from_mesh(me)
doomed = []
for f in bm.faces:
    c = f.calc_center_median()
    for (wx, wy, wz) in wheels:
        if abs(c.x) > xc - tw * 1.4 and (c.x * wx) > 0 and (c.y - wy) ** 2 + (c.z - wz) ** 2 < (r * 1.2) ** 2:
            doomed.append(f)
            break
bmesh.ops.delete(bm, geom=doomed, context='FACES')
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(me)
bm.free()
print('WHEELS', [tuple(round(x, 3) for x in w) for w in wheels], 'cut faces', len(doomed), 'r', r)
mn, mx = box()
off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, 0.0))
me.transform(Matrix.Translation(-off))
wheels = [(w[0] - off.x, w[1] - off.y, w[2]) for w in wheels]
n = sum(len(p.vertices) - 2 for p in me.polygons)
if n > tris:
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.ratio = tris / n
    bpy.ops.object.modifier_apply(modifier='dec')
for ma in me.materials:
    if not ma or not ma.use_nodes:
        continue
    nt = ma.node_tree
    bsdf = next((x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED'), None)
    for x in list(nt.nodes):
        if x.type == 'TEX_IMAGE':
            linked = any(l.from_node == x and l.to_socket.name == 'Base Color' for l in nt.links)
            if not linked:
                nt.nodes.remove(x)
            elif x.image and max(x.image.size) > tex:
                k = tex / max(x.image.size)
                x.image.scale(max(1, int(x.image.size[0] * k)), max(1, int(x.image.size[1] * k)))
    for x in list(nt.nodes):
        if x.type in ('SEPARATE_COLOR', 'SEPARATE_RGB', 'MATH'):
            nt.nodes.remove(x)
    if bsdf:
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.85
mn, mx = box()
os.makedirs(os.path.dirname(dst), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_yup=True)
json.dump({'w': mx.x - mn.x, 'h': mx.z, 'r': r, 'wheels': [list(w) for w in wheels]}, open(jdst, 'w'))
print('PREP', os.path.basename(dst), n, '->', sum(len(p.vertices) - 2 for p in me.polygons), os.path.getsize(dst) // 1024, 'KB')
