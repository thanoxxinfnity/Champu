class_name Vehicle
extends Mount
## A drivable car, truck, bus or monster truck. The body is a real model (its own wheels cut away by tools/prep_vehicle.py, which also measured where they were:
## scripts/vehicle_data.gd) and four real tyre models are mounted there, so the tyres really roll with the speed, the front pair steers, the body squats when you
## accelerate, leans in the bends and bounces on the road (the bigger the vehicle, the more).
## The driving is arcade (speed and yaw, no wheel simulation): stable on a phone, the same on every machine, and cheap to send over the network.

# kind -> body model, tyre model, length (m), top speed (m/s), acceleration, turn rate, brake, body bounce, body lean
const SPEC := {
	"car": {"title": "ANIME HATCHBACK", "len": 4.1, "max": 38.0, "accel": 13.0, "turn": 1.25, "brake": 26.0, "bob": 0.012, "lean": 0.10},
	"sports": {"title": "SUPERCAR", "len": 4.4, "max": 50.0, "accel": 17.0, "turn": 1.35, "brake": 30.0, "bob": 0.008, "lean": 0.12},
	"pickup": {"title": "PICKUP", "len": 5.0, "max": 33.0, "accel": 11.0, "turn": 1.1, "brake": 24.0, "bob": 0.02, "lean": 0.09},
	"jeep": {"title": "OFF-ROAD JEEP", "len": 4.0, "max": 31.0, "accel": 12.0, "turn": 1.2, "brake": 24.0, "bob": 0.03, "lean": 0.12},
	"van": {"title": "DELIVERY VAN", "len": 4.8, "max": 30.0, "accel": 9.0, "turn": 1.0, "brake": 22.0, "bob": 0.02, "lean": 0.1},
	"taxi": {"title": "CITY TAXI", "len": 4.5, "max": 34.0, "accel": 12.0, "turn": 1.15, "brake": 25.0, "bob": 0.012, "lean": 0.1},
	"police": {"title": "PATROL CAR", "len": 4.6, "max": 43.0, "accel": 15.0, "turn": 1.3, "brake": 28.0, "bob": 0.01, "lean": 0.11},
	"bus": {"title": "CITY BUS", "len": 10.0, "max": 22.0, "accel": 6.0, "turn": 0.7, "brake": 18.0, "bob": 0.03, "lean": 0.07},
	"truck": {"title": "CARGO TRUCK", "len": 7.2, "max": 24.0, "accel": 8.0, "turn": 0.8, "brake": 20.0, "bob": 0.03, "lean": 0.07},
	"firetruck": {"title": "FIRE ENGINE", "len": 8.5, "max": 26.0, "accel": 7.0, "turn": 0.75, "brake": 20.0, "bob": 0.03, "lean": 0.07},
	"buggy": {"title": "DUNE BUGGY", "len": 3.4, "max": 37.0, "accel": 15.0, "turn": 1.5, "brake": 26.0, "bob": 0.05, "lean": 0.16},
	"monster": {"title": "MONSTER TRUCK", "len": 5.6, "max": 27.0, "accel": 10.0, "turn": 0.95, "brake": 18.0, "bob": 0.08, "lean": 0.14, "tire": "monster_tire"},
	"ambulance": {"title": "AMBULANCE", "len": 5.2, "max": 38.0, "accel": 13.0, "turn": 1.1, "brake": 26.0, "bob": 0.015, "lean": 0.1},
}
const DIR := "res://assets/vehicles/"

var spec: Dictionary
var wheels: Array = []                   # [pivot, spin, is_front]
var _steer_v := 0.0
var _t := 0.0
var _pitch := 0.0
var _last_speed := 0.0
var _dust: CPUParticles3D
var _bumped := 0.0
var _r := 0.35


static func available(k: String) -> bool:
	return ResourceLoader.exists("%s%s_body.glb" % [DIR, k]) and VehicleData.SPECS.has(k)


func setup(id: int, k: String) -> void:
	mount_id = id
	kind = k
	spec = SPEC[k]
	title = String(spec.title)
	name = "Vehicle%d" % id
	collision_layer = 8
	collision_mask = 1
	var L: float = spec.len
	var data: Dictionary = VehicleData.SPECS.get(k, {})
	var W: float = float(data.get("w", 0.4)) * L
	var H: float = float(data.get("h", 0.3)) * L
	_r = float(data.get("r", 0.08)) * L
	cam_dist = 4.5 + L * 0.55
	radius = maxf(L * 0.5, 2.4)
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(W * 0.9, H * 0.8, L * 0.92)
	cs.shape = box
	cs.position.y = H * 0.5 + 0.1
	add_child(cs)
	view = Node3D.new()
	add_child(view)
	var body := ModelKit.fitted("%s%s_body.glb" % [DIR, k], L, "bottom")
	if body != null:
		view.add_child(body)
		Anime.style(body)                 # (no ink outline: the generated bodies are triangle soup and the hull would fray)
	else:
		Mat.box(view, Vector3(0, H * 0.5, 0), Vector3(W, H, L), Mat.flat(Color(0.8, 0.3, 0.4)))
	_cull(view)
	var tire_path := "%s%s.glb" % [DIR, String(spec.get("tire", "tire"))]
	var pts: Array = data.get("wheels", [[-0.17, 0.08, -0.3], [0.17, 0.08, -0.3], [-0.17, 0.08, 0.3], [0.17, 0.08, 0.3]])
	for i in pts.size():
		var p: Array = pts[i]
		var front := float(p[2]) < 0.0
		var pivot := Node3D.new()
		pivot.position = Vector3(float(p[0]) * L, _r, float(p[2]) * L)
		view.add_child(pivot)
		var spin := Node3D.new()
		pivot.add_child(spin)
		var tire := ModelKit.fitted(tire_path, _r * 2.0, "center")
		if tire != null:
			# the tyre model's axle is along X once fitted by its longest side (a tyre is as tall as it is long)
			spin.add_child(tire)
			tire.rotation.y = PI * 0.5                  # the tyre model lies with its axle along Z: turn it to X
			Anime.style(tire, true, 0.01)
		else:
			var cyl := Mat.cyl(spin, Vector3.ZERO, _r, _r * 0.8, Mat.flat(Color(0.1, 0.1, 0.12)))
			cyl.rotation_degrees = Vector3(0, 0, 90)
		wheels.append([pivot, spin, front])
	seat = Marker3D.new()
	seat.position = Vector3(-W * 0.22, H * 0.75, -L * 0.1)
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
		speed = move_toward(speed, 0.0, ((4.0 if is_driven else 6.0) + absf(speed) * 0.25) * delta)
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
	if is_driven and absf(speed) > 6.0 and get_parent() != null and get_parent().has_method("smash"):
		# the front of the vehicle flattens whatever grows there (a big truck reaches wider); trees slow it down
		var hits: int = get_parent().smash(global_position + forward() * (float(spec.len) * 0.4 * signf(speed)), 1.2 + float(spec.len) * 0.12)
		if hits > 0:
			speed *= pow(0.93, hits)
	move_and_slide()
	if is_on_wall():
		var k := get_wall_normal()
		if absf(forward().dot(k)) > 0.5:
			speed *= 0.4
			_bumped = 0.3
	if absf(before) - absf(speed) > 6.0:
		_bumped = 0.35


func _animate(delta: float) -> void:
	var mx: float = spec.max
	var f := clampf(absf(speed) / mx, 0.0, 1.0)
	for w in wheels:
		(w[1] as Node3D).rotation.x -= speed * delta / _r
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
