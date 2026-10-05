extends Camera3D
## Follows a target from behind. Created by Stage.chase_camera(); the target needs a forward axis of -Z.

var target: Node3D
var distance := 8.0
var height := 3.6
var look_ahead := 3.0
var follow_speed := 5.0
var turn_speed := 3.2
var base_fov := 68.0
var speed_fov := 14.0

var _yaw := 0.0
var _last_pos := Vector3.ZERO
var _speed := 0.0


func _ready() -> void:
	fov = base_fov
	process_priority = 100


func _forward_yaw() -> float:
	var f := -target.global_transform.basis.z
	return atan2(-f.x, -f.z)


func snap() -> void:
	if target == null:
		return
	_yaw = _forward_yaw()
	_last_pos = target.global_position
	_place(1.0, 1.0)


func _physics_process(delta: float) -> void:
	if target == null or not is_instance_valid(target):
		return
	_speed = lerpf(_speed, target.global_position.distance_to(_last_pos) / maxf(delta, 0.0001), minf(1.0, delta * 6.0))
	_last_pos = target.global_position
	_yaw = lerp_angle(_yaw, _forward_yaw(), minf(1.0, delta * turn_speed))
	_place(minf(1.0, delta * follow_speed), delta)
	fov = lerpf(fov, base_fov + clampf(_speed / 30.0, 0.0, 1.0) * speed_fov, minf(1.0, delta * 3.0))


func _place(weight: float, _delta: float) -> void:
	var back := Vector3(sin(_yaw), 0.0, cos(_yaw))
	var wanted := target.global_position + back * distance + Vector3.UP * height
	global_position = global_position.lerp(wanted, weight)
	var look_target := target.global_position + (-back) * look_ahead + Vector3.UP * 1.0
	look_at(look_target, Vector3.UP)
