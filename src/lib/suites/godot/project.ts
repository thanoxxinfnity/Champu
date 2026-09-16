/**
 * A Godot 4 project, generated whole.
 *
 * The target is the Godot Android editor: a user opens the extracted folder on
 * their phone and presses play. That sets the bar — a project that imports but
 * does not run is a failed build, the same rule the Minecraft suite follows.
 *
 * Three things decide whether it runs, and each has been got wrong by hand
 * before:
 *   - `project.godot` must declare a `config_version` and a `run/main_scene`
 *     that actually exists, or Godot opens an empty editor;
 *   - a `.tscn` header's `load_steps` must match the number of resources in the
 *     file, or the scene loads with missing nodes;
 *   - every `ExtResource` id referenced by a node must be declared above it.
 *
 * Pure: returns a file map. Zipping and downloading happen elsewhere.
 */

import { animatorScript, effectsScript, pickupScript } from './effects.ts';
import { SHOOTER_TOUCH, touchControlsNode, touchControlsScript } from './touch.ts';
import { cityBlock, describeBlock, tiltedBasis } from './layout.ts';
import { campaign, describeMissions, missionData, missionRunner, missionSelect } from './missions.ts';
import {
  directorScript,
  enemyScript,
  hudScript,
  lookScript,
  shooterInput,
  shooterPlayerScript,
  weaponScript,
  wiringScript,
} from './shooter.ts';

/** Whether this spec describes a game the shooter scaffold should build. */
export function isShooter(spec: GameSpec): boolean {
  return spec.genre === 'shooter' && (spec.dimension ?? '3d') === '3d';
}

export interface GodotFile {
  path: string;
  content: string;
}

export interface GameSpec {
  /** Shown in the Godot project list and the window title. */
  name: string;
  /** 3D is the default; a 2D game uses Node2D and a different camera. */
  dimension?: '2d' | '3d';
  /**
   * What kind of game this is, straight off the plan.
   *
   * Read, not decorative: asking the suite for a zombie survival shooter used to
   * produce the same character-in-a-field project as asking it for anything
   * else, because the plan said `shooter` and nothing downstream looked.
   */
  genre?: string;
  /** Where the camera sits. `first-person` puts it in the player's head. */
  view?: string;
  /**
   * Real models to stand in for the cover boxes.
   *
   * An arena built out of cubes reads as a placeholder however well it plays,
   * and the crates are the thing the player spends the whole match standing
   * behind. Given any, they are cycled through the cover positions; given none,
   * the boxes stay, because a box is better than a hole.
   */
  props?: Array<{
    path: string;
    /** Metres, after `scale`. The collision box is cut to fit it. */
    size: [number, number, number];
    /** Where the model's own floor sits relative to its origin, from the glTF. */
    baseY?: number;
    scale?: number;
  }>;
  /** Models to place in the scene, as res:// paths to .glb files. */
  models?: Array<{
    path: string;
    node: string;
    at?: [number, number, number];
    /**
     * A skinned model with a skeleton. Parented to the player and given the
     * animation script, so it walks rather than standing there.
     */
    rigged?: boolean;
  }>;
  /**
   * Generate a soundtrack and sound effects.
   *
   * On by default: a silent game is the loudest sign that something is a tech
   * demo rather than a game, and it is the one gap the language model cannot
   * fill because it cannot emit a binary.
   */
  music?: boolean;
  /** Themed stages. Without any, the project is one endless zone. */
  zones?: Array<{ name: string; from: number }>;
}

/**
 * Which way up the phone is held.
 *
 * Godot's `display/window/handheld/orientation` is an enum, not a boolean:
 * `Landscape, Portrait, Reverse Landscape, Reverse Portrait, Sensor Landscape,
 * Sensor Portrait, Sensor` — so **0 is landscape and 1 is portrait**. Every
 * project this suite produced was written with `1`, which locked a shooter
 * designed at 1152x648 into portrait on the device. Half the screen was sky,
 * the controls were off the bottom edge, and the fire button was nowhere.
 *
 * It is decided by how the game is *played*, not by taste:
 *
 *   - **Landscape** for anything you aim, steer or explore in. Two thumbs at
 *     the edges, the horizon wide, and the middle of the screen left clear for
 *     the thing you are aiming at.
 *   - **Portrait** for anything played on one axis with one thumb — an endless
 *     runner, a tapper, a vertical arcade game. Landscape there wastes the
 *     screen sideways and puts the lane you care about in a letterbox.
 *
 * Sensor variants rather than fixed ones, so the phone can be held either way
 * up and left-handed players are not upside down.
 */
export type Orientation = 'landscape' | 'portrait';

const ORIENTATION_VALUES: Record<Orientation, number> = {
  // Sensor Landscape / Sensor Portrait: the axis is fixed, the way round is not.
  landscape: 4,
  portrait: 5,
};

/** Genres played on one axis with one thumb. Everything else is landscape. */
const PORTRAIT_GENRES = ['runner', 'endless-runner', 'endless', 'tapper', 'clicker', 'puzzle', 'match-3', 'tower', 'idle'];

export function orientationFor(spec: GameSpec): Orientation {
  const genre = (spec.genre ?? '').toLowerCase();
  if (isShooter(spec)) return 'landscape';
  // A first- or third-person camera is a camera you turn, and you turn it with
  // a thumb that needs somewhere to travel sideways.
  const view = (spec.view ?? '').toLowerCase();
  if (view === 'first-person' || view === 'third-person') return 'landscape';
  if (PORTRAIT_GENRES.some((g) => genre.includes(g))) return 'portrait';
  return (spec.dimension ?? '3d') === '3d' ? 'landscape' : 'portrait';
}

/** The design resolution, which has to agree with the orientation. */
export function viewportFor(orientation: Orientation): [number, number] {
  return orientation === 'landscape' ? [1152, 648] : [648, 1152];
}

/** Godot's own identifier rules: a folder name that will not need escaping. */
export function projectFolder(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug || 'chomugiri_game';
}

/**
 * A deterministic uid for a scene.
 *
 * Godot writes `uid://` ids into every scene and resource. They only have to be
 * unique within the project, and a stable one keeps regenerated projects from
 * churning — but two scenes sharing one makes Godot drop the second.
 */
export function sceneUid(seed: string): string {
  // Godot's uids are base-36-ish; any distinct token in that alphabet works.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `uid://c${hash.toString(36)}${seed.length.toString(36)}`;
}

/**
 * `project.godot`.
 *
 * `renderer/rendering_method="mobile"` matters here: the Forward+ default does
 * not run on most phones, and the editor this is opened in *is* a phone. The
 * gl_compatibility fallback covers older hardware.
 */
export function projectConfig(spec: GameSpec): string {
  const orientation = orientationFor(spec);
  const [width, height] = viewportFor(orientation);
  return `; Generated by Chomugiri.
; Godot reads this to find the project. config_version 5 is Godot 4.x.

config_version=5

[application]

config/name="${spec.name.replace(/"/g, '\\"')}"
${isShooter(spec) ? 'run/main_scene="res://mission_select.tscn"' : 'run/main_scene="res://main.tscn"'}
config/features=PackedStringArray("4.3", "Mobile")
config/icon="res://icon.svg"

[display]

window/size/viewport_width=${width}
window/size/viewport_height=${height}
window/handheld/orientation=${ORIENTATION_VALUES[orientation]}
window/stretch/mode="canvas_items"
window/stretch/aspect="expand"

[input]

move_left={
"deadzone": 0.2,
"events": [Object(InputEventKey,"keycode":65,"pressed":true)]
}
move_right={
"deadzone": 0.2,
"events": [Object(InputEventKey,"keycode":68,"pressed":true)]
}
move_forward={
"deadzone": 0.2,
"events": [Object(InputEventKey,"keycode":87,"pressed":true)]
}
move_back={
"deadzone": 0.2,
"events": [Object(InputEventKey,"keycode":83,"pressed":true)]
}
jump={
"deadzone": 0.2,
"events": [Object(InputEventKey,"keycode":32,"pressed":true)]
}
${isShooter(spec) ? shooterInput() : ''}
[rendering]

renderer/rendering_method="mobile"
renderer/rendering_method.mobile="gl_compatibility"
textures/vram_compression/import_etc2_astc=true
`;
}

/** A placeholder icon, so the project list does not show a broken thumbnail. */
export function projectIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#e8722a"/>
  <path d="M40 84V44l24 14 24-14v40" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

/**
 * The player controller.
 *
 * Written for touch as much as keys, because this runs on a phone: the virtual
 * joystick in the scene drives the same movement the keys do, rather than a
 * second code path that can rot.
 */
export function playerScript(): string {
  return `extends CharacterBody3D
## Player movement. Touch drag and WASD both feed the same vector,
## so there is only one path to keep working.

@export var speed: float = 5.0
@export var jump_velocity: float = 4.5

var touch_direction := Vector2.ZERO


func _physics_process(delta: float) -> void:
	# Gravity from the project setting, so changing it in one place works.
	if not is_on_floor():
		velocity += get_gravity() * delta

	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity

	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	if input == Vector2.ZERO:
		input = touch_direction

	var direction := (transform.basis * Vector3(input.x, 0.0, input.y)).normalized()
	if direction:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
	else:
		# move_toward rather than a hard zero, so stopping is not a jolt.
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)

	move_and_slide()


func _on_joystick_moved(direction: Vector2) -> void:
	touch_direction = direction
`;
}

/** An on-screen stick, because a phone has no WASD. */
export function joystickScript(): string {
  return `extends Control
## A thumb stick for touch. Emits a normalised direction the player reads.

signal moved(direction: Vector2)

@export var radius: float = 110.0

var _touch_index := -1
var _centre := Vector2.ZERO


func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed and _touch_index == -1:
			_touch_index = event.index
			_centre = event.position as Vector2
		elif not event.pressed and event.index == _touch_index:
			_touch_index = -1
			moved.emit(Vector2.ZERO)
			queue_redraw()
	elif event is InputEventScreenDrag and event.index == _touch_index:
		# Typed explicitly: Godot cannot infer a type through an event property,
		# and := there is a parse error, not a warning.
		var offset: Vector2 = event.position - _centre
		# Clamped, then normalised by the radius: a small drag should not be
		# the same as a full one.
		moved.emit(offset.limit_length(radius) / radius)
		queue_redraw()


func _draw() -> void:
	if _touch_index == -1:
		return
	draw_circle(_centre, radius, Color(1, 1, 1, 0.12))
	draw_circle(_centre, radius * 0.4, Color(1, 1, 1, 0.35))
`;
}

/**
 * Animation for a rigged character.
 *
 * Procedural rather than a baked AnimationPlayer, deliberately. A hand-written
 * .tscn animation has to name every track by node path and bone index, and a
 * single wrong index animates nothing with no error anywhere. This reads the
 * skeleton at runtime: bones it cannot find are skipped, so a model rigged as a
 * quadruped — or not rigged at all — degrades to standing still instead of
 * crashing.
 *
 * The cycle is driven by how fast the body is actually moving, so the legs do
 * not skate while the character stands still.
 */
export function characterScript(): string {
  return `extends Node3D
## Drives a skinned character's bones from its parent's velocity.
## Attach to the imported .glb node; the parent should be a CharacterBody3D.

@export var swing: float = 0.9        ## Radians a limb swings at full speed.
@export var steps_per_metre: float = 0.55

var _skeleton: Skeleton3D
var _body: CharacterBody3D
var _phase: float = 0.0
## Bone indices, resolved once. -1 means this rig does not have that bone.
var _bones := {}


func _ready() -> void:
	_skeleton = _find_skeleton(self)
	if _skeleton == null:
		# Not a rigged model. Nothing to drive, and nothing to complain about.
		set_physics_process(false)
		return

	_body = get_parent() as CharacterBody3D
	for name in ["ArmL", "ArmR", "LegL", "LegR", "Chest", "Head"]:
		_bones[name] = _skeleton.find_bone(name)


func _find_skeleton(node: Node) -> Skeleton3D:
	if node is Skeleton3D:
		return node
	for child in node.get_children():
		var found := _find_skeleton(child)
		if found != null:
			return found
	return null


func _rotate_bone(bone_name: String, axis: Vector3, angle: float) -> void:
	var index: int = _bones.get(bone_name, -1)
	if index < 0:
		return
	# Rest is the bind pose; posing relative to it keeps the limb attached.
	_skeleton.set_bone_pose_rotation(index, Quaternion(axis, angle))


func _physics_process(delta: float) -> void:
	var speed := 0.0
	if _body != null:
		speed = Vector2(_body.velocity.x, _body.velocity.z).length()

	if speed > 0.05:
		_phase += delta * speed * steps_per_metre * TAU
	else:
		# Settle back to the rest pose instead of freezing mid-stride.
		_phase = move_toward(_phase, round(_phase / TAU) * TAU, delta * 6.0)

	var reach := swing * clampf(speed / 5.0, 0.0, 1.0)
	var stride := sin(_phase) * reach

	# Arms and legs swing opposite each other; left and right are out of phase.
	_rotate_bone("LegL", Vector3.RIGHT, stride)
	_rotate_bone("LegR", Vector3.RIGHT, -stride)
	_rotate_bone("ArmL", Vector3.RIGHT, -stride)
	_rotate_bone("ArmR", Vector3.RIGHT, stride)
	# A small counter-rotation in the chest stops it reading as a puppet.
	_rotate_bone("Chest", Vector3.UP, stride * 0.12)
`;
}


/**
 * Music and sound, for a project that has audio files.
 *
 * Two players rather than one per zone: one each would hold every stream in
 * memory on a phone, while a single player whose stream is swapped cuts
 * mid-bar. Two crossfade, which is cheap and the only version that does not
 * sound like a mistake.
 */
export function audioScript(): string {
  return `extends Node
## Music and sound effects.

const FADE := 1.2

@onready var _a: AudioStreamPlayer = $MusicA
@onready var _b: AudioStreamPlayer = $MusicB
@onready var _sfx: AudioStreamPlayer = $Sfx

var _active: AudioStreamPlayer
var _idle: AudioStreamPlayer
var _fade: float = 0.0
var _volume_db: float = -8.0

var _tracks: Array[AudioStream] = []
var _effects: Dictionary = {}


func _ready() -> void:
	_active = _a
	_idle = _b

	# A missing file is not fatal: a silent game beats a crashing one.
	for i in 8:
		var stream: AudioStream = load("res://audio/zone_%d.wav" % i) as AudioStream
		if stream == null:
			continue
		if stream is AudioStreamWAV:
			var wav := stream as AudioStreamWAV
			wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
			wav.loop_end = wav.data.size() / 2
		_tracks.append(stream)

	for name in ["coin", "jump", "crash", "levelup"]:
		var s: AudioStream = load("res://audio/sfx_%s.wav" % name) as AudioStream
		if s != null:
			_effects[name] = s


func _process(delta: float) -> void:
	if _fade <= 0.0:
		return
	_fade = maxf(_fade - delta, 0.0)
	var t := 1.0 - (_fade / FADE)
	_active.volume_db = lerpf(-40.0, _volume_db, t)
	_idle.volume_db = lerpf(_volume_db, -40.0, t)
	if _fade <= 0.0 and _idle.playing:
		_idle.stop()


## Starts, or crossfades to, the track for a zone.
func play_zone(index: int) -> void:
	if index < 0 or index >= _tracks.size():
		return
	var stream: AudioStream = _tracks[index]
	if _active.stream == stream and _active.playing:
		return

	var next := _idle
	_idle = _active
	_active = next

	_active.stream = stream
	_active.volume_db = -40.0
	_active.play()
	_fade = FADE


func play(effect: String) -> void:
	if not _effects.has(effect):
		return
	_sfx.stream = _effects[effect]
	_sfx.play()


func set_music_volume(db: float) -> void:
	_volume_db = db
	if _fade <= 0.0:
		_active.volume_db = db
`;
}

/**
 * The main scene.
 *
 * `load_steps` counts every ext_resource and sub_resource plus one. Godot uses
 * it to size its load table, and a wrong count is the classic reason a
 * hand-written .tscn opens with nodes missing.
 */
/**
 * The arena a shooter is fought in.
 *
 * Bigger than the generic ground plane, walled so the horde funnels rather than
 * scattering, and littered with cover — a flat empty square is where a zombie
 * game stops being one, because there is nothing to break line of sight with.
 */
/** The top face of the ground slab: 0.5 thick, centred on the origin. */
const GROUND_TOP = 0.25;

export function shooterScene(spec: GameSpec): string {
  const models = spec.models ?? [];
  const block = cityBlock();

  const ext: string[] = [
    `[ext_resource type="Script" path="res://player.gd" id="1_player"]`,
    `[ext_resource type="Script" path="res://touch.gd" id="2_touch"]`,
    `[ext_resource type="Script" path="res://look.gd" id="3_look"]`,
    `[ext_resource type="Script" path="res://weapon.gd" id="4_weapon"]`,
    `[ext_resource type="Script" path="res://director.gd" id="5_director"]`,
    `[ext_resource type="Script" path="res://hud.gd" id="6_hud"]`,
    `[ext_resource type="Script" path="res://wiring.gd" id="7_wiring"]`,
    `[ext_resource type="Script" path="res://mission_runner.gd" id="8_runner"]`,
    `[ext_resource type="Script" path="res://missions.gd" id="9_missions"]`,
    `[ext_resource type="Script" path="res://effects.gd" id="10_effects"]`,
  ];

  const modelIdBase = ext.length + 1;
  models.forEach((model, i) => {
    ext.push(`[ext_resource type="PackedScene" path="${model.path}" id="${modelIdBase + i}_model${i}"]`);
  });

  // Real props for the cover, when any were downloaded. Declared once each and
  // reused across the sixteen positions — sixteen ext_resources pointing at the
  // same file is sixteen imports of the same textures.
  const props = spec.props ?? [];
  const propIds = new Map<string, string>();
  props.forEach((prop, i) => {
    if (propIds.has(prop.path)) return;
    const id = `${modelIdBase + models.length + i}_prop${i}`;
    propIds.set(prop.path, id);
    ext.push(`[ext_resource type="PackedScene" path="${prop.path}" id="${id}"]`);
  });
  const propId = (path: string): string => propIds.get(path) ?? '';

  // The generated character becomes the zombie rather than the player's own
  // body: in first person the player never sees themselves, and a rigged mesh
  // parented around the camera is a wall of polygons at the near plane.
  const enemyModel = models.find((m) => m.rigged) ?? models[0];

  const sub = [
    `[sub_resource type="ProceduralSkyMaterial" id="Sky_dusk"]
sky_top_color = Color(0.12, 0.13, 0.18, 1)
sky_horizon_color = Color(0.36, 0.26, 0.22, 1)
ground_bottom_color = Color(0.08, 0.08, 0.09, 1)
ground_horizon_color = Color(0.3, 0.22, 0.18, 1)
sun_angle_max = 24.0`,
    `[sub_resource type="Sky" id="Sky_main"]
sky_material = SubResource("Sky_dusk")`,
    // Fog is what sells a horde: zombies resolve out of it instead of popping
    // in at the spawn ring in full view.
    `[sub_resource type="Environment" id="Environment_main"]
background_mode = 2
sky = SubResource("Sky_main")
ambient_light_source = 3
ambient_light_color = Color(0.45, 0.42, 0.44, 1)
ambient_light_energy = 0.85
fog_enabled = true
fog_light_color = Color(0.29, 0.25, 0.25, 1)
fog_density = 0.022
tonemap_mode = 3`,
    `[sub_resource type="BoxMesh" id="BoxMesh_ground"]
size = Vector3(64, 0.5, 64)`,
    `[sub_resource type="BoxShape3D" id="BoxShape3D_ground"]
size = Vector3(64, 0.5, 64)`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_ground"]
albedo_color = Color(0.21, 0.2, 0.17, 1)
roughness = 0.95`,
    `[sub_resource type="BoxMesh" id="BoxMesh_wall"]
size = Vector3(64, 5, 1)`,
    `[sub_resource type="BoxShape3D" id="BoxShape3D_wall"]
size = Vector3(64, 5, 1)`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_wall"]
albedo_color = Color(0.27, 0.26, 0.25, 1)
roughness = 0.9`,
    // Three of them, cycled, because a block where every wall is the same grey
    // reads as one building with holes in it.
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_wallA"]
albedo_color = Color(0.33, 0.32, 0.3, 1)
roughness = 0.92`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_wallB"]
albedo_color = Color(0.38, 0.25, 0.2, 1)
roughness = 0.88`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_wallC"]
albedo_color = Color(0.24, 0.26, 0.28, 1)
metallic = 0.25
roughness = 0.7`,
    `[sub_resource type="BoxMesh" id="BoxMesh_crate"]
size = Vector3(2.4, 2.4, 2.4)`,
    `[sub_resource type="BoxShape3D" id="BoxShape3D_crate"]
size = Vector3(2.4, 2.4, 2.4)`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_crate"]
albedo_color = Color(0.36, 0.28, 0.18, 1)
roughness = 0.85`,
    `[sub_resource type="CapsuleShape3D" id="CapsuleShape3D_player"]
height = 1.8
radius = 0.4`,
    `[sub_resource type="BoxMesh" id="BoxMesh_gun"]
size = Vector3(0.045, 0.05, 0.5)`,
    `[sub_resource type="BoxMesh" id="BoxMesh_body"]
size = Vector3(0.07, 0.13, 0.26)`,
    `[sub_resource type="BoxMesh" id="BoxMesh_grip"]
size = Vector3(0.055, 0.16, 0.07)`,
    // Emissive on purpose. A view-model sits a few centimetres from the near
    // plane with its lit faces pointing away from the sun, so a purely lit
    // material renders as a black wedge across the corner of the screen — which
    // is exactly what the first render of this arena showed. \`cast_shadow = 0\`
    // does not help, because the wedge is the gun, not its shadow.
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_gun"]
albedo_color = Color(0.34, 0.34, 0.37, 1)
metallic = 0.6
roughness = 0.45
emission_enabled = true
emission = Color(0.42, 0.43, 0.48, 1)
emission_energy_multiplier = 0.55`,
    // A Panel with no style override uses the default theme's translucent one,
    // so "YOU DIED" appears over a game that is still visibly running behind it.
    `[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_over"]
bg_color = Color(0.05, 0.04, 0.04, 0.93)`,
  ];

  // A mesh and a shape per building. One shared 1x1x1 box scaled per node would
  // be fewer resources and a worse idea: non-uniform scale on a StaticBody3D
  // scales its collision shape too, and the two drift apart the moment anyone
  // edits one of them.
  for (const building of block.buildings) {
    sub.push(`[sub_resource type="BoxMesh" id="BoxMesh_${building.name}"]
size = Vector3(${building.size.join(', ')})`);
    sub.push(`[sub_resource type="BoxShape3D" id="BoxShape3D_${building.name}"]
size = Vector3(${building.size.join(', ')})`);
  }
  const rampSize = block.ramp.size.map((n) => Number(n.toFixed(3))).join(', ');
  sub.push(`[sub_resource type="BoxMesh" id="BoxMesh_ramp"]
size = Vector3(${rampSize})`);
  sub.push(`[sub_resource type="BoxShape3D" id="BoxShape3D_ramp"]
size = Vector3(${rampSize})`);
  sub.push(`[sub_resource type="BoxMesh" id="BoxMesh_deck"]
size = Vector3(${block.overlook.size.join(', ')})`);
  sub.push(`[sub_resource type="BoxShape3D" id="BoxShape3D_deck"]
size = Vector3(${block.overlook.size.join(', ')})`);

  // One collision box per distinct prop, sized to that prop.
  const shapeIds = new Map<string, string>();
  props.forEach((prop, i) => {
    if (shapeIds.has(prop.path)) return;
    const id = `BoxShape3D_prop${i}`;
    shapeIds.set(prop.path, id);
    const scale = prop.scale ?? 1;
    const [w, h, d] = prop.size;
    sub.push(`[sub_resource type="BoxShape3D" id="${id}"]
size = Vector3(${(w * scale).toFixed(3)}, ${(h * scale).toFixed(3)}, ${(d * scale).toFixed(3)})`);
  });
  const propShapeId = (prop: { path: string }): string => shapeIds.get(prop.path) ?? 'BoxShape3D_crate';

  const loadSteps = ext.length + sub.length + 1;

  // Four walls off one mesh and one shape. Transform3D is column-major: the
  // first nine numbers are the basis, and the side walls are that basis turned
  // a quarter turn about Y.
  const walls = [
    ['North', '1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2.5, -32'],
    ['South', '1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2.5, 32'],
    ['East', '0, 0, -1, 0, 1, 0, 1, 0, 0, 32, 2.5, 0'],
    ['West', '0, 0, -1, 0, 1, 0, 1, 0, 0, -32, 2.5, 0'],
  ]
    .map(
      ([name, transform]) => `[node name="Wall${name}" type="StaticBody3D" parent="Arena"]
transform = Transform3D(${transform})

[node name="Mesh" type="MeshInstance3D" parent="Arena/Wall${name}"]
mesh = SubResource("BoxMesh_wall")
material_override = SubResource("StandardMaterial3D_wall")

[node name="Collision" type="CollisionShape3D" parent="Arena/Wall${name}"]
shape = SubResource("BoxShape3D_wall")`,
    )
    .join('\n\n');

  // Where the cover stands, and what it stands between. See layout.ts: the
  // streets are designed first and the buildings are what is left over.
  const positions = block.cover;

  const crates = positions
    .map(([x, z], i) => {
      const prop = props[i % props.length];

      if (!prop) {
        return `[node name="Crate${i}" type="StaticBody3D" parent="Arena"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${x}, ${GROUND_TOP + 1.2}, ${z})

[node name="Mesh" type="MeshInstance3D" parent="Arena/Crate${i}"]
mesh = SubResource("BoxMesh_crate")
material_override = SubResource("StandardMaterial3D_crate")

[node name="Collision" type="CollisionShape3D" parent="Arena/Crate${i}"]
shape = SubResource("BoxShape3D_crate")`;
      }

      // Stood on the floor, not hung at a box's centre. Read from the model
      // rather than assumed: the first version dropped every prop by 1.2m
      // because that suited a 2.4m cube, which put a 0.93m barrel most of a
      // metre underground.
      const scale = prop.scale ?? 1;
      const lift = -(prop.baseY ?? 0) * scale;
      // The collision box is cut to the prop instead of the prop being scaled
      // to the box. Hiding behind a barrel that is half the size of the thing
      // stopping the bullets is the single most obvious way cover feels broken.
      return `[node name="Crate${i}" type="StaticBody3D" parent="Arena"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${x}, ${GROUND_TOP}, ${z})

[node name="Art" parent="Arena/Crate${i}" instance=ExtResource("${propId(prop.path)}")]
transform = Transform3D(${scale}, 0, 0, 0, ${scale}, 0, 0, 0, ${scale}, 0, ${lift.toFixed(3)}, 0)

[node name="Collision" type="CollisionShape3D" parent="Arena/Crate${i}"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, ${(prop.size[1] / 2).toFixed(3)}, 0)
shape = SubResource("${propShapeId(prop)}")`;
    })
    .join('\n\n');

  const WALL_MATERIALS = ['StandardMaterial3D_wallA', 'StandardMaterial3D_wallB', 'StandardMaterial3D_wallC'];

  const blocks = block.buildings
    .map((building) => {
      const [w, h, d] = building.size;
      const [x, z] = building.at;
      return `[node name="${building.name}" type="StaticBody3D" parent="Arena"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${x}, ${GROUND_TOP + h / 2}, ${z})

[node name="Mesh" type="MeshInstance3D" parent="Arena/${building.name}"]
mesh = SubResource("BoxMesh_${building.name}")
material_override = SubResource("${WALL_MATERIALS[building.material]}")

[node name="Collision" type="CollisionShape3D" parent="Arena/${building.name}"]
shape = SubResource("BoxShape3D_${building.name}")`;
    })
    .join('\n\n');

  // The only way up, and a slope rather than a ledge: a CharacterBody3D walks
  // up anything under floor_max_angle and cannot climb a step taller than its
  // jump, so a ramp is the one route that cannot be got wrong.
  const climb = `[node name="Ramp" type="StaticBody3D" parent="Arena"]
transform = Transform3D(${tiltedBasis(block.ramp.tilt)}, ${block.ramp.at.join(', ')})

[node name="Mesh" type="MeshInstance3D" parent="Arena/Ramp"]
mesh = SubResource("BoxMesh_ramp")
material_override = SubResource("StandardMaterial3D_wallC")

[node name="Collision" type="CollisionShape3D" parent="Arena/Ramp"]
shape = SubResource("BoxShape3D_ramp")

[node name="Overlook" type="StaticBody3D" parent="Arena"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${block.overlook.at.join(', ')})

[node name="Mesh" type="MeshInstance3D" parent="Arena/Overlook"]
mesh = SubResource("BoxMesh_deck")
material_override = SubResource("StandardMaterial3D_wallC")

[node name="Collision" type="CollisionShape3D" parent="Arena/Overlook"]
shape = SubResource("BoxShape3D_deck")`;

  return `[gd_scene load_steps=${loadSteps} format=3 uid="${sceneUid(spec.name)}"]

${ext.join('\n')}

${sub.join('\n\n')}

[node name="Main" type="Node3D"]

[node name="Environment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_main")

[node name="Sun" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.87, -0.35, 0.35, 0, 0.7, 0.71, -0.5, -0.61, 0.61, 0, 14, 0)
light_color = Color(1, 0.86, 0.72, 1)
light_energy = 1.15
shadow_enabled = true

[node name="Arena" type="Node3D" parent="."]

[node name="Ground" type="StaticBody3D" parent="Arena"]

[node name="Mesh" type="MeshInstance3D" parent="Arena/Ground"]
mesh = SubResource("BoxMesh_ground")
material_override = SubResource("StandardMaterial3D_ground")

[node name="Collision" type="CollisionShape3D" parent="Arena/Ground"]
shape = SubResource("BoxShape3D_ground")

${walls}

${blocks}

${climb}

${crates}

[node name="Player" type="CharacterBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.2, 0)
collision_layer = 1
collision_mask = 1
script = ExtResource("1_player")

[node name="Collision" type="CollisionShape3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.9, 0)
shape = SubResource("CapsuleShape3D_player")

[node name="Camera" type="Camera3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.6, 0)
current = true
far = 200.0

[node name="Look" type="Node" parent="Player"]
script = ExtResource("3_look")

[node name="Weapon" type="Node3D" parent="Player/Camera"]
transform = Transform3D(0.995, 0, -0.105, 0, 1, 0, 0.105, 0, 0.995, 0.32, -0.28, -1.15)
script = ExtResource("4_weapon")

[node name="Mesh" type="MeshInstance3D" parent="Player/Camera/Weapon"]
mesh = SubResource("BoxMesh_gun")
material_override = SubResource("StandardMaterial3D_gun")
cast_shadow = 0

[node name="Body" type="MeshInstance3D" parent="Player/Camera/Weapon"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -0.02, 0.15)
mesh = SubResource("BoxMesh_body")
material_override = SubResource("StandardMaterial3D_gun")
cast_shadow = 0

[node name="Grip" type="MeshInstance3D" parent="Player/Camera/Weapon"]
transform = Transform3D(0.966, -0.259, 0, 0.259, 0.966, 0, 0, 0, 1, 0, -0.14, 0.22)
mesh = SubResource("BoxMesh_grip")
material_override = SubResource("StandardMaterial3D_gun")
cast_shadow = 0

[node name="Flash" type="OmniLight3D" parent="Player/Camera/Weapon"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -0.35)
light_color = Color(1, 0.79, 0.44, 1)
light_energy = 2.2
omni_range = 3.2
visible = false

[node name="Director" type="Node3D" parent="."]
script = ExtResource("5_director")
enemy_scene_path = "${enemyModel?.path ?? ''}"
spawn_points = PackedVector3Array(${block.spawns.map(([x, z]) => `${x}, 1.2, ${z}`).join(', ')})

[node name="HUD" type="CanvasLayer" parent="."]
script = ExtResource("6_hud")

[node name="Crosshair" type="Control" parent="HUD"]
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5

[node name="Dot" type="ColorRect" parent="HUD/Crosshair"]
offset_left = -2.0
offset_top = -2.0
offset_right = 2.0
offset_bottom = 2.0
color = Color(1, 1, 1, 0.75)

[node name="Health" type="ProgressBar" parent="HUD"]
offset_left = 24.0
offset_top = -52.0
offset_right = 264.0
offset_bottom = -28.0
anchor_top = 1.0
anchor_bottom = 1.0
max_value = 100.0
value = 100.0
show_percentage = false

[node name="HealthLabel" type="Label" parent="HUD"]
offset_left = 276.0
offset_top = -54.0
offset_right = 356.0
offset_bottom = -26.0
anchor_top = 1.0
anchor_bottom = 1.0
text = "100"

[node name="Ammo" type="Label" parent="HUD"]
offset_left = -184.0
offset_top = -54.0
offset_right = -24.0
offset_bottom = -26.0
anchor_left = 1.0
anchor_top = 1.0
anchor_right = 1.0
anchor_bottom = 1.0
horizontal_alignment = 2
text = "30 / 180"

[node name="Wave" type="Label" parent="HUD"]
offset_left = 24.0
offset_top = 24.0
offset_right = 224.0
offset_bottom = 52.0
text = "WAVE 1"

[node name="Objective" type="Label" parent="HUD"]
offset_left = 24.0
offset_top = 54.0
offset_right = 460.0
offset_bottom = 82.0
text = ""

[node name="Score" type="Label" parent="HUD"]
offset_left = -184.0
offset_top = 24.0
offset_right = -24.0
offset_bottom = 52.0
anchor_left = 1.0
anchor_right = 1.0
horizontal_alignment = 2
text = "000000"

[node name="Centre" type="Label" parent="HUD"]
offset_left = -260.0
offset_top = -90.0
offset_right = 260.0
offset_bottom = -54.0
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
horizontal_alignment = 1
text = ""

[node name="GameOver" type="Panel" parent="HUD"]
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
theme_override_styles/panel = SubResource("StyleBoxFlat_over")

[node name="Text" type="Label" parent="HUD/GameOver"]
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
horizontal_alignment = 1
vertical_alignment = 1
text = "YOU DIED"

${touchControlsNode(SHOOTER_TOUCH, '2_touch', 'HUD')}

[node name="Missions" type="Node" parent="."]
script = ExtResource("9_missions")

[node name="Mission" type="Node" parent="."]
script = ExtResource("8_runner")

[node name="Effects" type="Node3D" parent="."]
script = ExtResource("10_effects")

[node name="Wiring" type="Node" parent="."]
script = ExtResource("7_wiring")
`;
}

export function mainScene(spec: GameSpec): string {
  if (isShooter(spec)) return shooterScene(spec);

  const models = spec.models ?? [];

  const rigged = models.filter((m) => m.rigged);

  const ext: string[] = [
    `[ext_resource type="Script" path="res://player.gd" id="1_player"]`,
    `[ext_resource type="Script" path="res://joystick.gd" id="2_stick"]`,
  ];
  // Declared only when something uses it: an ext_resource pointing at a file
  // the project does not contain stops the scene loading.
  if (rigged.length) ext.push(`[ext_resource type="Script" path="res://character.gd" id="3_character"]`);

  const modelIdBase = ext.length + 1;
  models.forEach((model, i) => {
    ext.push(`[ext_resource type="PackedScene" path="${model.path}" id="${modelIdBase + i}_model${i}"]`);
  });

  const sub = [
    `[sub_resource type="BoxMesh" id="BoxMesh_ground"]
size = Vector3(40, 0.5, 40)`,
    `[sub_resource type="BoxShape3D" id="BoxShape3D_ground"]
size = Vector3(40, 0.5, 40)`,
    `[sub_resource type="CapsuleShape3D" id="CapsuleShape3D_player"]
height = 2.0
radius = 0.4`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_ground"]
albedo_color = Color(0.36, 0.47, 0.31, 1)`,
  ];

  const loadSteps = ext.length + sub.length + 1;

  // A rigged model is the player's body, so it hangs off the Player node and
  // gets the animation script. Everything else is scenery placed in the world.
  const sceneryNodes = models
    .map((model, i) => {
      if (model.rigged) return null;
      const [x, y, z] = model.at ?? [0, 0, 0];
      return `[node name="${model.node}" parent="." instance=ExtResource("${modelIdBase + i}_model${i}")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${x}, ${y}, ${z})`;
    })
    .filter((node): node is string => node !== null)
    .join('\n\n');

  const riggedNodes = models
    .map((model, i) => {
      if (!model.rigged) return null;
      // Dropped by half the capsule height so the feet meet the floor rather
      // than hovering at the body's centre.
      return `[node name="${model.node}" parent="Player" instance=ExtResource("${modelIdBase + i}_model${i}")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0)
script = ExtResource("3_character")`;
    })
    .filter((node): node is string => node !== null)
    .join('\n\n');

  return `[gd_scene load_steps=${loadSteps} format=3 uid="${sceneUid(spec.name)}"]

${ext.join('\n')}

${sub.join('\n\n')}

[node name="Main" type="Node3D"]

[node name="Sun" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.87, -0.35, 0.35, 0, 0.7, 0.71, -0.5, -0.61, 0.61, 0, 12, 0)
shadow_enabled = true

[node name="Environment" type="WorldEnvironment" parent="."]

[node name="Ground" type="StaticBody3D" parent="."]

[node name="Mesh" type="MeshInstance3D" parent="Ground"]
mesh = SubResource("BoxMesh_ground")
material_override = SubResource("StandardMaterial3D_ground")

[node name="Collision" type="CollisionShape3D" parent="Ground"]
shape = SubResource("BoxShape3D_ground")

[node name="Player" type="CharacterBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.5, 0)
script = ExtResource("1_player")

[node name="Collision" type="CollisionShape3D" parent="Player"]
shape = SubResource("CapsuleShape3D_player")

[node name="Camera" type="Camera3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 0.92, 0.39, 0, -0.39, 0.92, 0, 2.2, 6)

${riggedNodes}

${sceneryNodes}

[node name="UI" type="CanvasLayer" parent="."]

[node name="Joystick" type="Control" parent="UI"]
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("2_stick")

[connection signal="moved" from="UI/Joystick" to="Player" method="_on_joystick_moved"]
`;
}

/** A README, because the user opens this on a phone and needs to know where to start. */
export function readme(spec: GameSpec): string {
  return `# ${spec.name}

A Godot 4 project, generated by Chomugiri.

## Opening it on Android

1. Extract this zip somewhere the Godot editor can reach — Internal storage is
   simplest, Downloads is fine.
2. Open **Godot Engine 4** and press **Import**.
3. Point it at the extracted folder and pick \`project.godot\`.
4. Press **Play** (▶). \`main.tscn\` runs.

## What is here

| File | What it does |
| --- | --- |
| \`project.godot\` | Project settings. Renderer is set to mobile, which is what runs on a phone. |
| \`main.tscn\` | The scene that runs: ground, light, player, camera and the controls. |
| \`player.gd\` | Movement. Touch drag and WASD feed the same vector. |
${isShooter(spec) ? '| \`touch.gd\` | Every finger on the screen: stick, free look, and the buttons. |' : '| \`joystick.gd\` | The on-screen stick. |'}
${
    isShooter(spec)
      ? `| \`look.gd\` | First-person look: the touch layer drives it, or the mouse does. |
| \`weapon.gd\` | The gun — hitscan, 30-round magazine, reloads on \`R\` or when it runs dry. |
| \`enemy.gd\` | One zombie: walks at you, hits at arm's length, falls over when killed. |
| \`director.gd\` | Waves. Each one is bigger, faster and tougher than the last. |
| \`hud.gd\` | Health, ammo, wave, score, and the card you get when you die. |
| \`wiring.gd\` | Connects those four to each other in one place. |
| \`missions.gd\` | The campaign, as data. A new mission is a row here. |
| \`mission_runner.gd\` | Checks the current objective against what the game reports. |
| \`mission_select.tscn\` | What the game opens to: pick a mission. |
| \`effects.gd\` | Muzzle flash, sparks off the world, blood off the living. |
| \`animator.gd\` | Plays a rigged model's walk, whatever its author called it. |
| \`pickup.gd\` | The things a collect objective counts. |
`
      : ''
  }${!isShooter(spec) && (spec.models ?? []).some((m) => m.rigged) ? '| `character.gd` | Swings the rigged character\'s arms and legs from how fast it is moving. |\n' : ''}${(spec.models ?? [])
    .map((m) => {
      const file = m.path.replace('res://', '');
      // In a shooter the rigged model is what the horde is made of, so saying
      // it is attached to the player would send someone looking for it in the
      // wrong node.
      if (isShooter(spec)) return `| \`${file}\` | A generated model. The Director builds every zombie from it. |`;
      return m.rigged
        ? `| \`${file}\` | A rigged character with a skeleton, attached to the player as **${m.node}**. |`
        : `| \`${file}\` | A generated model, placed as **${m.node}**. |`;
    })
    .join('\n')}

## Changing it

The player moves at \`speed\` and jumps at \`jump_velocity\` — both are exported,
so they are editable in the inspector without touching code.
${
    isShooter(spec)
      ? `
## Playing it

Left half of the screen is the movement stick — it appears wherever your thumb
lands, and shoving it to the edge sprints. The right half turns the camera.
**FIRE**, **RELOAD** and **JUMP** sit under your right thumb. On a keyboard:
WASD to move, mouse to look, shift to sprint, click to fire, \`R\` to reload.

### The block

${describeBlock(cityBlock())}

### Missions

${describeMissions(campaign(spec.name))}

Each one unlocks the next, and only on a win. Progress is kept in
\`user://progress.cfg\` — delete it to start over.

Everything that decides how hard it gets is exported on the **Director** node —
\`first_wave_size\`, \`wave_growth\`, \`speed_step\`, \`health_step\` and the
\`break_seconds\` between waves. The gun's \`damage\`, \`magazine\` and
\`rounds_per_second\` are on **Player/Weapon**.
`
      : ''
  }
`;
}

/** Every file the project needs, ready to zip. */
export function buildProject(spec: GameSpec): GodotFile[] {
  const shooter = isShooter(spec);

  const files: GodotFile[] = [
    { path: 'project.godot', content: projectConfig(spec) },
    { path: 'icon.svg', content: projectIcon() },
    { path: 'main.tscn', content: mainScene(spec) },
    { path: 'player.gd', content: shooter ? shooterPlayerScript() : playerScript() },
    // One or the other, never both: an unused script in the project is a second
    // answer to "where do the controls live", and the wrong one was the answer
    // for long enough that the camera never turned.
    shooter
      ? { path: 'touch.gd', content: touchControlsScript() }
      : { path: 'joystick.gd', content: joystickScript() },
    { path: 'README.md', content: readme(spec) },
  ];

  if (shooter) {
    const missions = campaign(spec.name);
    files.push(
      { path: 'look.gd', content: lookScript() },
      { path: 'weapon.gd', content: weaponScript() },
      { path: 'enemy.gd', content: enemyScript() },
      { path: 'director.gd', content: directorScript() },
      { path: 'hud.gd', content: hudScript() },
      { path: 'wiring.gd', content: wiringScript() },
      // Missions turn one arena into several nights. The campaign is data, so
      // a new mission is a row rather than a script that can rot on its own.
      { path: 'missions.gd', content: missionData(missions) },
      { path: 'mission_runner.gd', content: missionRunner() },
      { path: 'mission_select.gd', content: missionSelect(spec.name) },
      { path: 'mission_select.tscn', content: missionSelectScene(spec.name) },
      // Feedback. A gun that does not flash and a hit that does not spray read
      // as unfinished however correct the code underneath is.
      { path: 'effects.gd', content: effectsScript() },
      { path: 'animator.gd', content: animatorScript() },
      { path: 'pickup.gd', content: pickupScript() },
    );
  }

  // In first person the rigged model is the enemy, not the player, so the
  // walk-cycle script that drives the player's own limbs has nothing to drive.
  if (!shooter && (spec.models ?? []).some((m) => m.rigged)) {
    files.push({ path: 'character.gd', content: characterScript() });
  }
  // Music is on unless it is turned off: silence is what makes a generated
  // game read as a tech demo.
  if (spec.music !== false) {
    files.push({ path: 'audio.gd', content: audioScript() });
  }
  return files;
}

/**
 * What would stop this project from running.
 *
 * Checked rather than assumed, because every one of these has shipped broken
 * from a hand-written project at some point.
 */
export function validateProject(files: GodotFile[]): string[] {
  const problems: string[] = [];
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  const config = byPath.get('project.godot');
  if (!config) {
    problems.push('No project.godot — Godot will not recognise this as a project at all.');
    return problems;
  }
  if (!/^config_version=\d+/m.test(config)) {
    problems.push('project.godot has no config_version; Godot refuses to import it.');
  }

  const mainScene = /run\/main_scene="res:\/\/([^"]+)"/.exec(config)?.[1];
  if (!mainScene) problems.push('project.godot names no main scene, so pressing play does nothing.');
  else if (!byPath.has(mainScene)) problems.push(`Main scene "${mainScene}" is referenced but not in the project.`);

  for (const [path, content] of byPath) {
    if (!path.endsWith('.tscn')) continue;

    const header = /^\[gd_scene load_steps=(\d+) format=3/.exec(content);
    if (!header) {
      problems.push(`${path} has no valid [gd_scene] header.`);
      continue;
    }

    const resources = (content.match(/^\[(ext_resource|sub_resource)/gm) ?? []).length;
    const declared = Number(header[1]);
    if (declared !== resources + 1) {
      problems.push(`${path}: load_steps is ${declared} but the scene has ${resources} resources — it should be ${resources + 1}.`);
    }

    // Every referenced id must be declared, or the node loads without it.
    const declaredIds = new Set([...content.matchAll(/^\[ext_resource[^\]]*id="([^"]+)"/gm)].map((m) => m[1]));
    for (const match of content.matchAll(/ExtResource\("([^"]+)"\)/g)) {
      if (!declaredIds.has(match[1])) problems.push(`${path} uses ExtResource("${match[1]}") which is never declared.`);
    }

    const declaredSubs = new Set([...content.matchAll(/^\[sub_resource[^\]]*id="([^"]+)"/gm)].map((m) => m[1]));
    for (const match of content.matchAll(/SubResource\("([^"]+)"\)/g)) {
      if (!declaredSubs.has(match[1])) problems.push(`${path} uses SubResource("${match[1]}") which is never declared.`);
    }

    // A script path that does not exist leaves the node inert at runtime.
    for (const match of content.matchAll(/\[ext_resource type="Script" path="res:\/\/([^"]+)"/g)) {
      if (!byPath.has(match[1])) problems.push(`${path} points at script "${match[1]}", which is not in the project.`);
    }
  }

  return problems;
}

/**
 * The mission select scene.
 *
 * The scene the game opens to, so the first thing a player sees is a choice
 * rather than a horde. A Control tree with no resources of its own, which keeps
 * `load_steps` at the two scripts and nothing else.
 */
export function missionSelectScene(name: string): string {
  return `[gd_scene load_steps=3 format=3 uid="${sceneUid(`${name}-select`)}"]

[ext_resource type="Script" path="res://mission_select.gd" id="1_select"]
[ext_resource type="Script" path="res://missions.gd" id="2_missions"]

[node name="MissionSelect" type="Control"]
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1_select")

[node name="Missions" type="Node" parent="."]
script = ExtResource("2_missions")

[node name="Background" type="ColorRect" parent="."]
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
color = Color(0.07, 0.06, 0.06, 1)

[node name="Title" type="Label" parent="."]
offset_left = 32.0
offset_top = 28.0
offset_right = 640.0
offset_bottom = 68.0
text = "${name.replace(/"/g, '')}"

[node name="Panel" type="Panel" parent="."]
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
offset_left = 24.0
offset_top = 84.0
offset_right = -24.0
offset_bottom = -24.0

[node name="Scroll" type="ScrollContainer" parent="Panel"]
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
offset_left = 16.0
offset_top = 16.0
offset_right = -16.0
offset_bottom = -16.0

[node name="List" type="VBoxContainer" parent="Panel/Scroll"]
size_flags_horizontal = 3
`;
}
