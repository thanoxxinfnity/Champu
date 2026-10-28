"""Quaternius Universal Animation Library (CC0) -> PoseLib clips the game plays (assets/anim/<name>.json, read by AnimClip).
    blender -b -P tools/ual_to_clips.py -- <UAL.glb> <out_dir> [--only name,name]
Every action of the pack is played on its own rig and sampled at 30 fps; the joint positions become limb directions in the pelvis frame
(+X = the character's left, +Y up, +Z forward), the same space RigAnimator uses, so one clip drives every hero whatever its bones are
(the MMD heroes, the auto-rigged ones and the stand-ins). Root motion is dropped: the game moves the body.
Works on both packs: UAL 1 (Rigify names, DEF-*) and UAL 2 (Unreal names)."""
import sys
import json
import os
import math
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None
FPS = 30

# game clip name -> (action name without the rig suffix, loop, nominal ground speed m/s, hold last frame)
WANT = {
    'idle': ('Idle_Loop', True, 0.0, False), 'walk': ('Walk_Loop', True, 1.4, False), 'run': ('Jog_Fwd_Loop', True, 3.8, False),
    'sprint': ('Sprint_Loop', True, 6.5, False), 'crouch_walk': ('Crouch_Fwd_Loop', True, 1.2, False), 'crouch_idle': ('Crouch_Idle_Loop', True, 0.0, False),
    'jump_start': ('Jump_Start', False, 0.0, True), 'jump_air': ('Jump_Loop', True, 0.0, False), 'jump_land': ('Jump_Land', False, 0.0, False),
    'roll': ('Roll', False, 0.0, False), 'death': ('Death01', False, 0.0, True), 'hit_chest': ('Hit_Chest', False, 0.0, False),
    'hit_head': ('Hit_Head', False, 0.0, False), 'dance': ('Dance_Loop', True, 0.0, False), 'drive': ('Driving_Loop', True, 0.0, False),
    'pistol_idle': ('Pistol_Idle_Loop', True, 0.0, False), 'pistol_shoot': ('Pistol_Shoot', False, 0.0, False), 'pistol_reload': ('Pistol_Reload', False, 0.0, False),
    'punch_jab': ('Punch_Jab', False, 0.0, False), 'punch_cross': ('Punch_Cross', False, 0.0, False), 'sword_idle': ('Sword_Idle', True, 0.0, False),
    'sword_attack': ('Sword_Attack', False, 0.0, False), 'spell_shoot': ('Spell_Simple_Shoot', False, 0.0, False), 'pickup': ('PickUp_Table', False, 0.0, False),
    'interact': ('Interact', False, 0.0, False), 'swim': ('Swim_Fwd_Loop', True, 0.0, False), 'talk': ('Idle_Talking_Loop', True, 0.0, False),
    'sit': ('Sitting_Idle_Loop', True, 0.0, False),
    # pack 2
    'fold_arms': ('Idle_FoldArms_Loop', True, 0.0, False), 'yes': ('Yes', False, 0.0, False), 'no': ('Idle_No_Loop', True, 0.0, False),
    'knockback': ('Hit_Knockback', False, 0.0, False), 'ninja_start': ('NinjaJump_Start', False, 0.0, True), 'ninja_air': ('NinjaJump_Idle_Loop', True, 0.0, False),
    'ninja_land': ('NinjaJump_Land', False, 0.0, False), 'throw': ('OverhandThrow', False, 0.0, False), 'slide': ('Slide_Loop', True, 0.0, False),
    'sword_a': ('Sword_Regular_A', False, 0.0, False), 'sword_b': ('Sword_Regular_B', False, 0.0, False), 'sword_c': ('Sword_Regular_C', False, 0.0, False),
    'sword_combo': ('Sword_Regular_Combo', False, 0.0, False), 'sword_block': ('Sword_Block', False, 0.0, False), 'hook': ('Melee_Hook', False, 0.0, False),
    'shield_idle': ('Idle_Shield_Loop', True, 0.0, False), 'chop': ('TreeChopping_Loop', True, 0.0, False), 'phone': ('Idle_TalkingPhone_Loop', True, 0.0, False),
    'climb': ('ClimbUp_1m_RM', False, 0.0, False), 'open_chest': ('Chest_Open', False, 0.0, False), 'consume': ('Consume', False, 0.0, False),
    'carry_walk': ('Walk_Carry_Loop', True, 1.2, False), 'z_walk': ('Zombie_Walk_Fwd_Loop', True, 1.0, False), 'z_idle': ('Zombie_Idle_Loop', True, 0.0, False),
    'z_scratch': ('Zombie_Scratch', False, 0.0, False), 'stand_up': ('LayToIdle', False, 0.0, False),
}

# the joints the pose needs, by bone (head of the bone unless noted) for the two naming schemes
J1 = {'pelvis': 'DEF-hips', 'hipL': 'DEF-thigh.L', 'hipR': 'DEF-thigh.R', 'kneeL': 'DEF-shin.L', 'kneeR': 'DEF-shin.R', 'ankL': 'DEF-foot.L', 'ankR': 'DEF-foot.R',
      'toeL': 'DEF-toe.L', 'toeR': 'DEF-toe.R', 'neck': 'DEF-neck', 'head': 'DEF-head', 'shL': 'DEF-upper_arm.L', 'shR': 'DEF-upper_arm.R',
      'elbL': 'DEF-forearm.L', 'elbR': 'DEF-forearm.R', 'wrL': 'DEF-hand.L', 'wrR': 'DEF-hand.R'}
J2 = {'pelvis': 'pelvis', 'hipL': 'thigh_l', 'hipR': 'thigh_r', 'kneeL': 'calf_l', 'kneeR': 'calf_r', 'ankL': 'foot_l', 'ankR': 'foot_r',
      'toeL': 'ball_l', 'toeR': 'ball_r', 'neck': 'neck_01', 'head': 'Head', 'shL': 'upperarm_l', 'shR': 'upperarm_r',
      'elbL': 'lowerarm_l', 'elbR': 'lowerarm_r', 'wrL': 'hand_l', 'wrR': 'hand_r'}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
J = J1 if 'DEF-hips' in rig.data.bones else J2
scn = bpy.context.scene
scn.render.fps = FPS
if rig.animation_data is None:
    rig.animation_data_create()
os.makedirs(dst, exist_ok=True)


def unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-8)


def sample(action):
    rig.animation_data.action = action
    a0, a1 = action.frame_range
    # glTF actions keep their own rate: Blender imports them at the scene rate it had (24); time is frames / 24
    src_fps = 24.0
    dur = (a1 - a0) / src_fps
    n = max(2, int(round(dur * FPS)))
    out = []
    mw = rig.matrix_world
    for i in range(n + 1):
        f = a0 + (i / FPS) * src_fps
        scn.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
        row = {}
        for k, b in J.items():
            pb = rig.pose.bones[b]
            p = mw @ pb.head
            if k == 'head':
                p = mw @ ((pb.head + pb.tail) * 0.5)
            row[k] = (p.x, p.z, -p.y)               # Blender Z-up -> Y-up
        out.append(row)
    return {k: np.array([r[k] for r in out]) for k in J}


SOFT = {'run': 0.3, 'sprint': 0.22, 'crouch_walk': 0.0}   # the pack's jog is a deep athletic lunge: a little more upright reads better in a coat or a skirt
CUR = ['']
AIRBORNE = {'jump_air', 'ninja_air', 'swim'}       # in the air: the legs tuck, the body does not sink
REST = {}          # the pack's own standing pose (its T-pose action): lean, head tilt and hip height are measured from it


def params(j):
    T = len(j['pelvis'])
    across = j['hipL'] - j['hipR']
    across[:, 1] = 0
    X = unit(across)
    Y = np.tile(np.array([0.0, 1.0, 0.0]), (T, 1))
    Z = unit(np.cross(X, Y))

    def loc(v):
        return np.stack([(v * X).sum(1), (v * Y).sum(1), (v * Z).sum(1)], 1)

    def d(a, b):
        return unit(loc(j[b] - j[a]))

    mir = lambda v: v * np.array([-1.0, 1.0, 1.0])
    leg = lambda v: unit(v * np.array([0.6, 1.0, 1.0]))      # the mannequin stands wider than our heroes: less sideways splay, no bow legs
    spine = d('pelvis', 'neck')
    lean = np.degrees(np.arctan2(spine[:, 2], spine[:, 1]))
    roll = np.degrees(np.arcsin(np.clip(spine[:, 0], -1, 1)))
    sh = loc(j['shL'] - j['shR'])
    twist = np.degrees(np.arctan2(-sh[:, 2], sh[:, 0]))
    hv = d('neck', 'head')
    tilt = np.degrees(np.arctan2(hv[:, 2], hv[:, 1]))
    leg_len = np.linalg.norm(j['hipL'][0] - j['kneeL'][0]) + np.linalg.norm(j['kneeL'][0] - j['ankL'][0])
    height = leg_len / 0.47                                       # legs are about 47 % of a body
    pel_y = j['pelvis'][:, 1] - np.minimum(j['ankL'][:, 1], j['ankR'][:, 1])
    if not REST:
        REST.update(lean=float(np.median(lean)), tilt=float(np.median(tilt)), stand=float(np.max(pel_y)))
    # PoseLib stands with a 3 degree lean and a level head; the pack's rest pose maps onto that
    lean = lean - REST['lean'] + 3.0
    head = np.clip(tilt - REST['tilt'] - (lean - 3.0), -40.0, 40.0)
    # The hips drop so the lower foot stays on the ground: the legs' vertical reach (from their directions, thigh and shin ~0.4 m each on a
    # 1.7 m hero) against straight legs. Measuring the pack's pelvis height instead fails in a run's flight phase (both feet up).
    crouch = None
    # Is the action's own rig facing +Z (glTF forward)? The pelvis frame handles it: X = left hip - right hip.
    out = {
        'lean': lean, 'twist': twist, 'roll': roll, 'head': head, 'crouch': np.zeros(T), 'hx': np.zeros(T), 'hz': np.zeros(T),
        'uL': d('shL', 'elbL'), 'fL': d('elbL', 'wrL'), 'uR': mir(d('shR', 'elbR')), 'fR': mir(d('elbR', 'wrR')),
        'tL': leg(d('hipL', 'kneeL')), 'sL': leg(d('kneeL', 'ankL')), 'ftL': d('ankL', 'toeL'),
        'tR': mir(leg(d('hipR', 'kneeR'))), 'sR': mir(leg(d('kneeR', 'ankR'))), 'ftR': mir(d('ankR', 'toeR')),
    }
    soft = SOFT.get(CUR[0], 0.0)
    if soft > 0.0:
        for k in ('tL', 'sL', 'tR', 'sR'):
            out[k] = unit(out[k] * (1.0 - soft) + np.array([0.0, -1.0, 0.0]) * soft)
    reach = np.maximum(-(out['tL'][:, 1] + out['sL'][:, 1]), -(out['tR'][:, 1] + out['sR'][:, 1])) * 0.4
    out['crouch'] = np.clip(0.8 - reach, 0.0, 0.75)
    return out


def to_json(name, p, loop, speed, hold):
    T = len(p['lean'])
    if loop and T > 2:
        T -= 1                                                      # the last frame of a loop repeats the first
    frames = []
    for i in range(T):
        f = {}
        for k, v in p.items():
            f[k] = [round(float(x), 4) for x in v[i]] if v.ndim == 2 else round(float(v[i]), 3)
        frames.append(f)
    return {'name': name, 'fps': FPS, 'loop': loop, 'hold': hold, 'speed': speed, 'src': 'Quaternius UAL (CC0)', 'frames': frames}


acts = {a.name.rsplit('_', 1)[0]: a for a in bpy.data.actions}
params(sample(acts['A_TPose']))
print('REST', {k: round(v, 3) for k, v in REST.items()})
done = []
for name, (act, loop, speed, hold) in WANT.items():
    if only is not None and name not in only:
        continue
    if act not in acts:
        continue
    CUR[0] = name
    p = params(sample(acts[act]))
    if name in AIRBORNE:
        p['crouch'] = np.zeros(len(p['crouch']))
    with open(os.path.join(dst, name + '.json'), 'w') as fh:
        json.dump(to_json(name, p, loop, speed, hold), fh, separators=(',', ':'))
    done.append('%s(%d)' % (name, len(p['lean'])))
print('CLIPS', len(done), ' '.join(done))
