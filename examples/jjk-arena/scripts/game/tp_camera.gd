class_name ThirdPersonCamera
extends Camera3D
## Over-the-shoulder camera behind the player. Drag on the right half of the screen to orbit; with lock-on (default) the camera also swings
## round so the opponent stays in front of you, like action fighting games. Stick input is turned into world directions relative to it.

var target: Node3D            ## the player
var lock: Node3D              ## the opponent (null = free camera)
var yaw := 0.0
var pitch := -0.1
var distance := 2.0
var shake := 0.0
var lock_on := true
var _pos := Vector3.ZERO
var _manual_t := 0.0
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	fov = 62.0
	current = true
	near = 0.1
	far = 900.0

var _cine: Node3D
var _cine_t := 0.0
var _ov := false
var _ov_pos := Vector3.ZERO
var _ov_look := Vector3.ZERO

## Hard camera control for cutscenes.
func set_override(pos: Vector3, look: Vector3) -> void:
	_ov = true
	_ov_pos = pos
	_ov_look = look

func clear_override() -> void:
	if _ov:
		_ov = false
		_pos = global_position

## Cut to a close-up of `who`'s face for `secs` (domain hand sign, low-health supers), then ease back behind the player.
func cinematic(who: Node3D, secs: float) -> void:
	_cine = who
	_cine_t = secs

func orbit(dx: float, dy: float) -> void:
	yaw -= dx
	pitch = clampf(pitch - dy, -0.9, 0.35)
	_manual_t = 1.2

func world_dir(stick: Vector2) -> Vector2:
	var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	var d := right * stick.x + fwd * stick.y
	return Vector2(d.x, d.z)

func _process(delta: float) -> void:
	if target == null:
		return
	if _ov:
		global_position = _ov_pos
		look_at(_ov_look, Vector3.UP)
		return
	_manual_t = maxf(0.0, _manual_t - delta)
	if _cine != null and _cine_t > 0.0 and is_instance_valid(_cine):
		_cine_t -= delta
		var fwd := -_cine.global_transform.basis.z
		var side := fwd.cross(Vector3.UP).normalized()
		var face := _cine.global_position + Vector3.UP * 1.7
		var want := face + fwd * 2.2 + side * 0.6 - Vector3.UP * 0.15
		global_position = global_position.lerp(want, clampf(8.0 * delta, 0.0, 1.0))
		look_at(face, Vector3.UP)
		_pos = global_position
		return
	if lock_on and lock != null and is_instance_valid(lock) and _manual_t <= 0.0:
		var to := lock.global_position - target.global_position
		to.y = 0.0
		if to.length() > 0.5:
			var want := atan2(-to.x, -to.z)
			yaw = lerp_angle(yaw, want, clampf(3.0 * delta, 0.0, 1.0))
	var pivot := target.global_position + Vector3.UP * 1.5
	var back := Vector3(sin(yaw) * cos(pitch), -sin(pitch), cos(yaw) * cos(pitch))
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	var dist := distance
	if lock != null and is_instance_valid(lock):
		dist += clampf(target.global_position.distance_to(lock.global_position) * 0.06, 0.0, 0.7)
	var want_pos := pivot + back * dist + right * 0.55
	_pos = want_pos if _pos == Vector3.ZERO else _pos.lerp(want_pos, clampf(10.0 * delta, 0.0, 1.0))
	shake = maxf(0.0, shake - 2.5 * delta)
	var off := Vector3(_rng.randf_range(-1, 1), _rng.randf_range(-1, 1), _rng.randf_range(-1, 1)) * shake * 0.18
	global_position = _pos + off
	var look := pivot + right * 0.4
	if lock != null and is_instance_valid(lock) and lock_on:
		look = look.lerp(lock.global_position + Vector3.UP * 1.2, 0.35)
	look_at(look, Vector3.UP)
