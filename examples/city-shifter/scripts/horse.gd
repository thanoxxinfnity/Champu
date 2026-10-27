class_name Horse
extends Mount
## A rideable horse: a real rigged model (tools/autorig_quad.py gives it a spine, a neck, a head, ears, four-joint legs and a tail) animated by HorseRig.
## The stick sets the gait: a light push walks, further trots, all the way gallops; the JUMP button jumps. Without a rider it stands, breathes, flicks its
## ears and tail and looks around.

const MODEL := "res://assets/animals/horse.glb"
const WALK := 2.4
const TROT := 6.0
const GALLOP := 12.5

var rig := HorseRig.new()
var rigged := false
var _vy := 0.0
var _t := 0.0
var _speed_v := 0.0
var _holder: Node3D
var _last_step := 0
signal hoofed(strength: float)


static func available() -> bool:
	return ResourceLoader.exists(MODEL)


func setup(id: int) -> void:
	mount_id = id
	kind = "horse"
	title = "HORSE"
	cam_dist = 5.4
	radius = 1.9
	name = "Horse%d" % id
	collision_layer = 8
	collision_mask = 1
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(0.8, 1.5, 2.2)
	cs.shape = box
	cs.position.y = 0.85
	add_child(cs)
	view = Node3D.new()
	add_child(view)
	_holder = view
	var m := ModelKit.fitted(MODEL, 2.4, "bottom")
	if m != null:
		view.add_child(m)
		var skel := _find_skeleton(m)
		rigged = skel != null and rig.setup(skel)
		Anime.style(m, true, 0.025)
		_cull(m)
	else:
		Mat.box(view, Vector3(0, 1.0, 0), Vector3(0.7, 1.0, 2.0), Mat.flat(Color(0.9, 0.85, 0.8)))
	seat = Marker3D.new()
	seat.position = Vector3(0, 1.62, 0.1)
	add_child(seat)


func _find_skeleton(n: Node) -> Skeleton3D:
	for s in n.find_children("*", "Skeleton3D", true, false):
		return s as Skeleton3D
	return null


func _physics_process(delta: float) -> void:
	_t += delta
	if occupant != 0 and not is_driven:
		follow(delta)
		_speed_v = speed
	else:
		_run(delta)
	_animate(delta)


func _run(delta: float) -> void:
	tick_boost(delta)
	var want := 0.0
	if is_driven:
		var thr := absf(throttle)
		if thr > 0.08:
			want = _gait_speed(thr)
			want *= signf(throttle)
			if want < 0.0:
				want = maxf(want, -WALK * 0.7)
	if boosting and want > 0.0:
		want *= 1.35
	speed = move_toward(speed, want, (7.0 if absf(want) > absf(speed) else 10.0) * delta)
	var turn := lerpf(1.7, 0.75, clampf(absf(speed) / GALLOP, 0.0, 1.0)) if is_driven else 0.0
	yaw -= steer * turn * clampf(absf(speed) / 1.5, 0.0, 1.0) * delta * signf(speed if absf(speed) > 0.01 else 1.0)
	rotation.y = yaw
	var g := float(ProjectSettings.get_setting("physics/3d/default_gravity"))
	if is_on_floor():
		_vy = -1.0
		if action and is_driven and absf(speed) > 0.5:
			_vy = 7.5
	else:
		_vy -= g * delta
	velocity = forward() * speed
	velocity.y = _vy
	move_and_slide()
	if is_on_wall() and absf(forward().dot(get_wall_normal())) > 0.5:
		speed *= 0.5
	_speed_v = speed


## Stick push (0..1) -> metres per second: a light push walks, the middle trots, the far end gallops.
static func _gait_speed(thr: float) -> float:
	if thr < 0.3:
		return lerpf(WALK * 0.6, WALK, thr / 0.3)
	if thr < 0.55:
		return lerpf(WALK, TROT, (thr - 0.3) / 0.25)
	if thr < 0.75:
		return TROT + (thr - 0.55) * 4.0
	return lerpf(TROT + 0.8, GALLOP, (thr - 0.75) / 0.25)


func _animate(delta: float) -> void:
	if rigged:
		var step := int(floor(rig.phase * 4.0))
		if step != _last_step:
			_last_step = step
			if absf(_speed_v) > 0.6 and is_on_floor():
				hoofed.emit(clampf(absf(_speed_v) / GALLOP, 0.0, 1.0))
		rig.update(delta, _speed_v, not is_on_floor() and global_position.y > 0.25, steer if (occupant != 0) else 0.0)
		view.position.y = rig.bob
		view.rotation.x = rig.pitch * 0.3
	else:
		view.position.y = absf(sin(_t * 10.0)) * 0.06 * clampf(absf(_speed_v) / GALLOP, 0.0, 1.0)
