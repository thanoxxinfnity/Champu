"""MDM joints (frames, 22, 3) -> a PoseLib clip JSON the game plays (assets/anim/<name>.json, read by AnimClip).
    python tools/joints_to_clip.py in_dir out_dir
Every limb direction is expressed in the pelvis frame (+X = the character's left, +Y up, +Z forward), exactly the space RigAnimator uses,
so one clip drives every character whatever its bones look like. Root translation is dropped (the game moves the body); its average speed
is stored so walk/run playback can be matched to the character's real speed. Cyclic clips are cut at their best loop point and cross-faded."""
import json, os, sys
import numpy as np

# SMPL 22-joint order
PELVIS, LHIP, RHIP, SPINE1, LKNEE, RKNEE, SPINE2, LANK, RANK, SPINE3, LFOOT, RFOOT, NECK, LCOL, RCOL, HEAD, LSH, RSH, LELB, RELB, LWR, RWR = range(22)
SMPL_HEIGHT = 1.7
HEAD_BIAS = 50.0
LOOPS = {'walk', 'run', 'idle', 'scared', 'limp_walk', 'talk'}
SWINGS = {'swing1', 'swing2', 'swing3', 'throw'}
HOLD_END = {'death'}
# MDM walks and runs nearly in place, so the root displacement says nothing about pace: use the gait's natural speeds (m/s).
NOMINAL_SPEED = {'walk': 1.3, 'limp_walk': 0.9, 'run': 3.6}


def unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-8)


def smooth(a, k=3):
    if len(a) < k + 2:
        return a
    pad = k // 2
    p = np.concatenate([np.repeat(a[:1], pad, 0), a, np.repeat(a[-1:], pad, 0)])
    return np.stack([p[i:i + len(a)] for i in range(k)]).mean(0)


def frames_of(j):
    """per-frame pose parameters from joints (T,22,3)"""
    j = smooth(j.astype(np.float64), 3)
    T = len(j)
    across = j[:, LHIP] - j[:, RHIP]
    across[:, 1] = 0
    X = unit(across)
    Y = np.tile(np.array([0.0, 1.0, 0.0]), (T, 1))
    Z = unit(np.cross(X, Y))

    def loc(v):
        return np.stack([(v * X).sum(1), (v * Y).sum(1), (v * Z).sum(1)], 1)

    def d(a, b):
        return unit(loc(j[:, b] - j[:, a]))

    spine = d(PELVIS, NECK)
    lean = np.degrees(np.arctan2(spine[:, 2], spine[:, 1]))
    roll = np.degrees(np.arcsin(np.clip(spine[:, 0], -1, 1)))
    sh = loc(j[:, LSH] - j[:, RSH])
    twist = np.degrees(np.arctan2(-sh[:, 2], sh[:, 0]))
    head_v = d(NECK, HEAD)
    # SMPL's neck->head joint vector already points ~50 degrees forward at rest; PoseLib adds `head` to 0.1 x lean on the head bone
    head = np.clip(np.degrees(np.arctan2(head_v[:, 2], head_v[:, 1])) - HEAD_BIAS - lean * 0.1, -40.0, 40.0)
    stand = np.percentile(j[:, PELVIS, 1], 90)
    crouch = (stand - j[:, PELVIS, 1]) / SMPL_HEIGHT
    mir = lambda v: v * np.array([-1.0, 1.0, 1.0])
    def leg(a, b, mirror=False):
        v = d(a, b) * np.array([0.5, 1.0, 1.0])   # SMPL's hips are wider than ours: damp the sideways splay so the stance is not bow-legged
        v = unit(v)
        return mir(v) if mirror else v

    out = {
        'lean': lean, 'twist': twist, 'roll': roll, 'head': head, 'crouch': crouch, 'hx': np.zeros(T), 'hz': np.zeros(T),
        'uL': d(LSH, LELB), 'fL': d(LELB, LWR), 'uR': mir(d(RSH, RELB)), 'fR': mir(d(RELB, RWR)),
        'tL': leg(LHIP, LKNEE), 'sL': leg(LKNEE, LANK), 'ftL': d(LANK, LFOOT),
        'tR': leg(RHIP, RKNEE, True), 'sR': leg(RKNEE, RANK, True), 'ftR': mir(d(RANK, RFOOT)),
    }
    root = j[:, PELVIS, [0, 2]]
    speed = np.linalg.norm(root[-1] - root[0]) / max((T - 1) / 20.0, 1e-3)
    wrist_speed = np.linalg.norm(np.diff(j[:, RWR] - j[:, PELVIS], axis=0), axis=1)
    return out, speed, wrist_speed


def vec_keys(out):
    return [k for k, v in out.items() if v.ndim == 2]


def feature(out, i):
    return np.concatenate([out[k][i] if out[k].ndim == 2 else [out[k][i] / 60.0] for k in out])


def best_loop(out, T, min_len=16, gait=False):
    """Cut point pair (a, b) whose end pose matches its start. For gaits the window must contain real leg swing: MDM walks and runs
    usually begin standing still, and the quietest window would otherwise win."""
    swing = out['tL'][:, 2] - out['tR'][:, 2]
    best, pair = 1e9, (0, T - 1)
    for a in range(0, max(1, T - min_len)):
        fa = feature(out, a)
        for b in range(a + min_len, min(T, a + 44)):
            c = np.linalg.norm(feature(out, b) - fa)
            if gait:
                energy = float(np.std(swing[a:b + 1]))
                c += max(0.0, 0.35 - energy) * 6.0
            if c < best:
                best, pair = c, (a, b)
    return pair, best


def slice_clip(out, a, b):
    return {k: v[a:b + 1] for k, v in out.items()}


def crossfade(out, n=4):
    T = len(next(iter(out.values())))
    n = min(n, T // 3)
    for k, v in out.items():
        for i in range(n):
            w = (i + 1) / (n + 1)
            v[T - n + i] = v[T - n + i] * (1 - w) + v[i] * w
    return out


def to_json(name, out, speed, loop, hold=False):
    T = len(next(iter(out.values())))
    frames = []
    for i in range(T):
        f = {}
        for k, v in out.items():
            f[k] = [round(float(x), 4) for x in v[i]] if v.ndim == 2 else round(float(v[i]), 3)
        frames.append(f)
    speed = NOMINAL_SPEED.get(name, float(speed) * 1.6 / SMPL_HEIGHT)
    return {'name': name, 'fps': 20, 'loop': loop, 'hold': hold, 'speed': round(float(speed), 3), 'frames': frames}


def main():
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    for fn in sorted(os.listdir(src)):
        if not fn.endswith('.npy'):
            continue
        name = fn[:-4]
        j = np.load(os.path.join(src, fn))
        out, speed, wrist = frames_of(j)
        T = len(j)
        loop = name in LOOPS
        if loop:
            (a, b), cost = best_loop(out, T, 16, name in ('walk', 'run', 'limp_walk'))
            out = slice_clip(out, a, b)
            out = crossfade(out)
            note = 'loop %d..%d cost %.2f' % (a, b, cost)
        elif name in SWINGS:
            p = int(np.argmax(np.convolve(wrist, np.ones(3) / 3, mode='same'))) + 1
            a, b = (max(0, p - 8), min(T - 1, p + 6)) if name == 'throw' else (max(0, p - 6), min(T - 1, p + 9))
            out = slice_clip(out, a, b)
            note = 'swing peak %d -> %d..%d' % (p, a, b)
        elif name == 'shoot':
            reach = np.linalg.norm(j[:, RWR, [0, 2]] - j[:, PELVIS, [0, 2]], axis=1)
            m = int(np.argmax(reach))
            out = slice_clip(out, max(0, m - 1), min(T - 1, m + 1)); note = 'aim frame %d' % m
        elif name == 'roll':
            low = np.where(out['crouch'] > 0.12)[0]
            if len(low) > 4:
                out = slice_clip(out, max(0, low[0] - 4), min(T - 1, low[-1] + 4)); note = 'roll low %d..%d' % (low[0], low[-1])
            else:
                note = 'roll full'
        elif name == 'hurt':
            out = slice_clip(out, 0, min(T - 1, 16)); note = 'hurt 0..16'
        elif name == 'death':
            out = slice_clip(out, 0, T - 1); note = 'death full'
        else:
            note = 'full'
        data = to_json(name, out, speed, loop, name in HOLD_END)
        json.dump(data, open(os.path.join(dst, name + '.json'), 'w'), separators=(',', ':'))
        print(name, len(data['frames']), 'frames', 'speed %.2f' % data['speed'], note)


if __name__ == '__main__':
    main()
