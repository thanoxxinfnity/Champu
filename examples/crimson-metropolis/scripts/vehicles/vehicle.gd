class_name Vehicle
extends VehicleBody3D
## A drivable car: a generated body mesh on four real VehicleWheel3Ds, throttle that fades toward a top speed, speed-sensitive
## steering, a handbrake that lets the tail out, a chase camera, headlights that follow the clock, and a door the player walks
## to, opens and climbs in through.
##
## The Triverse models are single meshes with the wheels baked in, so a wheel cannot spin and a door cannot hinge on the model
## itself. The wheels the physics uses are invisible; the door that swings is a panel in the body's paint colour that is only
## shown during entering and leaving.
##
## Convention: a Vehicle's nose points down its own +Z (that is the way VehicleBody3D pushes on positive engine force), so
## the driver's door, on the left of a car facing +Z, is on local +X. Data.VEHICLES.yaw turns each model to match.

signal entered(driver: Node)
signal exited(driver: Node)
signal crashed(impact: float)

const GROUND_TO_ORIGIN := 0.55        # the body's origin sits this high above flat ground at rest
const WHEEL_RADIUS := 0.34
const EXIT_MAX_SPEED := 5.0
const REVERSE_TOP := 9.0
const CAM_DIST := 6.4

var kind := "sedan"
var cfg: Dictionary = {}
var driver: Node = null               # the Player, or an NPC (traffic cars are driven by their own AI)
var is_player_driven := false
var busy := false                     # entering / leaving: the controls are ignored
var door_open := false
var lights_on := false

# Controls. The keyboard fills these while a player drives; tests, touch buttons and AI call set_controls().
var ext_throttle := 0.0               # +1 forward, -1 brake / reverse
var ext_steer := 0.0                  # +1 right, -1 left
var ext_handbrake := false

var cam_pivot: Node3D
var cam_arm: SpringArm3D
var cam: Camera3D
var door_pivot: Node3D
var model: Node3D
var enter_trigger: UseTrigger

var _length := 4.7
var _wheels: Array[VehicleWheel3D] = []
var _head: Array[SpotLight3D] = []
var _cam_yaw := 0.0
var _cam_pitch := -0.2
var _look_idle := 0.0
var _last_speed := 0.0


static func make(kind_name: String) -> Vehicle:
	var v := Vehicle.new()
	v.kind = kind_name
	v.name = "Vehicle_" + kind_name
	return v


func _ready() -> void:
	cfg = Data.VEHICLES[kind]
	_length = cfg.length
	collision_layer = Data.L_DYNAMIC
	collision_mask = Data.L_WORLD | Data.L_DYNAMIC | Data.L_PLAYER
	mass = cfg.mass
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0, -0.3, 0)
	linear_damp = 0.03
	angular_damp = 0.8
	contact_monitor = true
	max_contacts_reported = 4
	body_entered.connect(_on_hit)

	var scene := load("res://assets/generated/raw/%s.glb" % cfg.file) as PackedScene
	if scene != null:
		model = scene.instantiate() as Node3D
		add_child(model)
		ModelFit.place_by_length(model, _length, cfg.yaw, -GROUND_TO_ORIGIN)
	else:
		model = _stand_in()

	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1.85, 0.9, _length * 0.95)
	cs.shape = box
	cs.position.y = 0.2
	add_child(cs)

	var axle_z := _length * 0.31
	for i in range(4):
		var w := VehicleWheel3D.new()
		var front := i < 2
		w.position = Vector3(0.82 if i % 2 == 0 else -0.82, -0.2, axle_z if front else -axle_z * 0.95)
		w.wheel_radius = WHEEL_RADIUS
		w.wheel_rest_length = 0.16
		w.suspension_travel = 0.22
		w.suspension_stiffness = 42.0
		w.suspension_max_force = 11000.0
		w.damping_compression = 0.85
		w.damping_relaxation = 1.1
		w.wheel_friction_slip = cfg.grip
		w.wheel_roll_influence = 0.22
		w.use_as_steering = front
		w.use_as_traction = not front or cfg.top > 60.0
		add_child(w)
		_wheels.append(w)

	_build_door()
	_build_lights()
	_build_camera()

	enter_trigger = UseTrigger.new()
	enter_trigger.prompt = "F - Enter Vehicle"
	enter_trigger.key_action = &"enter_vehicle"
	enter_trigger.radius = 1.0
	enter_trigger.position = _door_out_local()
	enter_trigger.enabled_check = func(_p): return driver == null and not busy
	enter_trigger.callback = begin_enter
	add_child(enter_trigger)
	add_to_group("vehicles")


func _stand_in() -> Node3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(1.8, 1.0, _length)
	mi.mesh = bm
	add_child(mi)
	return mi


func set_controls(throttle: float, steer: float, handbrake := false) -> void:
	ext_throttle = clampf(throttle, -1.0, 1.0)
	ext_steer = clampf(steer, -1.0, 1.0)
	ext_handbrake = handbrake


## Metres per second along the nose (negative when rolling backwards).
func forward_speed() -> float:
	return global_basis.z.dot(linear_velocity)


func _physics_process(delta: float) -> void:
	var throttle := ext_throttle
	var steer_in := ext_steer
	var hand := ext_handbrake
	if is_player_driven and not busy:
		var t := Input.get_axis("move_back", "move_forward")
		if t != 0.0:
			throttle = t
		var st := Input.get_axis("move_left", "move_right")
		if st != 0.0:
			steer_in = st
		hand = hand or Input.is_action_pressed("jump")
	elif busy:
		throttle = 0.0
		steer_in = 0.0

	var fwd := forward_speed()
	var top: float = cfg.top
	var force := 0.0
	var brake_f := 0.0
	if throttle > 0.0:
		if fwd < -1.5:
			brake_f = 40.0
		else:
			force = throttle * cfg.engine * clampf(1.0 - pow(maxf(fwd, 0.0) / top, 2.0), 0.0, 1.0)
	elif throttle < 0.0:
		if fwd > 1.5:
			brake_f = 55.0 * -throttle
		else:
			force = throttle * cfg.engine * 0.55 * clampf(1.0 - pow(maxf(-fwd, 0.0) / REVERSE_TOP, 2.0), 0.0, 1.0)
	elif absf(fwd) > 0.2:
		brake_f = 3.0                                        # rolling resistance
	engine_force = force
	brake = brake_f
	if hand:
		brake = 22.0
		_wheels[2].wheel_friction_slip = cfg.grip * 0.42
		_wheels[3].wheel_friction_slip = cfg.grip * 0.42
	else:
		_wheels[2].wheel_friction_slip = cfg.grip
		_wheels[3].wheel_friction_slip = cfg.grip

	var steer_limit := lerpf(0.62, 0.16, clampf(absf(fwd) / 32.0, 0.0, 1.0))
	steering = move_toward(steering, -steer_in * steer_limit, 3.2 * delta)
	# Aerodynamic downforce keeps a fast car on the road.
	apply_central_force(Vector3.DOWN * linear_velocity.length_squared() * 0.45)
	_last_speed = linear_velocity.length()
	_update_camera(delta)


func _on_hit(body: Node) -> void:
	var hit := absf(_last_speed - linear_velocity.length())
	if hit > 5.0:
		crashed.emit(hit)


# ── lights ────────────────────────────────────────────────────────────────────

func _build_lights() -> void:
	add_to_group("headlights")
	for sx in [-0.65, 0.65]:
		var l := SpotLight3D.new()
		l.position = Vector3(sx, 0.05, _length * 0.5 - 0.1)
		l.rotation_degrees = Vector3(-4.0, 180.0, 0.0)
		l.spot_range = 32.0
		l.spot_angle = 34.0
		l.light_energy = 3.2
		l.light_color = Color(1.0, 0.95, 0.85)
		l.visible = false
		add_child(l)
		_head.append(l)


func set_lit(on: bool) -> void:
	lights_on = on
	for l in _head:
		l.visible = on


# ── door ──────────────────────────────────────────────────────────────────────

## Local position just outside the driver's door (the left side, a little ahead of the middle).
func _door_out_local() -> Vector3:
	return Vector3(1.45, 0.0 - GROUND_TO_ORIGIN + 0.1, _length * 0.08)


func _build_door() -> void:
	# Hinged at the door's front edge on the left side; the panel extends back from there.
	door_pivot = Node3D.new()
	door_pivot.position = Vector3(0.93, 0.0, _length * 0.08 + 0.5)
	door_pivot.visible = false
	add_child(door_pivot)
	var panel := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.06, 0.78, 1.05)
	panel.mesh = bm
	panel.position = Vector3(0, 0.12, -0.52)
	var m := StandardMaterial3D.new()
	m.albedo_color = cfg.paint
	m.metallic = 0.6
	m.roughness = 0.3
	panel.material_override = m
	door_pivot.add_child(panel)


func _swing_door(open: bool) -> Tween:
	door_pivot.visible = true
	var tw := create_tween()
	tw.tween_property(door_pivot, "rotation_degrees:y", -68.0 if open else 0.0, 0.32).set_trans(Tween.TRANS_SINE)
	if not open:
		tw.tween_callback(func(): door_pivot.visible = false)
	door_open = open
	return tw


# ── getting in and out ────────────────────────────────────────────────────────

func begin_enter(player: Player) -> void:
	if driver != null or busy:
		return
	busy = true
	player.set_cinematic(true)
	var out_pos := to_global(_door_out_local())
	var to_door := out_pos - player.global_position
	to_door.y = 0.0
	player.face(to_door)
	player.play_clip(&"walk")
	var walk := create_tween()
	walk.tween_property(player, "global_position", Vector3(out_pos.x, player.global_position.y, out_pos.z), maxf(0.25, to_door.length() / 2.6))
	await walk.finished
	player.face(-global_basis.x)                # the door is on the car's left (+X), so the player looks back along -X at it
	player.play_clip(&"push_door")
	await _swing_door(true).finished
	# Climb in: slide to the seat while the door is open, then hide the body and shut the door.
	var seat := to_global(Vector3(0.35, 0.1 - GROUND_TO_ORIGIN, _length * 0.06))
	var slide := create_tween()
	slide.tween_property(player, "global_position", seat, 0.3)
	await slide.finished
	player.set_active(false)
	player.set_cinematic(false)
	driver = player
	is_player_driven = true
	_cam_yaw = rotation.y
	cam.make_current()
	_swing_door(false)
	busy = false
	entered.emit(player)


func begin_exit() -> void:
	if driver == null or busy or absf(forward_speed()) > EXIT_MAX_SPEED:
		return
	busy = true
	var player := driver as Player
	set_controls(0.0, 0.0, true)
	await _swing_door(true).finished
	var out_pos := to_global(_door_out_local())
	player.global_position = Vector3(out_pos.x, out_pos.y + 0.2, out_pos.z)
	player.velocity = Vector3.ZERO
	player.set_active(true)
	player.yaw = _cam_yaw
	player.face(to_global(Vector3(1, 0, 0)) - global_position)
	driver = null
	is_player_driven = false
	ext_handbrake = false
	await _swing_door(false).finished
	busy = false
	exited.emit(player)


func _unhandled_input(event: InputEvent) -> void:
	if is_player_driven and not busy:
		if event.is_action_pressed("enter_vehicle"):
			begin_exit()
		elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			var mm := event as InputEventMouseMotion
			add_look(mm.relative.x * Player.MOUSE_SENS, mm.relative.y * Player.MOUSE_SENS)


# ── chase camera ──────────────────────────────────────────────────────────────

func _build_camera() -> void:
	cam_pivot = Node3D.new()
	cam_pivot.name = "ChaseCamPivot"
	cam_pivot.top_level = true
	add_child(cam_pivot)
	cam_arm = SpringArm3D.new()
	var probe := SphereShape3D.new()
	probe.radius = 0.3
	cam_arm.shape = probe
	cam_arm.spring_length = CAM_DIST
	cam_arm.collision_mask = Data.L_WORLD
	cam_arm.add_excluded_object(get_rid())
	cam_pivot.add_child(cam_arm)
	cam = Camera3D.new()
	cam.fov = 70.0
	cam.near = 0.1
	cam.far = 600.0
	cam_arm.add_child(cam)


func add_look(dx: float, dy: float) -> void:
	_cam_yaw -= dx
	_cam_pitch = clampf(_cam_pitch - dy, -0.9, 0.3)
	_look_idle = 0.0


func _update_camera(delta: float) -> void:
	if not is_player_driven:
		return
	_look_idle += delta
	var heading := rotation.y + PI                # the nose is +Z, the camera looks down its own -Z
	if linear_velocity.length() > 2.0 and forward_speed() > 0.0:
		heading = atan2(-linear_velocity.x, -linear_velocity.z)
	if _look_idle > 1.2:
		_cam_yaw = lerp_angle(_cam_yaw, heading, 1.0 - exp(-2.4 * delta))
		_cam_pitch = lerpf(_cam_pitch, -0.2, 1.0 - exp(-2.0 * delta))
	cam_pivot.global_position = global_position + Vector3(0, 1.3, 0)
	cam_pivot.global_basis = Basis.from_euler(Vector3(_cam_pitch, _cam_yaw, 0.0), EULER_ORDER_YXZ)
	cam.fov = lerpf(cam.fov, 68.0 + clampf(linear_velocity.length() / cfg.top, 0.0, 1.0) * 22.0, 1.0 - exp(-4.0 * delta))
