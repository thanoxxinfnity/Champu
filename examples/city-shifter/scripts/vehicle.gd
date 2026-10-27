class_name Vehicle
extends Mount
## A drivable truck, monster truck or hatchback. The body is a real model made without wheels; four real tyre models are mounted on it, so the tyres really
## roll with the speed, the front pair steers, the body squats when you accelerate, leans in the bends and bounces on the road (the bigger the truck, the more).
## The driving is arcade (speed and yaw, no wheel simulation): stable on a phone, the same on every machine, and cheap to send over the network.

const SPEC := {
	"truck": {"title": "CARGO TRUCK", "body": "res://assets/vehicles/truck_body.glb", "tire": "res://assets/vehicles/tire.glb", "len": 7.2, "wid": 2.6, "tire_r": 0.55,
		"axle": [0.34, -0.3], "ride": 0.55, "max": 24.0, "accel": 8.0, "turn": 0.8, "brake": 20.0, "bob": 0.03, "lean": 0.07, "seat": Vector3(-0.6, 1.9, -1.6), "cam": 9.5},
	"monster": {"title": "MONSTER TRUCK", "body": "res://assets/vehicles/monster_body.glb", "tire": "res://assets/vehicles/monster_tire.glb", "len": 5.6, "wid": 3.1, "tire_r": 1.05,
		"axle": [0.31, -0.31], "ride": 1.15, "max": 26.0, "accel": 10.0, "turn": 0.95, "brake": 18.0, "bob": 0.08, "lean": 0.14, "seat": Vector3(0, 2.7, -0.6), "cam": 10.5},
	"car": {"title": "ANIME HATCHBACK", "body": "res://assets/vehicles/car_body.glb", "tire": "res://assets/vehicles/tire.glb", "len": 4.1, "wid": 1.9, "tire_r": 0.34, "axle": [0.3, -0.3],
		"ride": 0.32, "max": 38.0, "accel": 13.0, "turn": 1.25, "brake": 26.0, "bob": 0.012, "lean": 0.1, "seat": Vector3(-0.4, 1.0, -0.2), "cam": 7.5},
}

var spec: Dictionary
var wheels: Array = []                   # [pivot, spin, is_front]
var _steer_v := 0.0
var _t := 0.0
var _pitch := 0.0
var _last_speed := 0.0
var _dust: CPUParticles3D
var _bumped := 0.0


static func available(k: String) -> bool:
	return ResourceLoader.exists(String(SPEC[k].body)) and ResourceLoader.exists(String(SPEC[k].tire))


func setup(id: int, k: String) -> void:
	mount_id = id
	kind = k
	spec = SPEC[k]
	title = String(spec.title)
	cam_dist = float(spec.cam)
	name = "Vehicle%d" % id
	collision_layer = 8
	collision_mask = 1
	var L: float = spec.len
	var W: float = spec.wid
	var r: float = spec.tire_r
	radius = maxf(L * 0.5, 2.4)
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(W * 0.9, 1.6, L * 0.9)
	cs.shape = box
	cs.position.y = 0.2 + float(spec.ride) + 0.8
	add_child(cs)
	view = Node3D.new()
	add_child(view)
	var body := ModelKit.fitted(String(spec.body), L, "bottom")
	if body != null:
		body.position.y = float(spec.ride) * 0.8
		view.add_child(body)
		Anime.style(body, true, 0.03)
	else:
		Mat.box(view, Vector3(0, float(spec.ride) + 0.7, 0), Vector3(W, 1.4, L), Mat.flat(Color(0.8, 0.3, 0.4)))
	var ax: Array = spec.axle
	for i in 4:
		var front := i < 2
		var sx := -1.0 if i % 2 == 0 else 1.0
		var pivot := Node3D.new()
		pivot.position = Vector3(sx * (W * 0.5 - r * 0.45), r, -L * float(ax[0] if front else ax[1]))
		view.add_child(pivot)
		var spin := Node3D.new()
		pivot.add_child(spin)
		var tire := ModelKit.fitted(String(spec.tire), r * 2.0, "center")
		if tire != null:
			spin.add_child(tire)
			if sx > 0.0:
				tire.rotation.y = PI
			Anime.style(tire, true, 0.02)
		else:
			Mat.cyl(spin, Vector3.ZERO, r, 0.4, Mat.flat(Color(0.1, 0.1, 0.12))).rotation_degrees = Vector3(0, 0, 90)
		wheels.append([pivot, spin, front])
	seat = Marker3D.new()
	seat.position = spec.seat
	add_child(seat)
	_dust = CPUParticles3D.new()
	_dust.amount = 24
	_dust.lifetime = 0.9
	_dust.emitting = false
	_dust.direction = Vector3(0, 1, 0.5)
	_dust.spread = 40.0
	_dust.initial_velocity_min = 1.0
	_dust.initial_velocity_max = 3.0
	_dust.gravity = Vector3(0, -1.0, 0)
	_dust.scale_amount_min = 0.25
	_dust.scale_amount_max = 0.7
	var sm := SphereMesh.new()
	sm.radius = 0.5
	sm.height = 1.0
	sm.radial_segments = 6
	sm.rings = 3
	_dust.mesh = sm
	_dust.material_override = Mat.unlit(Color(0.85, 0.78, 0.65), 0.55)
	_dust.position = Vector3(0, 0.3, L * 0.45)
	add_child(_dust)


func _physics_process(delta: float) -> void:
	_t += delta
	if occupant != 0 and not is_driven:
		follow(delta)
		_steer_v = steer
	else:
		_drive(delta)
	_animate(delta)


func _drive(delta: float) -> void:
	tick_boost(delta)
	var mx: float = float(spec.max) * (1.4 if boosting else 1.0)
	var thr := throttle if is_driven else 0.0
	var acc := float(spec.accel) * thr * (1.8 if boosting else 1.0)
	if thr * speed < -0.1:
		acc = float(spec.brake) * thr          # pressing the other way brakes first
	speed += acc * delta
	if absf(thr) < 0.05:
		speed = move_toward(speed, 0.0, (3.0 if is_driven else 5.0) * delta)
	speed -= speed * 0.04 * delta * (speed / mx) * 4.0
	if action and is_driven:
		speed = move_toward(speed, 0.0, float(spec.brake) * delta)
	speed = clampf(speed, -mx * 0.35, mx)
	var st := steer if is_driven else 0.0
	_steer_v = move_toward(_steer_v, st, 4.5 * delta)
	yaw -= _steer_v * float(spec.turn) * clampf(speed / 7.0, -1.0, 1.0) * delta
	rotation.y = yaw
	velocity = forward() * speed
	velocity.y = -4.0
	var before := speed
	move_and_slide()
	if is_on_wall():
		var k := get_wall_normal()
		if absf(forward().dot(k)) > 0.5:
			speed *= 0.4
			_bumped = 0.3
	if absf(before) - absf(speed) > 6.0:
		_bumped = 0.35


func _animate(delta: float) -> void:
	var r: float = spec.tire_r
	var mx: float = spec.max
	var f := clampf(absf(speed) / mx, 0.0, 1.0)
	for w in wheels:
		(w[1] as Node3D).rotation.x -= speed * delta / r
		if bool(w[2]):
			(w[0] as Node3D).rotation.y = -_steer_v * 0.5
	var accel := (speed - _last_speed) / maxf(delta, 0.0001)
	_last_speed = speed
	_pitch = lerpf(_pitch, clampf(accel * 0.006, -0.08, 0.08), minf(1.0, delta * 6.0))
	_bumped = maxf(0.0, _bumped - delta)
	var bob := sin(_t * (6.0 + f * 22.0)) * float(spec.bob) * f + sin(_t * 41.0) * float(spec.bob) * 0.3 * f
	view.position.y = bob + (0.05 if _bumped > 0.0 else 0.0)
	view.rotation = Vector3(_pitch + (0.03 if _bumped > 0.0 else 0.0), 0.0, -_steer_v * f * float(spec.lean))
	_dust.emitting = absf(speed) > 4.0
