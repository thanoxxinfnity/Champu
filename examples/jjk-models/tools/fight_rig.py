"""Drives the game's rigged Gojo and Sukuna in Blender with the game's own pose library and motion-capture clips.

A port of scripts/rig/rig_animator.gd + pose_lib.gd (examples/jjk-arena): a pose says "the left upper arm points forward-down", and each bone is
turned so its long axis points that way, parents first, so one pose table fits every character whatever its bone roll. The pose clips are
assets/anim/*.json (CMU mocap retargeted by tools/bvh_to_pose.py in the arena project).

Model space of the pose tables is glTF's (+X the character's left, +Y up, +Z forward); Blender's importer turns that into (x, -z, y).
Run inside Blender:  blender -b -P tools/fight_anim.py  (imports this file).
"""
import json
import math
import os
import zlib

import bpy
from mathutils import Matrix, Quaternion, Vector

ARENA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'jjk-arena')


def g2b(v):
    """glTF model space -> Blender armature space."""
    return Vector((v[0], -v[2], v[1]))


DEFAULT = {
    'lean': 6.0, 'twist': 0.0, 'roll': 0.0, 'crouch': 0.0, 'hx': 0.0, 'hz': 0.0, 'head': 0.0,
    'uL': (0.30, -0.80, 0.50), 'fL': (0.10, 0.60, 0.80), 'uR': (0.30, -0.80, 0.55), 'fR': (0.10, 0.60, 0.80),
    'tL': (0.12, -1.0, 0.30), 'sL': (0.10, -1.0, -0.10), 'ftL': (0.0, -0.25, 1.0),
    'hL': (0.0, 0.0, 0.0), 'hR': (0.0, 0.0, 0.0),
    'tR': (0.12, -1.0, -0.20), 'sR': (0.10, -1.0, -0.05), 'ftR': (0.0, -0.25, 1.0),
}
FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky']
FIST = {'thumb': [30, 45, 40], 'index': [80, 95, 70], 'middle': [82, 95, 70], 'ring': [84, 95, 70], 'pinky': [86, 95, 70]}


def mix(a, b, w):
    out = {}
    for k in set(a) | set(b):
        if k not in DEFAULT:
            continue
        va, vb = a.get(k, DEFAULT[k]), b.get(k, DEFAULT[k])
        if isinstance(va, (tuple, list)):
            out[k] = tuple(x + (y - x) * w for x, y in zip(va, vb))
        else:
            out[k] = va + (vb - va) * w
    return out


def _mir(v):
    return (-v[0], v[1], v[2])


def build(p):
    """PoseLib.build: parameters -> {bone: (direction in glTF space, twist degrees)} and the hips offset."""
    q = dict(DEFAULT)
    q.update({k: v for k, v in p.items() if k in DEFAULT})
    lean, tw, roll = q['lean'], q['twist'], q['roll']

    def up(l, r):
        return (math.sin(math.radians(r)), math.cos(math.radians(l)) * math.cos(math.radians(r)), math.sin(math.radians(l)))

    pose = {
        'hips': (up(lean * 0.15, roll * 0.2), tw * 0.15),
        'spine': (up(lean * 0.45, roll * 0.5), tw * 0.45),
        'chest': (up(lean * 0.8, roll * 0.8), tw * 0.8),
        'neck': (up(lean * 0.6 + q['head'] * 0.4, roll * 0.6), tw * 0.9),
        'head': (up(lean * 0.1 + q['head'], roll * 0.4), tw),
        'upperarmL': (q['uL'], 0), 'forearmL': (q['fL'], 0),
        'upperarmR': (_mir(q['uR']), 0), 'forearmR': (_mir(q['fR']), 0),
        'handL': (q['hL'] if Vector(q['hL']).length > 0.3 else q['fL'], 0),
        'handR': (_mir(q['hR'] if Vector(q['hR']).length > 0.3 else q['fR']), 0),
        'thighL': (q['tL'], 0), 'shinL': (q['sL'], 0), 'footL': (q['ftL'], 0),
        'thighR': (_mir(q['tR']), 0), 'shinR': (_mir(q['sR']), 0), 'footR': (_mir(q['ftR']), 0),
    }
    return pose, (q['hx'], -q['crouch'], q['hz'])


def load_clip(name):
    with open(os.path.join(ARENA, 'assets', 'anim', name + '.json')) as f:
        d = json.load(f)
    frames = [{k: (tuple(v) if isinstance(v, list) else v) for k, v in fr.items()} for fr in d['frames']]
    return {'fps': d.get('fps', 30.0), 'frames': frames}


def sample(clip, t, loop=False):
    """The clip's parameters at time t (seconds), interpolated between frames."""
    n = len(clip['frames'])
    x = t * clip['fps']
    if loop:
        x = x % n
        i = int(x) % n
        j = (i + 1) % n
    else:
        x = max(0.0, min(n - 1, x))
        i = int(x)
        j = min(n - 1, i + 1)
    return mix(clip['frames'][i], clip['frames'][j], x - int(x))


class Rig:
    """One imported character: its armature, rest data and the pose applier."""

    def __init__(self, arm, name):
        self.arm = arm
        self.name = name
        bones = arm.data.bones
        self.rest = {b.name: b.matrix_local.to_3x3() for b in bones}
        self.rest_dir = {n: m.col[1].normalized() for n, m in self.rest.items()}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        depth = {}
        for b in bones:
            d, p = 0, b.parent
            while p:
                d += 1
                p = p.parent
            depth[b.name] = d
        self.order = sorted(self.rest, key=lambda n: depth[n])
        self.hips_rest = self.rest['hips']
        arm.rotation_mode = 'XYZ'
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        self.foot_offset = 0.0

    def fingers(self, side):
        out = {}
        for f in FINGERS:
            out[f] = [f'{f}{j}{side}' for j in range(3)]
        return out

    def pose_at(self, spec, hips, curls=None, sway=None):
        """Sets every pose bone for one pose (no keyframes). spec/hips come from build(); curls: {'L'|'R': {finger: [deg, deg, deg]}}."""
        curls = curls or {}
        curl_for = {}
        for side, fingers in curls.items():
            sgn = 1.0 if side == 'R' else -1.0
            for f, angs in fingers.items():
                for j, a in enumerate(angs):
                    bn = f'{f}{j}{side}'
                    if bn not in self.rest:
                        continue
                    about = Vector((0, -1, 0))  # glTF +Z (forward) in Blender space
                    if f == 'thumb' and f'hand{side}' in self.rest:
                        about = -self.rest_dir[f'hand{side}']
                    axis = (self.rest[bn].inverted() @ about).normalized()
                    curl_for[bn] = Quaternion(axis, math.radians(a) * sgn).to_matrix()
        new_b = {}
        for n in self.order:
            p = self.parent[n]
            parent_b = new_b[p] if p else Matrix.Identity(3)
            rest_local = (self.rest[p].inverted() if p else Matrix.Identity(3)) @ self.rest[n]
            if n in spec:
                d, twist = spec[n]
                d = g2b(d).normalized()
                nb = self.rest_dir[n].rotation_difference(d).to_matrix() @ self.rest[n]
                if abs(twist) > 0.01:
                    nb = Quaternion(d, math.radians(twist)).to_matrix() @ nb
            else:
                nb = parent_b @ rest_local
                if n in curl_for:
                    nb = nb @ curl_for[n]
            new_b[n] = nb
            pb = self.arm.pose.bones[n]
            delta = rest_local.inverted() @ parent_b.inverted() @ nb
            pb.rotation_quaternion = delta.to_quaternion()
            if n != 'hips':
                pb.location = (0, 0, 0)
        hp = self.arm.pose.bones['hips']
        hp.location = self.hips_rest.inverted() @ g2b(hips)
        if sway is not None:
            for pb in self.arm.pose.bones:
                if pb.name.startswith('sway_'):
                    pb.rotation_mode = 'XYZ'
                    k = (zlib.crc32(pb.name.encode()) % 97) / 97.0 * 6.28
                    pb.rotation_euler = (sway * math.sin(sway_t[0] * 7.0 + k), 0.0, sway * 0.5 * math.cos(sway_t[0] * 5.0 + k))

    def key(self, frame):
        for pb in self.arm.pose.bones:
            if pb.rotation_mode == 'QUATERNION':
                pb.keyframe_insert('rotation_quaternion', frame=frame)
            else:
                pb.keyframe_insert('rotation_euler', frame=frame)
            if pb.name == 'hips':
                pb.keyframe_insert('location', frame=frame)


sway_t = [0.0]


def import_character(path, label):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    # the glb carries a stray 2 m "Icosphere" with no skin (a leftover of its export): not part of the character
    stray = [o for o in new if o.type == 'MESH' and (o.parent is None or o.name.startswith('Icosphere'))]
    meshes = [o for o in new if o.type == 'MESH' and o not in stray]
    for o in stray:
        bpy.data.objects.remove(o, do_unlink=True)
    arm.name = label + '_rig'
    for m in meshes:
        m.name = f'{label}_{m.name}'
    # stand the feet on z = 0: the glb is centred on the body
    bpy.context.view_layer.update()
    low = min((m.matrix_world @ Vector(c)).z for m in meshes for c in m.bound_box)
    rig = Rig(arm, label)
    rig.foot_offset = -low
    rig.meshes = meshes
    return rig
