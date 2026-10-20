class_name FightCamera
extends Camera3D
## Side-on fighting camera: sits on a line perpendicular to the fighters, keeps both in frame, eases in and out, shakes on hits.

var a: Node3D
var b: Node3D
var yaw := 0.0                      ## the direction the camera looks along, around Y
var shake := 0.0
var _pos_smooth := Vector3.ZERO
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	fov = 55.0
	current = true

## Screen-space stick (x right, y up on screen) -> world direction on the ground plane.
func world_dir(stick: Vector2) -> Vector2:
	var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	var d := right * stick.x + fwd * stick.y
	return Vector2(d.x, d.z)

func _process(delta: float) -> void:
	if a == null or b == null:
		return
	var mid := (a.global_position + b.global_position) * 0.5
	var sep := a.global_position.distance_to(b.global_position)
	# look across the line between the fighters
	var line := (b.global_position - a.global_position)
	line.y = 0.0
	if line.length() > 0.1:
		var side := Vector3(-line.z, 0, line.x).normalized()
		var want_yaw := atan2(-side.x, -side.z)
		yaw = lerp_angle(yaw, want_yaw if side.dot(Vector3(0, 0, 1)) > -2.0 else want_yaw, clampf(2.0 * delta, 0.0, 1.0))
	var dist := clampf(3.6 + sep * 0.85, 5.2, 13.0)
	var height := 0.9 + mid.y * 0.5 + sep * 0.1
	var look := Vector3(mid.x, 1.2 + mid.y * 0.8, mid.z)
	var back := Vector3(sin(yaw), 0, cos(yaw)) * dist
	var target := look + back + Vector3(0, height, 0)
	_pos_smooth = _pos_smooth.lerp(target, clampf(4.0 * delta, 0.0, 1.0)) if _pos_smooth != Vector3.ZERO else target
	shake = maxf(0.0, shake - 2.5 * delta)
	var off := Vector3(_rng.randf_range(-1, 1), _rng.randf_range(-1, 1), _rng.randf_range(-1, 1)) * shake * 0.25
	global_position = _pos_smooth + off
	look_at(look, Vector3.UP)
