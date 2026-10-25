"""Gojo vs Sukuna: a short rigged animation with the game's own models, pose library and motion-capture clips, built and rendered in Blender.

    blender -b -P tools/fight_anim.py -- --out /tmp/fight          # build /tmp/fight/fight.blend and render every frame
    blender -b -P tools/fight_anim.py -- --out /tmp/fight --only 96,120,200   # render just those frames (a quick look)
    blender -b -P tools/fight_anim.py -- --out /tmp/fight --build-only        # only the .blend

Models: examples/jjk-arena/assets/characters/gojo_free.glb and meguna.glb (the Sukuna of the game). Motion: assets/anim/mc_*.json (CMU mocap) for the
stance, run, jab, cross, hook, kicks and fall; hand-written poses for the hits, the "Red" sign, the slash, the guard and Hollow Purple. Fan project,
non-commercial; see jjk-models/README.md for credits.
"""
import math
import os
import random
import sys

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fight_rig as fr  # noqa: E402

FPS = 24
DURATION = 13.5
FRAMES = int(DURATION * FPS)
RES = (854, 480)
SAMPLES = 14

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[args.index('--out') + 1] if '--out' in args else '/tmp/fight'
ONLY = [int(x) for x in args[args.index('--only') + 1].split(',')] if '--only' in args else None
BUILD_ONLY = '--build-only' in args

# ── hand-written poses (left-side parameters; the right side is mirrored by the pose builder) ────────────────────────────────────────────────
HIT1 = {'lean': -16, 'head': -14, 'twist': -12, 'crouch': 0.03, 'uL': (0.55, -0.55, -0.35), 'fL': (0.45, -0.1, -0.85), 'uR': (0.5, -0.6, -0.1), 'fR': (0.3, -0.2, -0.9),
        'tL': (0.2, -1.0, 0.1), 'sL': (0.1, -1.0, -0.2), 'tR': (0.1, -1.0, -0.3), 'sR': (0.1, -1.0, -0.1)}
HIT2 = {'lean': -26, 'head': -22, 'twist': 16, 'roll': 8, 'crouch': 0.08, 'uL': (0.8, -0.2, -0.5), 'fL': (0.7, 0.2, -0.7), 'uR': (0.7, -0.4, -0.5), 'fR': (0.5, 0.0, -0.9),
        'tL': (0.3, -1.0, 0.25), 'sL': (0.2, -1.0, -0.3), 'tR': (0.0, -1.0, -0.5), 'sR': (0.0, -1.0, -0.2)}
GUARD = {'lean': 8, 'crouch': 0.1, 'uL': (0.2, -0.15, 0.95), 'fL': (-0.25, 0.85, 0.45), 'uR': (0.2, -0.15, 0.95), 'fR': (-0.25, 0.85, 0.45),
         'tL': (0.35, -0.85, 0.45), 'sL': (0.2, -0.9, -0.4), 'tR': (-0.05, -0.9, -0.4), 'sR': (0.0, -1.0, -0.2)}
RED = {'lean': 4, 'twist': -10, 'crouch': 0.05, 'uR': (0.12, 0.02, 1.0), 'fR': (0.1, 0.12, 1.0), 'uL': (0.4, -0.75, 0.25), 'fL': (0.15, 0.7, 0.65),
       'tL': (0.3, -0.85, 0.45), 'sL': (0.2, -0.9, -0.4), 'tR': (-0.05, -0.9, -0.4), 'sR': (0.0, -1.0, -0.25)}
RED_CURL = {'R': {'thumb': [30, 40, 30], 'index': [0, 0, 0], 'middle': [80, 95, 70], 'ring': [84, 95, 70], 'pinky': [86, 95, 70]}}
SIGN = {'lean': 6, 'crouch': 0.04, 'uL': (0.2, -0.45, 0.85), 'fL': (-0.35, 0.45, 0.8), 'uR': (0.2, -0.45, 0.85), 'fR': (-0.35, 0.45, 0.8),
        'tL': (0.2, -1.0, 0.1), 'sL': (0.1, -1.0, -0.1), 'tR': (0.1, -1.0, -0.1), 'sR': (0.1, -1.0, -0.1)}
SIGN_CURL = {s: {'index': [10, 20, 10], 'middle': [60, 80, 50], 'ring': [60, 80, 50], 'pinky': [60, 80, 50], 'thumb': [20, 20, 20]} for s in 'LR'}
WIND = {'lean': -8, 'twist': 25, 'crouch': 0.06, 'uR': (0.15, 0.95, 0.1), 'fR': (0.0, 0.9, -0.35), 'uL': (0.5, -0.4, 0.4), 'fL': (0.3, 0.3, 0.8),
        'tL': (0.35, -0.85, 0.45), 'sL': (0.2, -0.9, -0.45), 'tR': (-0.05, -0.9, -0.4), 'sR': (0.0, -1.0, -0.25)}
SWEEP = {'lean': 22, 'twist': -35, 'crouch': 0.1, 'uR': (0.3, -0.35, 0.9), 'fR': (0.2, -0.45, 0.85), 'uL': (0.45, -0.5, 0.3), 'fL': (0.3, 0.3, 0.8),
         'tL': (0.4, -0.8, 0.55), 'sL': (0.25, -0.9, -0.4), 'tR': (-0.05, -0.9, -0.5), 'sR': (0.0, -1.0, -0.2)}
SPREAD = {'lean': 2, 'uL': (0.75, -0.1, 0.65), 'fL': (0.85, 0.1, 0.5), 'uR': (0.75, -0.1, 0.65), 'fR': (0.85, 0.1, 0.5)}
JOIN = {'lean': 6, 'uL': (0.2, -0.1, 1.0), 'fL': (0.0, 0.05, 1.0), 'uR': (0.2, -0.1, 1.0), 'fR': (0.0, 0.05, 1.0)}
FIRE_POSE = {'lean': 10, 'uL': (0.15, -0.05, 1.0), 'fL': (0.0, 0.0, 1.0), 'uR': (0.15, -0.05, 1.0), 'fR': (0.0, 0.0, 1.0)}
LYING = None  # the last frame of mc_fall


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def lerp(a, b, w):
    return a + (b - a) * w


def lerp3(a, b, w):
    return tuple(lerp(x, y, w) for x, y in zip(a, b))


def key_params(keys, t):
    """keys: [(time, params)], smooth blend between neighbours."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
        if t < t1:
            return fr.mix(p0, p1, smooth((t - t0) / (t1 - t0)))
    return keys[-1][1]


# ── the scene ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def material(name, color, strength=1.0, emit=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if emit:
        e = nt.nodes.new('ShaderNodeEmission')
        e.inputs[0].default_value = (*color, 1)
        e.inputs[1].default_value = strength
        nt.links.new(e.outputs[0], out.inputs[0])
    else:
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        b.inputs[0].default_value = (*color, 1)
        b.inputs['Roughness'].default_value = 0.55
        nt.links.new(b.outputs[0], out.inputs[0])
    return m


def build_stage(scene):
    w = bpy.data.worlds.new('night')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.012, 0.016, 0.045, 1)
    bg.inputs[1].default_value = 1.0
    scene.world = w
    # ground
    bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, 0))
    ground = bpy.context.object
    ground.name = 'ground'
    ground.data.materials.append(material('asphalt', (0.05, 0.05, 0.06)))
    ground.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.35
    # a ring of dark towers with lit windows
    rnd = random.Random(7)
    win = material('windows', (1.0, 0.75, 0.35), 2.2, emit=True)
    tower = material('tower', (0.02, 0.02, 0.03))
    for i in range(46):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(16, 38)
        h = rnd.uniform(6, 26)
        w_, l_ = rnd.uniform(2.5, 6), rnd.uniform(2.5, 6)
        bpy.ops.mesh.primitive_cube_add(location=(math.cos(a) * d, math.sin(a) * d, h / 2), scale=(w_ / 2, l_ / 2, h / 2))
        b = bpy.context.object
        b.data.materials.append(tower)
        for k in range(int(h // 3)):
            if rnd.random() < 0.55:
                bpy.ops.mesh.primitive_cube_add(location=(b.location.x - math.cos(a) * (w_ / 2 + 0.02), b.location.y - math.sin(a) * (l_ / 2 + 0.02), 2 + k * 3), scale=(0.02 + 0.5 * abs(math.sin(a)), 0.02 + 0.5 * abs(math.cos(a)), 0.55))
                bpy.context.object.data.materials.append(win)
    # moon
    bpy.ops.mesh.primitive_uv_sphere_add(radius=3, location=(-18, 30, 22))
    bpy.context.object.data.materials.append(material('moon', (0.9, 0.95, 1.0), 6.0, emit=True))
    # lights: cold key, warm rim
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(55), math.radians(10), math.radians(-35)))
    bpy.context.object.data.energy = 2.4
    bpy.context.object.data.color = (0.75, 0.82, 1.0)
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(70), 0, math.radians(150)))
    bpy.context.object.data.energy = 1.6
    bpy.context.object.data.color = (1.0, 0.7, 0.5)
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(80), 0, math.radians(0)))
    bpy.context.object.data.energy = 0.9
    bpy.context.object.data.color = (0.8, 0.85, 1.0)
    # compositor: glow on everything bright
    scene.use_nodes = True
    nt = scene.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new('CompositorNodeRLayers')
    gl = nt.nodes.new('CompositorNodeGlare')
    gl.glare_type = 'FOG_GLOW'
    gl.quality = 'MEDIUM'
    gl.threshold = 1.2
    gl.size = 7
    gl.mix = -0.3
    comp = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(rl.outputs['Image'], gl.inputs['Image'])
    nt.links.new(gl.outputs['Image'], comp.inputs['Image'])


class Glow:
    """An emissive object that is shown by scale, so its whole life is keyframed with location and scale."""

    def __init__(self, name, kind, color, strength, light=0.0):
        if kind == 'sphere':
            bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=32, ring_count=16)
        elif kind == 'ring':
            bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.045, major_segments=48, minor_segments=8)
        else:
            bpy.ops.mesh.primitive_cube_add(size=1)
        self.obj = bpy.context.object
        self.obj.name = name
        self.obj.data.materials.append(material(name, color, strength, emit=True))
        self.obj.scale = (0.0001,) * 3
        self.light = None
        if light:
            bpy.ops.object.light_add(type='POINT')
            self.light = bpy.context.object
            self.light.name = name + '_light'
            self.light.data.color = color
            self.light.data.energy = 0
            self.light.data.shadow_soft_size = 0.4
            self.max_light = light

    def set(self, frame, loc, scale, rot=None, light=1.0):
        s = scale if isinstance(scale, (tuple, list)) else (scale,) * 3
        self.obj.location = loc
        self.obj.scale = tuple(max(0.0001, x) for x in s)
        if rot is not None:
            self.obj.rotation_euler = rot
        self.obj.keyframe_insert('location', frame=frame)
        self.obj.keyframe_insert('scale', frame=frame)
        if rot is not None:
            self.obj.keyframe_insert('rotation_euler', frame=frame)
        if self.light:
            self.light.location = loc
            self.light.data.energy = self.max_light * light * (1 if max(self.obj.scale) > 0.01 else 0)
            self.light.keyframe_insert('location', frame=frame)
            self.light.data.keyframe_insert('energy', frame=frame)

    def hide(self, frame):
        self.set(frame, (0, 0, -50), 0.0001, light=0)


def make_shield():
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=48, ring_count=24)
    o = bpy.context.object
    o.name = 'infinity'
    m = bpy.data.materials.new('infinity')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    mixs = nt.nodes.new('ShaderNodeMixShader')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs[0].default_value = (0.25, 0.55, 1.0, 1)
    em.inputs[1].default_value = 3.0
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs[0].default_value = 0.3
    nt.links.new(lw.outputs['Facing'], mixs.inputs[0])  # 0 at the centre, 1 at the rim
    nt.links.new(tr.outputs[0], mixs.inputs[1])
    nt.links.new(em.outputs[0], mixs.inputs[2])
    nt.links.new(mixs.outputs[0], out.inputs[0])
    o.data.materials.append(m)
    o.scale = (0.0001,) * 3
    return o


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 0, FRAMES - 1
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 3
    scene.render.resolution_x, scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Filmic' if 'Filmic' in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items.keys() else 'Standard'
    build_stage(scene)

    A = fr.ARENA
    gojo = fr.import_character(os.path.join(A, 'assets/characters/gojo_free.glb'), 'gojo')
    suk = fr.import_character(os.path.join(A, 'assets/characters/meguna.glb'), 'sukuna')
    for r in (gojo, suk):
        for m in r.meshes:  # keep the anime shading from going flat grey in the night light
            pass
    clips = {n: fr.load_clip(n) for n in ['mc_stance', 'mc_run', 'mc_jab', 'mc_cross', 'mc_hook', 'mc_kick_front', 'mc_kick_round', 'mc_fall', 'fly_hover_gojo']}
    lying = clips['mc_fall']['frames'][-1]

    # effects
    red = Glow('red', 'sphere', (1.0, 0.12, 0.08), 7, light=900)
    blue = Glow('blue', 'sphere', (0.2, 0.45, 1.0), 7, light=900)
    purple = Glow('purple', 'sphere', (0.65, 0.2, 1.0), 7, light=2600)
    rings = [Glow(f'ring{i}', 'ring', (1.0, 0.85, 0.6), 18) for i in range(4)]
    slashes = [Glow(f'slash{i}', 'box', (1.0, 0.95, 0.9), 30) for i in range(3)]
    shield = make_shield()

    # flash overlay stuck to the camera
    bpy.ops.object.camera_add(location=(0, -7, 1.6))
    cam = bpy.context.object
    scene.camera = cam
    cam.data.sensor_width = 36
    bpy.ops.object.empty_add(type='PLAIN_AXES')
    target = bpy.context.object
    target.name = 'look'
    con = cam.constraints.new('TRACK_TO')
    con.target = target
    con.track_axis = 'TRACK_NEGATIVE_Z'
    con.up_axis = 'UP_Y'
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -0.6))
    flash = bpy.context.object
    flash.parent = cam
    flash.name = 'flash'
    fm = bpy.data.materials.new('flash')
    fm.use_nodes = True
    nt = fm.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    mx = nt.nodes.new('ShaderNodeMixShader')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs[1].default_value = 2.5
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    flash.data.materials.append(fm)
    flash_fac = mx.inputs[0]
    flash.visible_shadow = False

    # ── the choreography ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    G0, S0 = -2.4, 2.4
    CONTACT = -0.5   # where Gojo stops to fight
    events = []      # (time, kind) for the sound track

    def gojo_state(t):
        """-> (params, curls, x, z, rot_z_deg, sway)"""
        curls = {}
        x = G0
        z = 0.0
        if t < 2.0:
            p = fr.sample(clips['mc_stance'], t, True)
        elif t < 3.0:
            u = (t - 2.0) / 1.0
            x = lerp(G0, CONTACT, smooth(u) * 0.6 + u * 0.4)
            p = fr.sample(clips['mc_run'], t - 2.0, True)
        elif t < 3.45:
            x = CONTACT
            p = fr.sample(clips['mc_jab'], t - 3.0)
        elif t < 4.1:
            x = CONTACT
            p = fr.sample(clips['mc_cross'], t - 3.45)
        elif t < 4.9:
            u = smooth((t - 4.4) / 0.4)
            x = CONTACT - 0.35 * u if t > 4.4 else CONTACT
            p = fr.mix(fr.sample(clips['mc_stance'], t, True), HIT1, smooth(1 - abs((t - 4.65) / 0.3)) if 4.35 < t < 4.95 else 0)
            x = CONTACT - 0.35 * smooth(min(1, max(0, (t - 4.35) / 0.4)))
        elif t < 6.3:
            x = CONTACT - 0.35
            lt = t - 4.95
            if lt < 0.45:
                p = fr.mix(fr.sample(clips['mc_stance'], t, True), fr.sample(clips['mc_kick_round'], 0.0), smooth(lt / 0.45))
            else:
                p = fr.sample(clips['mc_kick_round'], lt - 0.45)
        elif t < 7.6:
            x = CONTACT - 0.35
            p = key_params([(6.3, fr.sample(clips['mc_stance'], 6.3, True)), (6.9, RED)], t)
            if t > 6.6:
                curls = RED_CURL
        elif t < 8.8:
            x = CONTACT - 0.35
            p = RED if t < 7.7 else key_params([(7.7, RED), (8.2, fr.sample(clips['mc_stance'], t, True))], t)
            curls = RED_CURL if t < 8.0 else {}
        elif t < 10.0:
            x = CONTACT - 0.35
            p = key_params([(8.8, fr.sample(clips['mc_stance'], 8.8, True)), (9.2, SIGN)], t)
            curls = SIGN_CURL if t > 9.0 else {}
        else:
            x = CONTACT - 0.35
            rise = smooth((t - 10.0) / 1.0)
            z = 1.5 * rise
            base = fr.sample(clips['fly_hover_gojo'], t - 10.0, True)
            if t < 11.0:
                p = fr.mix(SIGN, base, rise)
            elif t < 11.7:
                p = key_params([(11.0, base), (11.4, SPREAD), (11.9, JOIN)], t)
            else:
                p = key_params([(11.7, JOIN), (12.1, FIRE_POSE)], t)
            curls = SIGN_CURL if t < 10.6 else {}
        return p, curls, x, z, 90.0, 0.06

    SC = 0.45                # where Sukuna steps in to trade blows
    X2 = SC + 0.42           # pushed back by the hits
    X3 = X2 + 1.9            # thrown by the kick
    X4 = X3 + 0.9            # blown back by Red

    def suk_state(t):
        curls = {}
        x = S0
        z = 0.0
        rz = -90.0
        stance = fr.sample(clips['mc_stance'], t, True)
        if t < 2.4:
            p = stance
        elif t < 3.0:
            x = lerp(S0, SC, smooth((t - 2.4) / 0.6))
            p = stance
        elif t < 3.2:
            x = SC
            p = stance
        elif t < 3.7:
            x = SC + 0.12 * smooth((t - 3.2) / 0.2)
            p = fr.mix(stance, HIT1, smooth(1 - abs((t - 3.4) / 0.3)))
        elif t < 4.2:
            x = SC + 0.12 + 0.3 * smooth((t - 3.7) / 0.3)
            p = fr.mix(stance, HIT2, smooth(1 - abs((t - 3.95) / 0.3)))
        elif t < 4.85:
            x = X2
            p = fr.sample(clips['mc_hook'], t - 4.2)
        elif t < 5.45:
            x = X2
            p = fr.mix(fr.sample(clips['mc_hook'], 0.62), stance, smooth((t - 4.85) / 0.4))
        elif t < 7.5:
            lt = t - 5.45
            # hit by the round kick: thrown back along an arc, the fall clip plays, lies, then gets up
            if lt < 0.9:
                u = lt / 0.9
                x = lerp(X2, X3, smooth(u))
                z = 0.5 * math.sin(u * math.pi)
                p = fr.sample(clips['mc_fall'], lt * 0.9)
            else:
                x = X3
                p = fr.sample(clips['mc_fall'], min(lt * 0.9, 2.06))
                if t > 6.9:
                    p = fr.mix(lying, fr.sample(clips['mc_stance'], t, True), smooth((t - 6.9) / 0.7))
        elif t < 8.0:
            x = X3
            p = stance
        elif t < 8.9:
            u = (t - 7.95) / 0.3
            x = lerp(X3, X4, smooth(min(1, max(0, u))))
            p = fr.mix(stance, HIT2, smooth(1 - abs((t - 8.25) / 0.45)))
        elif t < 10.1:
            x = X4
            p = key_params([(8.9, fr.mix(stance, WIND, 0.0)), (9.4, WIND), (9.65, SWEEP), (10.0, SWEEP)], t)
        elif t < 11.9:
            x = X4
            p = key_params([(10.1, SWEEP), (10.6, stance), (11.4, GUARD)], t)
        else:
            hit = smooth((t - 12.0) / 0.25)
            p = fr.mix(GUARD, HIT2, hit)
            x = X4 + 0.35 * hit
        return p, curls, x, z, rz, 0.10

    def hand_world(rig, bone):
        bpy.context.view_layer.update()
        pb = rig.arm.pose.bones[bone]
        return rig.arm.matrix_world @ pb.tail

    # camera shots: (t0, t1, cam0, cam1, look0, look1, lens)
    shots = [
        (0.0, 2.0, (0, -7.2, 1.7), (0, -5.8, 1.4), (0, 0, 1.1), (0, 0, 1.1), 35),
        (2.0, 3.0, (-2.4, -3.4, 0.9), (-0.2, -3.0, 1.1), (-2.2, 0, 1.0), (-0.6, 0, 1.1), 35),
        (3.0, 4.2, (0.2, -3.7, 1.3), (-0.3, -3.2, 1.3), (0.2, 0, 1.25), (0.3, 0, 1.25), 40),
        (4.2, 4.95, (-1.0, -2.2, 1.5), (-1.1, -2.1, 1.45), (-0.6, 0, 1.4), (-0.6, 0, 1.4), 50),
        (4.95, 6.4, (-0.2, -3.4, 0.5), (1.6, -3.6, 0.8), (0.4, 0, 1.0), (2.4, 0, 0.7), 32),
        (6.4, 7.6, (-1.1, -1.9, 1.4), (-0.7, -1.7, 1.45), (-0.5, 0, 1.4), (-0.3, 0, 1.4), 50),
        (7.6, 8.9, (1.3, -6.8, 1.6), (1.8, -6.3, 1.5), (1.3, 0, 1.2), (1.9, 0, 1.2), 30),
        (8.9, 10.1, (5.2, -2.2, 1.2), (4.5, -2.5, 1.35), (0.8, 0, 1.3), (0.4, 0, 1.3), 38),
        (10.1, 11.5, (-1.9, -3.6, 0.3), (-1.3, -3.1, 0.55), (-0.8, 0, 1.9), (-0.6, 0, 2.2), 28),
        (11.5, 13.5, (0.4, -6.4, 1.9), (1.2, -7.4, 1.9), (1.4, 0, 1.7), (1.9, 0, 1.6), 30),
    ]
    shakes = [(3.2, 0.03), (3.7, 0.05), (4.5, 0.05), (5.5, 0.18), (6.3, 0.1), (7.9, 0.25), (10.55, 0.05), (12.0, 0.45)]
    flashes = [(3.2, 0.03, 0.08), (3.7, 0.04, 0.1), (5.5, 0.08, 0.12), (7.9, 0.3, 0.2), (12.0, 0.35, 0.6)]
    ring_events = [(3.2, (-0.05, 0, 1.3)), (3.7, (0.1, 0, 1.2)), (5.5, (0.9, 0, 1.0)), (7.9, (X3 + 0.3, 0, 1.2)), (12.0, (X4, 0, 1.2))]
    events += [(3.2, 'hit'), (3.7, 'hit'), (4.5, 'hit'), (5.5, 'big'), (6.3, 'thud'), (7.9, 'blast'), (10.55, 'clash'), (12.0, 'purple'), (2.0, 'whoosh'), (3.0, 'whoosh'), (4.95, 'whoosh'), (9.55, 'slash'), (7.6, 'whoosh'), (6.4, 'charge'), (11.0, 'charge2'), (12.0, 'blast')]

    for f in range(FRAMES):
        t = f / FPS
        fr.sway_t[0] = t
        # characters
        for rig, state in ((gojo, gojo_state), (suk, suk_state)):
            p, curls, x, z, rz, sway = state(t)
            spec, hips = fr.build(p)
            rig.pose_at(spec, hips, curls, sway)
            rig.arm.location = (x, 0.0, z + rig.foot_offset)
            rig.arm.rotation_euler = (0, 0, math.radians(rz))
            rig.arm.keyframe_insert('location', frame=f)
            rig.arm.keyframe_insert('rotation_euler', frame=f)
            rig.key(f)
        gx = gojo.arm.location.x
        sx = suk.arm.location.x

        # Gojo's hands, for the orbs
        rh = hand_world(gojo, 'index2R') if 6.3 <= t < 8.0 else None
        # Red
        if 6.5 <= t < 7.7 and rh is not None:
            grow = smooth((t - 6.5) / 1.0)
            red.set(f, tuple(rh + Vector((0.25, 0, 0)) * grow), 0.04 + 0.2 * grow, light=0.5 + grow)
        elif 7.7 <= t < 7.9:
            u = (t - 7.7) / 0.2
            start = hand_world(gojo, 'index2R') if False else Vector((gx + 0.9, 0, 1.35))
            red.set(f, tuple(start.lerp(Vector((sx - 0.5, 0, 1.2)), u)), 0.24, light=1.5)
        elif 7.9 <= t < 8.3:
            u = (t - 7.9) / 0.4
            red.set(f, (sx - 0.4, 0, 1.2), 0.24 + 1.6 * smooth(u), light=3 * (1 - u))
        else:
            red.hide(f)
        # Blue and purple
        if 11.0 <= t < 12.0:
            u = smooth((t - 11.0) / 0.9)
            c = Vector((gx + 0.9, 0, gojo.arm.location.z + 1.25))
            sep = 0.8 * (1 - smooth((t - 11.4) / 0.5))
            if t < 11.9:
                blue.set(f, tuple(c + Vector((0, 0.0, 0)) + Vector((0, sep, 0.0))), 0.05 + 0.2 * u, light=0.6 + u)
                red.set(f, tuple(c - Vector((0, sep, 0.0))), 0.05 + 0.2 * u, light=0.6 + u)
            else:
                blue.hide(f)
        else:
            if not (6.5 <= t < 8.3):
                pass
            if t >= 12.0 or t < 11.0:
                blue.hide(f)
        if 11.9 <= t < 12.4:
            # merge into the purple orb, then it flies
            c = Vector((gx + 0.9, 0, gojo.arm.location.z + 1.25))
            u = smooth((t - 11.9) / 0.1)
            fly = smooth((t - 12.0) / 0.12)
            pos = c.lerp(Vector((sx - 0.3, 0, 1.2)), fly)
            purple.set(f, tuple(pos), 0.3 + 0.35 * u + 1.0 * smooth((t - 12.0) / 0.4), light=1.0)
            if t >= 11.9:
                red.hide(f)
        elif t >= 12.4:
            purple.set(f, (sx - 0.3, 0, 1.2), max(0.001, 1.6 * (1 - smooth((t - 12.4) / 0.5))), light=1.0 - smooth((t - 12.4) / 0.5))
        else:
            purple.hide(f)
        # the Red orb must not linger after the purple one begins (it was reused as the red half)
        if 12.4 <= t:
            red.hide(f)
            blue.hide(f)

        # shield around Gojo
        sh = 0.0
        if 9.0 <= t < 10.2:
            sh = smooth((t - 9.0) / 0.25) * (1.0 - smooth((t - 9.9) / 0.3))
        shield.location = (gx + 0.15, 0, 1.0)
        shield.scale = (max(0.0001, 1.25 * sh),) * 3
        shield.keyframe_insert('location', frame=f)
        shield.keyframe_insert('scale', frame=f)

        # slashes: three crescents from Sukuna toward Gojo, stopped by the shield
        for i, s in enumerate(slashes):
            t0 = 9.55 + i * 0.08
            if t0 <= t < t0 + 0.4:
                u = (t - t0) / 0.4
                travel = min(u * 1.4, 1.0)
                xx = lerp(sx - 0.2, gx + 1.35, smooth(travel))
                alive = 1.0 - smooth((u - 0.55) / 0.45)
                ang = math.radians(-35 + i * 35)
                s.set(f, (xx, 0.0, 1.15 + 0.25 * (i - 1)), (0.04, 1.7 * alive, 0.025 * alive), rot=(ang, 0, 0), light=0)
            else:
                s.hide(f)

        # impact rings
        for i, rg in enumerate(rings):
            if i < len(ring_events):
                tr_, pos = ring_events[i]
                # pick the event for this ring slot by hit order, reuse slots after the first four
                pass
        # ring slots: events assigned round-robin
        live = [(k, ev) for k, ev in enumerate(ring_events) if ev[0] <= t < ev[0] + 0.5]
        for i, rg in enumerate(rings):
            hit = [ev for k, ev in live if k % len(rings) == i]
            if hit:
                et, pos = hit[0]
                u = (t - et) / 0.5
                big = 1.7 if et > 7 else 1.0
                rg.set(f, pos, (0.15 + 1.1 * big * smooth(u),) * 3, rot=(math.radians(90), 0, 0), light=0)
            else:
                rg.hide(f)

        # flash overlay
        fa = 0.0
        for et, peak, length in flashes:
            if et <= t < et + length:
                fa = max(fa, peak * (1 - smooth((t - et) / length)))
        if t > 12.9:
            fa = max(fa, smooth((t - 12.9) / 0.5))
        flash_fac.default_value = fa
        flash_fac.keyframe_insert('default_value', frame=f)

        # camera
        shot = next((s for s in shots if s[0] <= t < s[1]), shots[-1])
        u = (t - shot[0]) / (shot[1] - shot[0])
        cp = Vector(lerp3(shot[2], shot[3], u))
        lp = Vector(lerp3(shot[4], shot[5], u))
        # a moving subject is followed: the look point drifts with whoever runs/flies
        if 2.0 <= t < 3.0:
            lp = Vector((gx + 0.4, 0, 1.0))
            cp = Vector((gx + 0.2, -3.2, 0.9 + 0.15 * u))
        sk = 0.0
        for et, amp in shakes:
            if et <= t < et + 0.35:
                sk = max(sk, amp * (1 - (t - et) / 0.35))
        rnd = random.Random(f)
        cp += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * sk
        cam.location = cp
        target.location = lp
        cam.data.lens = shot[6]
        cam.keyframe_insert('location', frame=f)
        target.keyframe_insert('location', frame=f)
        cam.data.keyframe_insert('lens', frame=f)
        if f % 24 == 0:
            print('built', f, '/', FRAMES, flush=True)

    # cuts, not glides, between shots: constant interpolation on the camera and the look point
    for ob in (cam, target):
        if ob.animation_data and ob.animation_data.action:
            for fc in ob.animation_data.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
    for s in shots[1:]:
        fcurves = []
        for ob in (cam, target):
            if ob.animation_data and ob.animation_data.action:
                fcurves += list(ob.animation_data.action.fcurves)
        if cam.data.animation_data and cam.data.animation_data.action:
            fcurves += list(cam.data.animation_data.action.fcurves)
        cut = int(round(s[0] * FPS))
        for fc in fcurves:
            for kp in fc.keyframe_points:
                if int(round(kp.co[0])) == cut - 1:
                    kp.interpolation = 'CONSTANT'

    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'fight.blend'))
    with open(os.path.join(OUT, 'events.txt'), 'w') as fh:
        for t_, k_ in sorted(events):
            fh.write(f'{t_:.3f} {k_}\n')
    if BUILD_ONLY:
        return
    scene.render.image_settings.file_format = 'PNG'
    frames_dir = os.path.join(OUT, 'frames')
    os.makedirs(frames_dir, exist_ok=True)
    todo = ONLY if ONLY is not None else range(FRAMES)
    for f in todo:
        if os.path.exists(os.path.join(frames_dir, f'{f:04d}.png')):
            continue  # resumable: a frame that exists is not rendered again
        scene.frame_set(f)
        scene.render.filepath = os.path.join(frames_dir, f'{f:04d}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', f, flush=True)


main()
