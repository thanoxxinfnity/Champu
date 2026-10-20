"""Anatomical hand poses for the 51+-bone rig (importable from Blender scripts).

A real fist curls each finger at three joints by different amounts (knuckle ~80 deg, middle ~100, tip ~65) and the thumb folds across the
fingers. The curl is a rotation about the world Y axis (front-back), converted into each bone's own local space, so it is correct for
both hands and for any bone roll. `pose_hand(arm, side, name)` writes the pose; names: open, relaxed, guard, fist."""
import math
from mathutils import Matrix, Quaternion, Vector

FINGERS = ('index', 'middle', 'ring', 'pinky')
POSES = {
    #            knuckle, middle, tip   thumb (base, mid, tip)   finger spread (deg, ring/pinky fan)
    'open': {'f': (0, 0, 0), 't': (0, 0, 0), 'twist': 0},
    'relaxed': {'f': (25, 35, 20), 't': (10, 12, 8), 'twist': 0},
    'guard': {'f': (60, 80, 50), 't': (25, 30, 20), 'twist': 10},
    'fist': {'f': (82, 102, 66), 't': (38, 42, 32), 'twist': 24},
}


def _curl(arm, bone_name, world_deg, axis):
    pb = arm.pose.bones.get(bone_name)
    if pb is None:
        return
    rest = pb.bone.matrix_local.to_3x3()
    R = Matrix.Rotation(math.radians(world_deg), 3, axis)
    local = rest.inverted() @ R @ rest
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = local.to_quaternion()


def pose_hand(arm, side, name):
    p = POSES[name]
    sg = 1.0 if side == 'L' else -1.0       # the left hand points along +X, the right along -X
    for f in FINGERS:
        for j, deg in enumerate(p['f']):
            _curl(arm, f'{f}{j}{side}', sg * deg, Vector((0, 1, 0)))
    # the thumb folds down and across the palm: curl about Y plus a twist about the finger direction (X)
    for j, deg in enumerate(p['t']):
        _curl(arm, f'thumb{j}{side}', sg * deg, Vector((0, 1, 0)))
    pb = arm.pose.bones.get(f'thumb0{side}')
    if pb is not None and p['twist']:
        rest = pb.bone.matrix_local.to_3x3()
        R = Matrix.Rotation(math.radians(p['twist']), 3, Vector((0, 0, 1)) * sg)
        pb.rotation_quaternion = (rest.inverted() @ R @ rest).to_quaternion() @ pb.rotation_quaternion


def clear_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
