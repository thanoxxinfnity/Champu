class_name CameraFollow
extends Camera3D
## Chase camera with the feel of a Horizon-style racer.
##
## - Follows a heading that lags the car and leans towards the direction of
##   travel, so in a drift the camera stays on the line and you see the car's
##   angle instead of the camera swinging round with the nose.
## - Pulls back and widens its field of view with speed; nitro kicks both.
## - Shakes a little at speed, more under nitro and off-road.

enum Mode { CHASE_FAR, CHASE_NEAR, HOOD, CINEMATIC }
const MODE_NAMES := ["CHASE FAR", "CHASE NEAR", "HOOD", "CINEMATIC"]

# Free-look: a full 360° swing around the drive heading, up and down included.
# A drag finger (see MobileInputManager.look_delta) drives yaw/pitch directly;
# the moment nothing is dragging, both ease back to centre so letting go
# always hands the view back to the road instead of leaving you staring
# sideways mid-corner.
const LOOK_PITCH_MIN := -1.22   # ~-70°: near-vertical down, short of the car's own roof
const LOOK_PITCH_MAX := 1.31    # ~75°: near-vertical up
const LOOK_RETURN_SPEED := 2.6  # rad/s eased back once the finger lifts

var target: VehicleController
var mode: Mode = Mode.CHASE_NEAR
var base_fov := 66.0
var offroad := false
var input_mgr: MobileInputManager
var look_sensitivity := 1.0

var _dir := Vector3.BACK
var _pos := Vector3.ZERO
var _fov := 66.0
var _t := 0.0
var _noise := FastNoiseLite.new()
var _orbit := 0.0
var _look_yaw := 0.0
var _look_pitch := 0.0


func _ready() -> void:
	_noise.frequency = 1.6
	near = 0.08
	far = 2600.0


func cycle_mode() -> String:
	mode = (int(mode) + 1) % 4 as Mode
	snap()
	return MODE_NAMES[mode]


func snap() -> void:
	if target == null:
		return
	_dir = _flat(target.global_basis.z)
	_pos = _desired(0.0)
	global_position = _pos
	_fov = base_fov


func _flat(v: Vector3) -> Vector3:
	v.y = 0.0
	return v.normalized() if v.length_squared() > 1e-6 else Vector3.BACK


func _desired(speed_f: float) -> Vector3:
	var car_pos := target.global_position
	match mode:
		Mode.CHASE_NEAR:
			return car_pos - _dir * (4.7 + speed_f * 1.0) + Vector3.UP * (1.55 + speed_f * 0.2)
		Mode.CINEMATIC:
			var o := Vector3(cos(_orbit), 0.0, sin(_orbit))
			return car_pos + o * 7.5 + Vector3.UP * 1.1
		_:
			return car_pos - _dir * (6.4 + speed_f * 1.6) + Vector3.UP * (2.15 + speed_f * 0.25)


## Drains MobileInputManager's look finger into yaw/pitch for this frame, or
## eases them back to centre when nothing is being dragged.
func _update_look(delta: float) -> void:
	var d := Vector2.ZERO
	if input_mgr:
		d = input_mgr.look_delta
		input_mgr.look_delta = Vector2.ZERO
	if d.length_squared() > 0.0:
		var s := 0.0028 * look_sensitivity
		_look_yaw = wrapf(_look_yaw - d.x * s, -PI, PI)
		_look_pitch = clampf(_look_pitch - d.y * s, LOOK_PITCH_MIN, LOOK_PITCH_MAX)
	else:
		_look_yaw = move_toward(_look_yaw, 0.0, LOOK_RETURN_SPEED * delta)
		_look_pitch = move_toward(_look_pitch, 0.0, LOOK_RETURN_SPEED * delta)


## The base flat heading (`_dir`), rotated by the free-look yaw/pitch. Used to
## aim the camera in any of the 360° of directions instead of only ahead.
func _look_direction(base: Vector3) -> Vector3:
	if _look_yaw == 0.0 and _look_pitch == 0.0:
		return base
	var dir := base.rotated(Vector3.UP, _look_yaw)
	var right := dir.cross(Vector3.UP)
	if right.length_squared() > 1e-6:
		dir = dir.rotated(right.normalized(), _look_pitch)
	return dir


func _process(delta: float) -> void:
	if target == null or not is_instance_valid(target):
		return
	_t += delta
	_update_look(delta)
	var speed_f := clampf(target.speed_kmh / 300.0, 0.0, 1.0)

	# Heading: nose direction, leaning into the travel direction when sliding.
	var nose := _flat(target.global_basis.z)
	var want := nose
	var v := target.linear_velocity
	v.y = 0.0
	if v.length() > 6.0 and target.forward_speed > 0.0:
		var lean := 0.55 if target.is_drifting else 0.18
		want = nose.slerp(v.normalized(), lean).normalized()
	var lag := 2.6 if target.is_drifting else 4.5
	_dir = _dir.slerp(want, 1.0 - exp(-delta * lag)).normalized()

	if mode == Mode.HOOD:
		var xf := target.global_transform
		global_position = xf * Vector3(0.0, 1.12, 0.35)
		var hood_fwd := _look_direction(xf.basis.z)
		look_at(global_position + hood_fwd * 12.0, xf.basis.y)
		_fov = lerpf(_fov, base_fov + 8.0 + speed_f * 10.0, 1.0 - exp(-delta * 4.0))
		fov = _fov
		return

	if mode == Mode.CINEMATIC:
		_orbit += delta * 0.35
	var goal := _desired(speed_f)
	_pos = _pos.lerp(goal, 1.0 - exp(-delta * (5.0 if mode == Mode.CINEMATIC else 9.0)))
	_pos.y = maxf(_pos.y, target.global_position.y + 0.5)

	var shake := speed_f * speed_f * 0.035
	if target.nitro_active:
		shake += 0.05
	if offroad and target.speed_kmh > 30.0:
		shake += 0.05
	var s := Vector3(_noise.get_noise_2d(_t * 40.0, 0.0), _noise.get_noise_2d(0.0, _t * 40.0), 0.0) * shake
	global_position = _pos + global_basis * s

	var look_dir := _look_direction(_dir) if mode != Mode.CINEMATIC else _dir
	var look := target.global_position + Vector3.UP * 0.95 + look_dir * (2.5 if mode != Mode.CINEMATIC else 0.0)
	look_at(look, Vector3.UP)

	var fov_goal := base_fov + speed_f * 16.0 + (9.0 if target.nitro_active else 0.0)
	_fov = lerpf(_fov, fov_goal, 1.0 - exp(-delta * 3.0))
	fov = _fov
