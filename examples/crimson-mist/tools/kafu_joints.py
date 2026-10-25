"""Joint table for the Triverse Kafu mesh (not a T-pose: left hand at the ear, right arm down). Raw model units, Blender axes
(front = -Y, her left = +X, feet at z = -1). Measured on orthographic renders with a 0.1 grid. Writes the JSON autorig_obj.py reads:
    python3 tools/kafu_joints.py > /tmp/kafu_joints.json"""
import json

B = {}


def bone(name, head, tail, parent=None, sway=False):
    B[name] = {'head': head, 'tail': tail, 'parent': parent, 'sway': sway}


def mir(p):
    return [-p[0], p[1], p[2]]


bone('Hips', [0, 0, -0.02], [0, 0, 0.20])
bone('Spine', [0, 0, 0.20], [0, 0, 0.42], 'Hips')
bone('Chest', [0, 0, 0.42], [0, 0, 0.62], 'Spine')
bone('Neck', [0, 0, 0.62], [0, -0.01, 0.70], 'Chest')
bone('Head', [0, -0.01, 0.70], [0, 0, 1.0], 'Neck')
arm = {'L': [[0.03, 0, 0.60], [0.19, 0, 0.58], [0.27, -0.02, 0.36], [0.15, -0.06, 0.64], [0.10, -0.08, 0.75]],
       'R': [[-0.03, 0, 0.60], [-0.19, 0, 0.58], [-0.29, 0, 0.32], [-0.30, 0, 0.10], [-0.31, 0, -0.07]]}
for s, p in arm.items():
    bone(f'Shoulder.{s}', p[0], p[1], 'Chest')
    bone(f'UpperArm.{s}', p[1], p[2], f'Shoulder.{s}')
    bone(f'LowerArm.{s}', p[2], p[3], f'UpperArm.{s}')
    bone(f'Hand.{s}', p[3], p[4], f'LowerArm.{s}')
for s, sg in (('L', 1), ('R', -1)):
    bone(f'UpperLeg.{s}', [0.065 * sg, 0, -0.02], [0.075 * sg, 0, -0.37], 'Hips')
    bone(f'LowerLeg.{s}', [0.075 * sg, 0, -0.37], [0.08 * sg, 0, -0.84], f'UpperLeg.{s}')
    bone(f'Foot.{s}', [0.08 * sg, 0, -0.84], [0.08 * sg, -0.14, -0.97], f'LowerLeg.{s}')
    bone(f'Toes.{s}', [0.08 * sg, -0.14, -0.97], [0.08 * sg, -0.22, -0.98], f'Foot.{s}')
for s, sg in (('L', 1), ('R', -1)):
    bone(f'sway_hairF{s}0', [0.14 * sg, -0.11, 0.58], [0.15 * sg, -0.11, 0.42], 'Head', True)
    bone(f'sway_hairF{s}1', [0.15 * sg, -0.11, 0.42], [0.14 * sg, -0.10, 0.30], f'sway_hairF{s}0', True)
    bone(f'sway_coat{s}0', [0.26 * sg, 0, 0.05], [0.28 * sg, 0, -0.06], 'Spine', True)
    bone(f'sway_coat{s}1', [0.28 * sg, 0, -0.06], [0.28 * sg, 0, -0.15], f'sway_coat{s}0', True)
bone('sway_hairB0', [0, 0.12, 0.78], [0, 0.15, 0.58], 'Head', True)
bone('sway_hairB1', [0, 0.15, 0.58], [0, 0.14, 0.40], 'sway_hairB0', True)
bone('sway_coatB0', [0, 0.13, 0.0], [0, 0.15, -0.10], 'Spine', True)
bone('sway_coatB1', [0, 0.15, -0.10], [0, 0.16, -0.20], 'sway_coatB0', True)
print(json.dumps({'bones': B}))
