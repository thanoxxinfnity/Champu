"""Retarget a BVH motion-capture clip (e.g. the CMU database, cgspeed BVH release) onto PoseLib parameters, so real mocap drives the game rig.

    python3 tools/bvh_to_pose.py in.bvh out.json [start_s] [end_s] [fps]     # write a clip
    python3 tools/bvh_to_pose.py in.bvh --scan                               # print a timeline (feet/hands) to find the moves

Works on joint *positions* (forward kinematics), then turns each limb into a direction in a body frame that follows the hips' yaw, which is
exactly what RigAnimator wants (+X left, +Y up, +Z forward; right side mirrored). Torso lean/roll/twist, head pitch and a scaled crouch and
travel come from the spine and the hips."""
import json, math, sys
import numpy as np

def parse(path):
    lines = open(path).read().split('\n')
    joints, stack, i = [], [], 0
    while not lines[i].strip().startswith('MOTION'):
        t = lines[i].strip().split()
        if t and t[0] in ('ROOT', 'JOINT'):
            joints.append({'name': t[1], 'parent': stack[-1] if stack else -1, 'offset': None, 'channels': []})
            cur = len(joints) - 1
        elif t and t[0] == 'End':
            joints.append({'name': joints[stack[-1]]['name'] + '_end', 'parent': stack[-1], 'offset': None, 'channels': []})
            cur = len(joints) - 1
        elif t and t[0] == '{':
            stack.append(cur)
        elif t and t[0] == '}':
            stack.pop()
        elif t and t[0] == 'OFFSET':
            joints[stack[-1]]['offset'] = np.array([float(v) for v in t[1:4]])
        elif t and t[0] == 'CHANNELS':
            joints[stack[-1]]['channels'] = t[2:]
        i += 1
    nframes = int(lines[i + 1].split()[-1])
    ft = float(lines[i + 2].split()[-1])
    data = np.array([[float(v) for v in l.split()] for l in lines[i + 3:i + 3 + nframes] if l.strip()])
    return joints, data, ft

def rot(axis, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    if axis == 'X': return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 'Y': return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

def fk(joints, frame):
    pos = [None] * len(joints); R = [None] * len(joints); k = 0
    for j, jt in enumerate(joints):
        local_r = np.eye(3); local_t = jt['offset'].copy()
        for ch in jt['channels']:
            v = frame[k]; k += 1
            if ch.endswith('position'):
                local_t = local_t * 0 + local_t  # offsets are replaced by root position below
                local_t[['X', 'Y', 'Z'].index(ch[0])] = v if jt['parent'] == -1 else local_t[['X', 'Y', 'Z'].index(ch[0])]
            else:
                local_r = local_r @ rot(ch[0], v)
        if jt['parent'] == -1:
            R[j] = local_r; pos[j] = local_t
        else:
            p = jt['parent']; R[j] = R[p] @ local_r; pos[j] = pos[p] + R[p] @ jt['offset']
    return pos

def norm(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else np.array([0.0, -1.0, 0.0])

def main():
    path = sys.argv[1]
    joints, data, ft = parse(path)
    idx = {j['name']: i for i, j in enumerate(joints)}
    P = lambda f, n: f[idx[n]]
    scan = '--scan' in sys.argv
    args = [a for a in sys.argv[2:] if a != '--scan']
    out = None if scan else args[0]
    t0 = float(args[1]) if len(args) > 1 else 0.0
    t1 = float(args[2]) if len(args) > 2 else len(data) * ft
    fps = float(args[3]) if len(args) > 3 else 30.0
    first = fk(joints, data[0])
    hip_h0 = P(first, 'Hips')[1] - min(P(first, 'LeftToeBase')[1], P(first, 'RightToeBase')[1])
    if scan:
        step = max(1, int(0.25 / ft))
        for fi in range(0, len(data), step):
            f = fk(joints, data[fi]); floor = min(P(f, 'LeftToeBase')[1], P(f, 'RightToeBase')[1])
            lf = P(f, 'LeftUpLeg') - P(f, 'RightUpLeg'); lf[1] = 0; lf = norm(lf); fw = norm(np.cross(lf, np.array([0.0, 1, 0])))
            rl = (P(f, 'LeftHand') - P(f, 'Hips')) @ fw / hip_h0; rr = (P(f, 'RightHand') - P(f, 'Hips')) @ fw / hip_h0
            print('%6.2fs reachL %5.2f reachR %5.2f  footL %5.2f footR %5.2f  handL %5.2f handR %5.2f  hips %5.2f' % (fi * ft, rl, rr,
                (P(f, 'LeftFoot')[1] - floor) / hip_h0, (P(f, 'RightFoot')[1] - floor) / hip_h0,
                (P(f, 'LeftHand')[1] - floor) / hip_h0, (P(f, 'RightHand')[1] - floor) / hip_h0, (P(f, 'Hips')[1] - floor) / hip_h0))
        return
    frames = []
    start_root = None
    n_out = int((t1 - t0) * fps)
    for k in range(n_out):
        fi = min(len(data) - 1, int((t0 + k / fps) / ft))
        f = fk(joints, data[fi])
        left = P(f, 'LeftUpLeg') - P(f, 'RightUpLeg'); left[1] = 0.0; left = norm(left)
        up = np.array([0.0, 1.0, 0.0]); fwd = norm(np.cross(left, up))
        B = lambda v: np.array([v @ left, v @ up, v @ fwd])        # world -> body frame (+X left, +Y up, +Z forward)
        mir = lambda v: [-v[0], v[1], v[2]]
        spine = B(norm(P(f, 'Neck') - P(f, 'Hips')))
        lean = math.degrees(math.atan2(spine[2], spine[1])); roll = math.degrees(math.atan2(spine[0], spine[1]))
        sh = B(P(f, 'LeftArm') - P(f, 'RightArm')); twist = math.degrees(math.atan2(-sh[2], sh[0]))
        hv = B(norm(P(f, 'Head') - P(f, 'Neck'))); head = math.degrees(math.atan2(hv[2], hv[1])) - lean
        floor = min(P(f, 'LeftToeBase')[1], P(f, 'RightToeBase')[1])
        root = P(f, 'Hips')
        if start_root is None:
            start_root = root.copy(); start_fwd = fwd.copy(); start_left = left.copy()
        travel = root - start_root
        scale = 0.95 / hip_h0                                      # our characters' hips are ~0.95 m up
        d = lambda a, b: [round(float(c), 4) for c in B(norm(P(f, b) - P(f, a)))]
        frame = {'lean': round(lean, 2), 'roll': round(roll, 2), 'twist': round(twist, 2), 'head': round(head, 2),
                 'crouch': round(float(np.clip((hip_h0 - (root[1] - min(floor, P(first, 'LeftToeBase')[1]))) * scale, -0.6, 0.8)), 3),
                 'hz': round(float(np.clip(travel @ start_fwd * scale, -1.2, 1.2)), 3), 'hx': round(float(np.clip(travel @ start_left * scale, -1.0, 1.0)), 3),
                 'uL': d('LeftArm', 'LeftForeArm'), 'fL': d('LeftForeArm', 'LeftHand'),
                 'uR': mir(d('RightArm', 'RightForeArm')), 'fR': mir(d('RightForeArm', 'RightHand')),
                 'tL': d('LeftUpLeg', 'LeftLeg'), 'sL': d('LeftLeg', 'LeftFoot'), 'ftL': d('LeftFoot', 'LeftToeBase'),
                 'tR': mir(d('RightUpLeg', 'RightLeg')), 'sR': mir(d('RightLeg', 'RightFoot')), 'ftR': mir(d('RightFoot', 'RightToeBase'))}
        frames.append(frame)
    json.dump({'fps': fps, 'frames': frames, 'source': path.split('/')[-1], 'range': [t0, t1]}, open(out, 'w'))
    print(out, len(frames), 'frames')

main()
