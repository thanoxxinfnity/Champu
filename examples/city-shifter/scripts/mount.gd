class_name Mount
extends CharacterBody3D
## Anything a player can sit on or in: a vehicle or a horse. One rider at a time. The rider's phone simulates the mount and sends its state; every other
## phone only follows it (interpolated ~160 ms in the past, like a player), so a truck looks as smooth as a person at 200 ms ping.
##   input: throttle -1..1 (stick up = forward), steer -1..1 (stick right = right), action (the JUMP button: handbrake for cars, jump for horses)

signal occupied(peer: int)

const INTERP_DELAY := 0.16

var mount_id := 0
var kind := "car"
var occupant := 0                        # peer id of the rider, 0 = free
var yaw := 0.0
var speed := 0.0                         # m/s along the facing (negative = reverse)
var steer := 0.0
var throttle := 0.0
var action := false
var boost_in := false                    # the BOOST button is held
var boost := 1.0                         # energy 0..1
var boosting := false
var view: Node3D                         # the visible model, moved by the animation (bob, lean) and not by the physics
var seat: Marker3D                       # where the rider sits (local to the mount)
var radius := 1.6                        # how close you must be to get on
var cam_dist := 6.0
var title := "VEHICLE"
var is_driven := false                   # simulated here (the rider is the local player)
var _snaps: Array = []                   # [clock, pos, yaw, speed, steer]
var _clock := 0.0


func is_free() -> bool:
	return occupant == 0


func set_input(thr: float, st: float, act: bool, bst := false) -> void:
	throttle = clampf(thr, -1.0, 1.0)
	steer = clampf(st, -1.0, 1.0)
	action = act
	boost_in = bst


## Boost energy: drains while the button is held and the mount is moving, comes back when not.
func tick_boost(delta: float) -> void:
	boosting = boost_in and boost > 0.02 and is_driven and absf(speed) > 1.0
	boost = clampf(boost + (-0.45 if boosting else 0.18) * delta, 0.0, 1.0)


## [position, yaw, speed, steer] — what the other phones need.
func state() -> Array:
	return [global_position, yaw, speed, steer]


func push_state(s: Array, clock: float) -> void:
	_clock = clock
	_snaps.append([clock, s[0], float(s[1]), float(s[2]), float(s[3])])
	while _snaps.size() > 12:
		_snaps.pop_front()


## Follow the snapshots of the remote rider (call every physics frame while someone else rides this).
func follow(delta: float) -> void:
	_clock += delta
	if _snaps.is_empty():
		return
	var t := _clock - INTERP_DELAY
	var a: Array = _snaps[0]
	var b: Array = _snaps[_snaps.size() - 1]
	for i in range(_snaps.size() - 1):
		if _snaps[i][0] <= t and _snaps[i + 1][0] >= t:
			a = _snaps[i]
			b = _snaps[i + 1]
			break
	var k := 1.0
	if b[0] > a[0] and t <= float(b[0]):
		k = clampf((t - float(a[0])) / (float(b[0]) - float(a[0])), 0.0, 1.0)
	var pos: Vector3 = (a[1] as Vector3).lerp(b[1] as Vector3, k)
	if t > float(b[0]):
		var ahead := minf(t - float(b[0]), 0.3)
		pos = (b[1] as Vector3) + Vector3(-sin(float(b[2])), 0, -cos(float(b[2]))) * float(b[3]) * ahead
	global_position = global_position.lerp(pos, minf(1.0, delta * 18.0))
	yaw = lerp_angle(yaw, lerp_angle(float(a[2]), float(b[2]), k), minf(1.0, delta * 14.0))
	speed = lerpf(float(a[3]), float(b[3]), k)
	steer = lerpf(float(a[4]), float(b[4]), k)
	rotation.y = yaw


func clear_snaps() -> void:
	_snaps.clear()


func seat_global() -> Vector3:
	return seat.global_position if seat != null else global_position + Vector3(0, 1.2, 0)


func forward() -> Vector3:
	return Vector3(-sin(yaw), 0.0, -cos(yaw))


## Far away it is not drawn at all (and not outlined): every mesh under `n` gets a visibility range.
func _cull(n: Node) -> void:
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var g := mi as GeometryInstance3D
		g.visibility_range_end = 110.0
		g.visibility_range_end_margin = 10.0
		g.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
