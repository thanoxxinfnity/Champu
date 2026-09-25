class_name VehicleController
extends VehicleBody3D
## The drivable car: Godot's raycast vehicle (one suspension ray per wheel)
## plus the parts that make it feel like an arcade-sim racer — a torque curve
## and gearbox, AWD/RWD torque split, speed-sensitive steering, downforce,
## a handbrake that breaks rear traction, a drift model that holds a slide
## under throttle and answers counter-steer, nitro, and drift scoring.
##
## Inputs are plain floats written every frame by MobileInputManager (or a
## test script); nothing here reads the touchscreen directly.

signal drift_banked(points: int)
signal drift_failed
signal reset_requested

const REST := 0.20          # suspension rest length (m)
const SAG := 0.078          # measured static compression at stiffness 55
const REVERSE_MAX := 9.0    # m/s
const GEAR_SPLITS := [0.0, 0.15, 0.29, 0.45, 0.62, 0.81, 1.0]

# ── inputs ──
var in_throttle := 0.0
var in_brake := 0.0
var in_steer := 0.0          # -1 left … +1 right
var in_handbrake := false
var in_nitro := false

# ── state read by camera / HUD / FX / audio ──
var car: Dictionary
var model: Node3D
var wheels: Dictionary = {}
var forward_speed := 0.0     # m/s along the nose, negative when reversing
var speed_kmh := 0.0
var gear := 1                # 0 = N, -1 = R
var rpm := 900.0
var nitro := 1.0             # tank 0..1
var nitro_active := false
var braking := false
var slip_angle := 0.0        # degrees between heading and travel
var is_drifting := false
var drift_points := 0.0
var drift_combo := 1
var skill_total := 0
var grounded := false

var _steer := 0.0
var _drift_time := 0.0
var _drift_calm := 0.0
var _upside_down := 0.0
var _reset_to: Variant = null
var _tail_mat: StandardMaterial3D


func setup(c: Dictionary, m: Node3D) -> void:
	car = c
	model = m
	mass = c.mass
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0.0, 0.24, 0.06)
	can_sleep = false
	# Replace, not combine: the project default damping would otherwise eat
	# ~10% of the speed every second and cap every car near 190 km/h.
	linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	linear_damp = 0.0
	angular_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	angular_damp = 0.6
	contact_monitor = true
	max_contacts_reported = 4
	body_entered.connect(_on_body_entered)

	var col := CollisionShape3D.new()
	col.name = "Chassis"
	var box := BoxShape3D.new()
	var mid_w: float = c.body[c.body.size() / 2][1]
	box.size = Vector3(mid_w * 2.0 - 0.08, 0.5, c.length - 0.3)
	col.shape = box
	col.position = Vector3(0.0, 0.62, 0.0)
	add_child(col)
	var roof := CollisionShape3D.new()
	var rbox := BoxShape3D.new()
	rbox.size = Vector3(mid_w * 1.4, 0.35, c.wheelbase * 0.7)
	roof.shape = rbox
	roof.position = Vector3(0.0, 1.0, -0.2)
	add_child(roof)

	add_child(model)
	model.position = Vector3.ZERO
	_tail_mat = model.get_meta("tail_material")

	for wname in CarBuilder.WHEEL_NAMES:
		var visual := model.get_node(wname) as Node3D
		var front: bool = wname.ends_with("FL") or wname.ends_with("FR")
		var vw := VehicleWheel3D.new()
		vw.name = wname
		vw.position = visual.position + Vector3(0.0, REST - SAG, 0.0)
		vw.wheel_radius = c.wheel_radius
		vw.wheel_rest_length = REST
		vw.suspension_travel = 0.22
		vw.suspension_stiffness = 55.0
		vw.suspension_max_force = c.mass * 9.81 * 1.6
		vw.damping_compression = 2.1
		vw.damping_relaxation = 2.7
		vw.wheel_roll_influence = 0.02
		vw.use_as_steering = front
		vw.use_as_traction = (not front) or c.drivetrain == "AWD"
		vw.wheel_friction_slip = c.grip_front if front else c.grip_rear
		add_child(vw)
		model.remove_child(visual)
		vw.add_child(visual)
		visual.transform = Transform3D.IDENTITY
		wheels[wname] = vw


func _physics_process(delta: float) -> void:
	if car.is_empty():
		return
	var fwd := global_basis.z
	var v := linear_velocity
	forward_speed = v.dot(fwd)
	speed_kmh = absf(forward_speed) * 3.6
	var top: float = car.top_speed_kmh / 3.6 * (1.12 if nitro_active else 1.0)

	grounded = false
	for w in wheels.values():
		if (w as VehicleWheel3D).is_in_contact():
			grounded = true

	_update_slip(v)
	_update_steering(delta)
	_update_drive(delta, top)
	_update_drift(delta)
	_update_gearbox(top)
	_update_safety(delta)

	# Downforce: grip that grows with speed, the reason fast corners stick.
	apply_central_force(-global_basis.y * car.downforce * v.length_squared())
	# A little air drag so lifting off the throttle actually slows the car.
	apply_central_force(-v * v.length() * 0.42)

	if _tail_mat:
		_tail_mat.emission_energy_multiplier = 2.4 if (braking or gear == -1) else 0.8


func _update_slip(v: Vector3) -> void:
	var local := global_basis.inverse() * v
	if Vector2(local.x, local.z).length() > 4.0 and local.z > 0.0:
		slip_angle = rad_to_deg(atan2(local.x, local.z))
	else:
		slip_angle = 0.0


func _update_steering(delta: float) -> void:
	# Speed-sensitive lock: full at parking speed, a few degrees at 200 km/h,
	# so a full swipe at speed is a lane change, not a barrel roll.
	var v_ratio := absf(forward_speed) / 17.0
	var limit: float = maxf(car.steer_max / (1.0 + v_ratio * v_ratio), 0.045)
	if in_handbrake or is_drifting:
		limit = maxf(limit, car.steer_max * 0.55)
	var target := in_steer * limit
	var rate := 4.0 if absf(target) > absf(_steer) else 6.0
	_steer = move_toward(_steer, target, rate * delta)
	# +X is the car's left, and positive steering turns towards +X.
	steering = -_steer


func _update_drive(delta: float, top: float) -> void:
	nitro_active = in_nitro and nitro > 0.02 and in_throttle > 0.1
	if nitro_active:
		nitro = maxf(nitro - delta / 3.4, 0.0)
	else:
		nitro = minf(nitro + delta * (0.12 if is_drifting else 0.025), 1.0)

	var force := 0.0
	var brake := 0.0
	if in_throttle > 0.01:
		var ratio := clampf(forward_speed / top, 0.0, 1.0)
		var curve := 1.0 - pow(ratio, 2.4)
		# A touch more shove at launch, like a real torque peak.
		curve *= lerpf(1.15, 1.0, clampf(forward_speed / 25.0, 0.0, 1.0))
		force = in_throttle * car.engine_force * curve * (1.6 if nitro_active else 1.0)
		if forward_speed < -1.0:
			force = 0.0
			brake = car.brake_force * 1.6
	if in_brake > 0.01:
		if forward_speed > 1.0:
			brake = maxf(brake, in_brake * car.brake_force * 1.6)
			force = 0.0
		elif in_throttle < 0.01:
			brake = 0.0
			if forward_speed > -REVERSE_MAX:
				force = -in_brake * car.engine_force * 0.45
	if force == 0.0 and brake == 0.0:
		brake = 0.4  # rolling resistance
	braking = brake > 1.0 and forward_speed > 1.0

	var awd: bool = car.drivetrain == "AWD"
	var front_share: float = car.front_torque_share if awd else 0.0
	for wname in wheels.keys():
		var w: VehicleWheel3D = wheels[wname]
		var front: bool = wname.ends_with("FL") or wname.ends_with("FR")
		var share := front_share * 0.5 if front else (1.0 - front_share) * 0.5
		w.engine_force = force * share if w.use_as_traction else 0.0
		w.brake = brake
		if not front and in_handbrake:
			w.brake = car.brake_force * 0.9
			w.engine_force = 0.0 if not awd else w.engine_force * 0.3


func _update_drift(delta: float) -> void:
	var fast := speed_kmh > 32.0
	var sliding := absf(slip_angle) > 11.0 and fast and grounded
	if (in_handbrake and fast) or (sliding and in_throttle > 0.3):
		is_drifting = is_drifting or sliding or in_handbrake
	if is_drifting:
		if absf(slip_angle) < 6.0 and not in_handbrake:
			_drift_calm += delta
		else:
			_drift_calm = 0.0
		if _drift_calm > 0.45 or speed_kmh < 18.0 or not grounded:
			_end_drift()

	# Rear grip: normal, handbrake (loose), or held-slide under power.
	var rear_grip: float = car.grip_rear
	if in_handbrake:
		rear_grip = car.grip_drift
	elif is_drifting:
		rear_grip = lerpf(car.grip_drift, car.grip_rear, 0.3 + 0.5 * (1.0 - in_throttle))
	for wname in ["Wheel_RL", "Wheel_RR"]:
		var w: VehicleWheel3D = wheels[wname]
		w.wheel_friction_slip = move_toward(w.wheel_friction_slip, rear_grip, delta * 12.0)

	if is_drifting and grounded:
		_drift_time += delta
		# Steering into the slide adds rotation (fading out as the angle
		# grows), counter-steer takes it away at full strength.
		var into := signf(_steer) == signf(slip_angle) and absf(slip_angle) > 2.0
		var assist := 2.0 * (clampf(1.0 - absf(slip_angle) / 40.0, 0.0, 1.0) if into else 1.0)
		apply_torque(global_basis.y * (-_steer) * mass * assist)
		# Keep momentum through the slide when the driver stays on the gas.
		var vdir := linear_velocity.normalized()
		apply_central_force(vdir * in_throttle * car.engine_force * 0.22)
		# Beyond ~35° pull the nose back towards the direction of travel, so a
		# held slide settles at a steerable angle instead of becoming a spin.
		var excess := maxf(absf(slip_angle) - 30.0, 0.0)
		apply_torque(global_basis.y * signf(slip_angle) * excess * mass * 0.22)
		var yaw_cap := 1.7
		if absf(angular_velocity.y) > yaw_cap:
			angular_velocity.y = signf(angular_velocity.y) * yaw_cap
		if absf(slip_angle) > 62.0:
			angular_velocity.y *= 0.9
		drift_combo = mini(1 + int(_drift_time / 2.0), 5)
		drift_points += absf(slip_angle) * speed_kmh * delta * 0.06 * drift_combo
	else:
		_drift_time = 0.0


func _end_drift() -> void:
	is_drifting = false
	_drift_calm = 0.0
	if drift_points >= 50.0:
		var pts := int(drift_points)
		skill_total += pts
		drift_banked.emit(pts)
	drift_points = 0.0
	drift_combo = 1


func _on_body_entered(body: Node) -> void:
	if is_drifting and body.is_in_group("obstacle"):
		drift_points = 0.0
		is_drifting = false
		drift_combo = 1
		drift_failed.emit()


func _update_gearbox(top: float) -> void:
	if forward_speed < -0.5 and in_brake > 0.0:
		gear = -1
		rpm = 1200.0 + absf(forward_speed) / REVERSE_MAX * 4500.0
		return
	var frac := clampf(absf(forward_speed) / top, 0.0, 0.999)
	gear = 1
	for i in range(1, GEAR_SPLITS.size()):
		if frac < GEAR_SPLITS[i]:
			gear = i
			break
	var lo: float = GEAR_SPLITS[gear - 1]
	var hi: float = GEAR_SPLITS[gear]
	var target := 1100.0 + (frac - lo) / (hi - lo) * 6600.0
	if gear == 1 and speed_kmh < 3.0:
		target = 900.0 + in_throttle * 2500.0
	if is_drifting or (in_handbrake and in_throttle > 0.2):
		target = maxf(target, 6200.0)  # clutch-kick scream while sliding
	rpm = lerpf(rpm, target, 0.2)


func _update_safety(delta: float) -> void:
	if global_basis.y.y < 0.25:
		_upside_down += delta
	else:
		_upside_down = 0.0
	if _upside_down > 2.0 or global_position.y < -25.0:
		_upside_down = 0.0
		reset_requested.emit()


## Teleports the car (applied inside the physics step so it is not fought).
func reset_to(xform: Transform3D) -> void:
	_reset_to = xform
	_end_drift()


func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	if _reset_to != null:
		state.transform = _reset_to
		state.linear_velocity = Vector3.ZERO
		state.angular_velocity = Vector3.ZERO
		_reset_to = null
		_steer = 0.0


## Rear-wheel contact points and how hard each is sliding (0 grip … 1 slide),
## for smoke and skid marks.
func rear_wheel_slides() -> Array:
	var out := []
	for wname in ["Wheel_RL", "Wheel_RR"]:
		var w: VehicleWheel3D = wheels[wname]
		var slide := 0.0
		if w.is_in_contact():
			slide = 1.0 - w.get_skidinfo()
			if is_drifting or (in_handbrake and speed_kmh > 20.0):
				slide = maxf(slide, 0.85)
			if braking and speed_kmh > 60.0 and in_brake > 0.8:
				slide = maxf(slide, 0.5)
		var contact: Vector3 = w.global_position - global_basis.y * car.wheel_radius
		out.append([contact, slide])
	return out
