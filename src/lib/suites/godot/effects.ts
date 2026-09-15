/**
 * Effects, and making the rigged models move.
 *
 * A shooter where the gun does not flash, the hits do not spray and the enemies
 * slide along the floor is a shooter that reads as unfinished however correct
 * the code is. All of it is feedback: the flash tells you the shot went, the
 * spray tells you it landed, the walk tells you the thing coming at you is
 * alive.
 *
 * Everything is a GPUParticles3D built in code with a one-shot emit, rather
 * than a .tscn per effect. Particle systems are almost all numbers, the numbers
 * are the design, and a scene file would hide them behind a UID.
 *
 * ── The Godot 4 particle traps, both hit while building this ────────────────
 *
 *   - **A one-shot system does not restart by setting `emitting = true` if it
 *     is already true.** It has to be set false first, or the second shot
 *     produces nothing. Fine when you fire slowly, invisible at 7 rounds a
 *     second — which is when you need it.
 *   - **`ParticleProcessMaterial` defaults `gravity` to -9.8 on Y.** Sparks
 *     that should fly outward fall straight down and read as a leak.
 */

/** Muzzle flash, impact spray, and the casings, all off one small script. */
export function effectsScript(): string {
  return `extends Node3D
## Every visual effect the shooter makes, in one place.
##
## Built as pooled one-shot emitters: creating a GPUParticles3D per hit and
## freeing it is a stutter you can hear in the frame time at wave ten.

const POOL := 8

var _sparks: Array[GPUParticles3D] = []
var _blood: Array[GPUParticles3D] = []
var _next_spark: int = 0
var _next_blood: int = 0


func _ready() -> void:
	for i in POOL:
		_sparks.append(_make_burst(Color(1.0, 0.82, 0.45, 1.0), 0.35, 14, 3.2))
		_blood.append(_make_burst(Color(0.55, 0.06, 0.06, 1.0), 0.5, 20, 2.4))


## One emitter, configured. Returns it already in the tree and not emitting.
func _make_burst(tint: Color, lifetime: float, amount: int, speed: float) -> GPUParticles3D:
	var particles := GPUParticles3D.new()
	particles.amount = amount
	particles.lifetime = lifetime
	particles.one_shot = true
	particles.emitting = false
	particles.explosiveness = 1.0
	particles.local_coords = false

	var material := ParticleProcessMaterial.new()
	material.direction = Vector3(0, 0, 1)
	material.spread = 55.0
	material.initial_velocity_min = speed * 0.4
	material.initial_velocity_max = speed
	# Defaults to -9.8 on Y, which turns a spray into a leak.
	material.gravity = Vector3(0, -3.0, 0)
	material.scale_min = 0.03
	material.scale_max = 0.09
	material.color = tint
	particles.process_material = material

	var mesh := QuadMesh.new()
	mesh.size = Vector2(0.06, 0.06)
	var surface := StandardMaterial3D.new()
	surface.albedo_color = tint
	surface.emission_enabled = true
	surface.emission = tint
	surface.emission_energy_multiplier = 2.0
	surface.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	surface.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	surface.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mesh.material = surface
	particles.draw_pass_1 = mesh

	add_child(particles)
	return particles


## Sparks where a bullet hit the world, thrown back along the surface normal.
func impact(at: Vector3, normal: Vector3) -> void:
	_fire(_sparks, _next_spark, at, normal)
	_next_spark = (_next_spark + 1) % POOL


## Blood where a bullet hit something alive, thrown back at the shooter.
func hit(at: Vector3, from: Vector3) -> void:
	_fire(_blood, _next_blood, at, -from)
	_next_blood = (_next_blood + 1) % POOL


func _fire(pool: Array[GPUParticles3D], index: int, at: Vector3, direction: Vector3) -> void:
	var particles: GPUParticles3D = pool[index]
	particles.global_position = at
	if direction.length_squared() > 0.001:
		particles.look_at(at + direction.normalized(), Vector3.UP)
	# Restarted, not just switched on. A one-shot system already emitting
	# ignores emitting = true, so every shot after the first produces nothing —
	# which never shows up until you hold the trigger down.
	particles.emitting = false
	particles.restart()
	particles.emitting = true
`;
}

/**
 * Making a rigged model walk.
 *
 * Godot imports a glTF's animations into an AnimationPlayer under the imported
 * scene. The names differ by where the model came from — Mixamo calls a walk
 * "mixamo.com", Sketchfab uses whatever the author typed — so nothing here
 * matches on an exact name. It looks for something walk-shaped, then something
 * idle-shaped, then gives up and plays whatever is first, because the first
 * animation on a character model is almost always its idle or its walk.
 *
 * A model with no animations at all falls back to swinging its bones directly,
 * which is what the code-built characters need.
 */
export function animatorScript(): string {
  return `extends Node
## Plays a rigged model's walk, whatever its author called it.

@export var walk_speed_scale: float = 1.0

var _player: AnimationPlayer
var _walking: String = ""
var _idle: String = ""
var _body: CharacterBody3D
var _skeleton: Skeleton3D
var _swing: float = 0.0


func _ready() -> void:
	_body = _find_body()
	_player = _find_animation_player(get_parent())
	if _player != null:
		_pick_clips()
		return
	# No baked animation: swing the bones by hand instead of standing still.
	_skeleton = _find_skeleton(get_parent())


func _find_body() -> CharacterBody3D:
	var node: Node = get_parent()
	while node != null:
		if node is CharacterBody3D:
			return node as CharacterBody3D
		node = node.get_parent()
	return null


func _find_animation_player(root: Node) -> AnimationPlayer:
	if root is AnimationPlayer:
		return root as AnimationPlayer
	for child in root.get_children():
		var found := _find_animation_player(child)
		if found != null:
			return found
	return null


func _find_skeleton(root: Node) -> Skeleton3D:
	if root is Skeleton3D:
		return root as Skeleton3D
	for child in root.get_children():
		var found := _find_skeleton(child)
		if found != null:
			return found
	return null


## Matched on shape, not on an exact name: the same walk is called "Walk",
## "walking", "mixamo.com" and "Armature|Walk" depending on who exported it.
func _pick_clips() -> void:
	for name in _player.get_animation_list():
		var lower := name.to_lower()
		if _walking == "" and (lower.contains("walk") or lower.contains("run") or lower.contains("move")):
			_walking = name
		elif _idle == "" and lower.contains("idle"):
			_idle = name
	if _walking == "" and _idle == "" and _player.get_animation_list().size() > 0:
		# The first clip on a character is almost always its idle or its walk,
		# and either of those moving is better than a T-pose that does not.
		_walking = _player.get_animation_list()[0]


func _physics_process(delta: float) -> void:
	if _body == null:
		return
	var speed: float = Vector2(_body.velocity.x, _body.velocity.z).length()

	if _player != null:
		var wanted: String = _walking if speed > 0.2 else _idle
		if wanted == "":
			wanted = _walking if _walking != "" else _idle
		if wanted != "" and _player.current_animation != wanted:
			_player.play(wanted)
		if _player.current_animation == _walking and _walking != "":
			# Faster feet when moving faster, so a sprint does not look like a
			# stroll played at the same rate.
			_player.speed_scale = clampf(speed / 2.4, 0.6, 2.0) * walk_speed_scale
		return

	if _skeleton == null:
		return

	# No clips: swing the limbs from how fast the body is actually moving, so a
	# code-built character walks rather than sliding.
	_swing += delta * maxf(speed, 0.001) * 3.0
	var amount: float = sin(_swing) * minf(speed * 0.22, 0.7)
	_swing_bone("leftLeg", amount)
	_swing_bone("rightLeg", -amount)
	_swing_bone("leftArm", -amount * 0.8)
	_swing_bone("rightArm", amount * 0.8)


func _swing_bone(bone_name: String, angle: float) -> void:
	var index: int = _skeleton.find_bone(bone_name)
	if index < 0:
		return
	var pose := _skeleton.get_bone_rest(index)
	pose.basis = pose.basis.rotated(Vector3.RIGHT, angle)
	_skeleton.set_bone_pose_position(index, pose.origin)
	_skeleton.set_bone_pose_rotation(index, pose.basis.get_rotation_quaternion())
`;
}

/**
 * Pickups: the things a `collect` objective counts.
 *
 * An Area3D rather than a body, so walking through one collects it instead of
 * bumping into it — a crate you have to nudge into is a crate people walk past.
 */
export function pickupScript(): string {
  return `extends Area3D
## One collectable. Spins, bobs, and reports itself when walked through.

signal collected(kind: String)

@export var kind: String = "collect"
@export var spin: float = 1.6
@export var bob: float = 0.15

var _base_y: float = 0.0
var _time: float = 0.0
var _taken: bool = false


func _ready() -> void:
	_base_y = position.y
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	if _taken:
		return
	_time += delta
	rotate_y(spin * delta)
	position.y = _base_y + sin(_time * 2.0) * bob


func _on_body_entered(body: Node3D) -> void:
	# Only the player. A zombie walking over the ammo should not collect it.
	if _taken or not body.has_method("take_damage") or not body.has_method("is_dead"):
		return
	_taken = true
	collected.emit(kind)
	var fade := create_tween()
	fade.set_parallel(true)
	fade.tween_property(self, "scale", Vector3.ZERO, 0.2)
	fade.tween_property(self, "position:y", _base_y + 1.0, 0.2)
	await fade.finished
	queue_free()
`;
}
