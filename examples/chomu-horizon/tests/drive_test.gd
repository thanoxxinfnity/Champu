extends SceneTree
## Physics sanity run: launch, top speed, braking, cornering, handbrake drift,
## reverse — for every car. Run with --fixed-fps 60 so a frame is 1/60 s.

var world: Node3D
var car: VehicleController
var idx := 0
var frame := 0
var phase := ""
var rep := {}
var t0 := 0
var start_heading := Vector3.ZERO
var max_slip := 0.0
var drift_seen := false
var banked := 0
var fails: Array[String] = []
var trace: Array = []
var held := 0


func _initialize() -> void:
	# Car physics on a flat test pad (the maps are hilly on purpose).
	world = StaticBody3D.new()
	var cs := CollisionShape3D.new()
	cs.shape = WorldBoundaryShape3D.new()
	world.add_child(cs)
	root.add_child(world)
	_spawn()


func _spawn() -> void:
	if car:
		car.queue_free()
	var def := CarCatalog.get_car(idx)
	car = VehicleController.new()
	car.setup(def, CarBuilder.build(def))
	root.add_child(car)
	# Straight, open ground well away from scenery for the numbers.
	car.global_transform = Transform3D(Basis.IDENTITY, Vector3(-300, 0.6, -600))
	car.drift_banked.connect(func(p: int) -> void: banked += p)
	frame = 0
	phase = "settle"
	max_slip = 0.0
	drift_seen = false
	banked = 0
	trace = []
	held = 0
	rep = {"car": def.id}


func _inp(th: float, br: float, st: float, hb: bool) -> void:
	car.in_throttle = th
	car.in_brake = br
	car.in_steer = st
	car.in_handbrake = hb


func _process(_delta: float) -> bool:
	frame += 1
	match phase:
		"settle":
			_inp(0, 0, 0, false)
			if frame == 60:
				rep["settle_y"] = snappedf(car.global_position.y, 0.001)
				rep["settle_up"] = snappedf(car.global_basis.y.y, 0.001)
				phase = "launch"
				t0 = frame
		"launch":
			_inp(1, 0, 0, false)
			if car.speed_kmh >= 100.0 and not rep.has("0_100_s"):
				rep["0_100_s"] = snappedf((frame - t0) / 60.0, 0.01)
			if frame - t0 == 60 * 14:
				rep["v_14s_kmh"] = int(car.speed_kmh)
				rep["heading_drift_deg"] = snappedf(rad_to_deg(car.global_basis.z.angle_to(Vector3.BACK)), 0.1)
				phase = "brake"
				t0 = frame
				rep["brake_from"] = int(car.speed_kmh)
		"brake":
			_inp(0, 1, 0, false)
			if car.speed_kmh < 3.0:
				rep["brake_100_0_m_s2"] = snappedf(rep.brake_from / 3.6 / ((frame - t0) / 60.0), 0.1)
				phase = "corner_run"
				t0 = frame
		"corner_run":
			_inp(1, 0, 0, false)
			if car.speed_kmh >= 90.0:
				phase = "corner"
				t0 = frame
				start_heading = car.global_basis.z
		"corner":
			_inp(0.5, 0, 1, false)
			if frame - t0 == 120:
				rep["turn_2s_deg"] = int(rad_to_deg(start_heading.signed_angle_to(car.global_basis.z, Vector3.UP)))
				rep["corner_speed"] = int(car.speed_kmh)
				rep["corner_up"] = snappedf(car.global_basis.y.y, 0.01)
				phase = "drift_run"
				t0 = frame
		"drift_run":
			_inp(1, 0, 0, false)
			if car.speed_kmh >= 95.0 or frame - t0 > 600:
				phase = "drift"
				t0 = frame
		"drift":
			var k := frame - t0
			_inp(0.8 if k > 20 else 0.0, 0, -1.0 if k < 70 else 0.35, k < 35)
			max_slip = maxf(max_slip, absf(car.slip_angle))
			drift_seen = drift_seen or car.is_drifting
			if k % 20 == 0:
				trace.append(int(car.slip_angle))
			if k > 70 and absf(car.slip_angle) > 12.0 and absf(car.slip_angle) < 50.0:
				held += 1
			if k == 240:
				rep["drift_max_slip"] = int(max_slip)
				rep["slip_trace"] = trace.duplicate()
				rep["held_drift_s"] = snappedf(held / 60.0, 0.01)
				rep["drifting_seen"] = drift_seen
				rep["drift_up"] = snappedf(car.global_basis.y.y, 0.01)
				phase = "drift_end"
				t0 = frame
		"drift_end":
			_inp(0, 0.6, 0, false)
			if frame - t0 == 120:
				rep["drift_points_banked"] = banked
				phase = "reverse"
				t0 = frame
		"reverse":
			_inp(0, 1, 0, false)
			if frame - t0 == 180:
				rep["reverse_kmh"] = snappedf(car.forward_speed * 3.6, 0.1)
				rep["gear"] = car.gear
				print(rep)
				_judge()
				idx += 1
				if idx >= CarCatalog.count():
					print("FAILS: ", fails)
					return true
				_spawn()
	return false


func _judge() -> void:
	var id: String = rep.car
	if absf(rep.settle_up - 1.0) > 0.01:
		fails.append(id + ": not level at rest")
	if not rep.has("0_100_s") or rep["0_100_s"] > 6.0:
		fails.append(id + ": 0-100 too slow")
	if rep.v_14s_kmh < 200:
		fails.append(id + ": top speed too low")
	if rep.brake_100_0_m_s2 < 6.0:
		fails.append(id + ": weak brakes")
	if absf(rep.turn_2s_deg) < 25:
		fails.append(id + ": does not turn")
	if rep.turn_2s_deg > 0:
		fails.append(id + ": steer right turned left")
	if rep.corner_up < 0.8 or rep.drift_up < 0.8:
		fails.append(id + ": rolled over")
	if not rep.drifting_seen or rep.drift_max_slip < 15:
		fails.append(id + ": handbrake does not drift")
	if rep.reverse_kmh > -3.0:
		fails.append(id + ": no reverse")
