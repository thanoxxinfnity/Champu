extends Node
## A car that drives well without tuning: stable, grippy, hard to flip, with speed-sensitive steering.
##   var car := Vehicle.create(world, Color("#e63946"), Vector3(0, 1, 0))
##   func _update(delta): Vehicle.drive(car, Input.get_action_strength("accelerate") - Input.get_action_strength("brake"),
##                                      Input.get_axis("steer_right", "steer_left"), delta)
## The car faces -Z. Autoload name: Vehicle

var _flipped := {}


## Builds a drivable car (VehicleBody3D) with the Props.car body, four wheels, a low centre of mass and sane suspension.
func create(parent: Node, color: Color = Color("#e63946"), position: Vector3 = Vector3(0, 1.0, 0), mass: float = 900.0) -> VehicleBody3D:
	var car := VehicleBody3D.new()
	car.name = "Car"
	car.mass = mass
	car.center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	car.center_of_mass = Vector3(0, -0.35, 0)
	car.linear_damp = 0.05
	car.angular_damp = 1.2
	car.position = position
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1.9, 0.9, 4.2)
	shape.shape = box
	shape.position.y = 0.72
	car.add_child(shape)
	var body := Props.car(color)
	car.add_child(body)
	car.set_meta("body", body)
	for sx in [-1.0, 1.0]:
		for sz in [-1.35, 1.35]:
			var w := VehicleWheel3D.new()
			w.position = Vector3(sx * 0.98, 0.42, sz)
			w.use_as_steering = sz < 0.0
			w.use_as_traction = true
			w.wheel_radius = 0.42
			w.wheel_rest_length = 0.25
			w.suspension_travel = 0.3
			w.suspension_stiffness = 52.0
			w.suspension_max_force = 9000.0
			w.damping_compression = 0.9
			w.damping_relaxation = 1.1
			w.wheel_friction_slip = 3.2
			w.wheel_roll_influence = 0.0
			car.add_child(w)
	parent.add_child(car)
	return car


## Call every frame. throttle -1..1 (negative reverses), steer -1..1 (positive = left), brake 0..1.
func drive(car: VehicleBody3D, throttle: float, steer: float, delta: float, brake: float = 0.0, max_speed: float = 32.0) -> void:
	var speed := car.linear_velocity.length()
	var forward := -car.global_transform.basis.z
	var along := car.linear_velocity.dot(forward)
	var angle := lerpf(0.52, 0.16, clampf(speed / max_speed, 0.0, 1.0))
	car.steering = lerpf(car.steering, steer * angle, minf(1.0, delta * 9.0))
	var power := 3600.0 * (1.0 - clampf(speed / max_speed, 0.0, 1.0))
	if throttle < 0.0 and along > 1.5:
		car.engine_force = 0.0
		car.brake = absf(throttle) * 28.0 + brake * 28.0
	else:
		# VehicleBody3D pushes along +Z for a positive force; the kit's cars face -Z, so the sign is flipped here.
		car.engine_force = -throttle * power
		car.brake = brake * 28.0
	car.apply_central_force(Vector3.DOWN * speed * 14.0)
	_spin_wheels(car, along, delta)
	_recover(car, delta)


func speed_kmh(car: VehicleBody3D) -> float:
	return car.linear_velocity.length() * 3.6


func _spin_wheels(car: VehicleBody3D, along: float, delta: float) -> void:
	var body: Node = car.get_meta("body") if car.has_meta("body") else null
	if body == null or not body.has_meta("wheels"):
		return
	for wheel in body.get_meta("wheels"):
		if is_instance_valid(wheel):
			wheel.rotate_x(-along / 0.42 * delta)


## Puts the car back on its wheels if it has been on its side or roof for a moment.
func _recover(car: VehicleBody3D, delta: float) -> void:
	var up_dot := car.global_transform.basis.y.dot(Vector3.UP)
	var id := car.get_instance_id()
	if up_dot < 0.35:
		_flipped[id] = _flipped.get(id, 0.0) + delta
		if _flipped[id] > 1.4:
			reset_upright(car)
	else:
		_flipped[id] = 0.0


func reset_upright(car: VehicleBody3D) -> void:
	_flipped[car.get_instance_id()] = 0.0
	var pos := car.global_position + Vector3(0, 1.2, 0)
	var yaw := car.global_rotation.y
	car.linear_velocity = Vector3.ZERO
	car.angular_velocity = Vector3.ZERO
	car.global_transform = Transform3D(Basis(Vector3.UP, yaw), pos)
