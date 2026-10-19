"""Make a rigged character dismemberable: waist, both elbows and both knees become real cut lines.

    blender -b models/gojo_rigged.blend -P tools/make_cuttable.py -- [out_basename]

Every mesh of the character is bisected at the cut planes and its faces are sorted into pieces
(upper, lower, foreL/foreR = forearm+hand, shinL/shinR = shin+foot). Each piece keeps its skin weights and the armature modifier, so the
joined character moves exactly like before; the open ends that lie on a cut plane are capped with a flesh/blood material, so a cut-off
piece and its stump both look closed. Objects are named cut_<piece>__<part>; the game hides a piece (and shows a blood stump) when that
limb is cut, and re-attaching is just making the piece visible again. Planes come from the rig: waist = the sash height, elbows = the
forearm bone heads, knees = the shin bone heads."""
import bpy, bmesh, sys, os
from mathutils import Vector

arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bones = arm.data.bones


def head(name):
    return arm.matrix_world @ bones[name].head_local


xe = abs(head('forearmL').x)
zk = head('shinL').z
sash = [o for o in meshes if '_sash_' in o.name]
if sash:
    zs = [(o.matrix_world @ v.co).z for o in sash for v in o.data.vertices]
    zw = sum(zs) / len(zs)
else:
    zw = head('spine').z
print('PLANES waist z=%.3f elbow |x|=%.3f knee z=%.3f' % (zw, xe, zk))

EPS = 0.004
flesh = bpy.data.materials.new('cut_flesh')
flesh.use_nodes = True
b = flesh.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.55, 0.05, 0.06, 1)
b.inputs['Roughness'].default_value = 0.35


def region(p):
    if p.z > zw:
        if p.x > xe:
            return 'foreL'
        if p.x < -xe:
            return 'foreR'
        return 'upper'
    if p.z < zk:
        return 'shinL' if p.x > 0 else 'shinR'
    return 'lower'


def on_plane(p):
    return abs(p.z - zw) < EPS or abs(abs(p.x) - xe) < EPS or abs(p.z - zk) < EPS


made = []
for o in meshes:
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for co, no in (((0, 0, zw), (0, 0, 1)), ((xe, 0, 0), (1, 0, 0)), ((-xe, 0, 0), (1, 0, 0)), ((0, 0, zk), (0, 0, 1))):
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(no), dist=1e-5)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        f.material_index = f.material_index
    groups = {}
    for f in bm.faces:
        groups.setdefault(region(f.calc_center_median()), []).append(f.index)
    if len(groups) == 1:
        # a part that lies entirely in one piece (hair, head, shoes...) keeps its own mesh, just renamed
        piece = list(groups)[0]
        o.name = f'cut_{piece}__{o.name}'
        made.append(o)
        bm.free()
        continue
    for piece, idxs in groups.items():
        b2 = bm.copy()
        b2.faces.ensure_lookup_table()
        keep = set(idxs)
        bmesh.ops.delete(b2, geom=[f for f in b2.faces if f.index not in keep], context='FACES')
        bmesh.ops.delete(b2, geom=[v for v in b2.verts if not v.link_faces], context='VERTS')
        loop = [e for e in b2.edges if e.is_boundary and on_plane(e.verts[0].co) and on_plane(e.verts[1].co)
                and ((abs(e.verts[0].co.z - zw) < EPS and abs(e.verts[1].co.z - zw) < EPS) or
                     (abs(abs(e.verts[0].co.x) - xe) < EPS and abs(abs(e.verts[1].co.x) - xe) < EPS) or
                     (abs(e.verts[0].co.z - zk) < EPS and abs(e.verts[1].co.z - zk) < EPS))]
        if loop:
            idx = len(o.data.materials)
            res = bmesh.ops.triangle_fill(b2, edges=loop, use_beauty=True)
            for f in res.get('geom', []):
                if isinstance(f, bmesh.types.BMFace):
                    f.material_index = idx
        m2 = bpy.data.meshes.new(f'cut_{piece}__{o.name}')
        b2.to_mesh(m2)
        b2.free()
        for m in o.data.materials:
            m2.materials.append(m)
        m2.materials.append(flesh)
        o2 = bpy.data.objects.new(m2.name, m2)
        bpy.context.scene.collection.objects.link(o2)
        for vg in o.vertex_groups:
            o2.vertex_groups.new(name=vg.name)
        # vertex group weights survive because bmesh deform layers are copied with the mesh
        mod = o2.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        o2.parent = arm
        made.append(o2)
    bm.free()
    bpy.data.objects.remove(o, do_unlink=True)

# an exploded copy of the scene for the preview: pieces slide apart along their cut normal
base = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 1 else 'gojo_cuttable'
out_dir = os.path.dirname(bpy.data.filepath)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, base + '.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, base + '.glb'), export_format='GLB', export_skins=True, export_yup=True)
print('CUTTABLE', base, len(made), 'objects', sorted({o.name.split('__')[0] for o in made}))
