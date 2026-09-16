/**
 * Third person, and a car to get into.
 *
 * The suite knew two kinds of game: a first-person shooter and a lane runner.
 * Neither is what someone means by "something like GTA". What they mean,
 * mechanically, is three things:
 *
 *   1. you see your own character, and the camera orbits them;
 *   2. you can walk anywhere in a city rather than along a route;
 *   3. there is a car, and getting into it changes how everything controls.
 *
 * ── The camera is the whole difference ──────────────────────────────────────
 *
 * In first person the camera *is* the player's head, so yaw on the body and
 * pitch on the camera is the entire rig. In third person the camera is a
 * separate thing that follows, and three problems appear at once that first
 * person does not have:
 *
 *   - **It clips through walls.** Solved with `SpringArm3D`, which is a
 *     raycast that pulls the camera in when something is behind you. Not
 *     optional: without it, backing into a corner puts the camera inside the
 *     building and the screen fills with the inside of a wall.
 *   - **The character faces the wrong way.** Input is relative to the
 *     *camera*, not the body — pushing the stick left means "go left on
 *     screen" — and the body then turns to face where it is going, smoothly,
 *     or it snaps.
 *   - **It jitters.** The arm has to be moved in `_physics_process` with the
 *     body, not in `_process`, or the camera and the character are updated on
 *     different clocks and the character shivers against the background.
 */

/** The camera rig: a spring arm that follows the player and is turned by touch. */
export function orbitCameraScript(): string {
  return `extends SpringArm3D
## Third-person camera. Orbits the player, and gets out of the way of walls.
##
## A SpringArm3D is a raycast with a camera on the end: when something is
## between the camera and what it is looking at, the arm shortens. Without one,
## backing into a corner puts the camera inside the building.

@export var sensitivity: float = 0.005
@export var pitch_min: float = -1.1
@export var pitch_max: float = 0.55
## How fast the arm catches up. Instant is correct for turning and wrong for
## following, so the two are separated.
@export var follow_speed: float = 12.0
@export var distance: float = 4.5
@export var shoulder: float = 0.6

var _yaw: float = 0.0
var _pitch: float = -0.25
var _target: Node3D


func _ready() -> void:
	_target = get_parent().get_node_or_null("Player") as Node3D
	spring_length = distance
	# The player's own capsule is behind the camera. Left in the mask, the arm
	# collides with it and the camera sits permanently on the player's nose.
	add_excluded_object(_target.get_rid() if _target is CollisionObject3D else RID())
	collision_mask = 1
	# A little off-centre, the way every over-the-shoulder camera is: dead
	# centre puts the character in front of exactly what you are aiming at.
	position = Vector3(shoulder, 1.5, 0.0)
	top_level = true


func _physics_process(delta: float) -> void:
	if _target == null or not is_instance_valid(_target):
		return
	# In _physics_process with the body it follows, never in _process. On
	# different clocks the character shivers against the background, and it
	# looks like a frame rate problem rather than a bug.
	var wanted: Vector3 = _target.global_position + Vector3(0.0, 1.5, 0.0)
	global_position = global_position.lerp(wanted, clampf(follow_speed * delta, 0.0, 1.0))
	rotation = Vector3(_pitch, _yaw, 0.0)


## Called by the touch layer, which owns the fingers.
func _on_look(relative: Vector2) -> void:
	_yaw -= relative.x
	_pitch = clampf(_pitch - relative.y, pitch_min, pitch_max)


## Which way "forward" is for the player, on the ground.
##
## Read by the player rather than pushed, because the camera is the authority on
## where the player is looking and the player is the authority on what it does
## about that.
func forward() -> Vector3:
	return Vector3(-sin(_yaw), 0.0, -cos(_yaw)).normalized()


func right() -> Vector3:
	return Vector3(cos(_yaw), 0.0, -sin(_yaw)).normalized()
`;
}

/** On foot, in third person: moves relative to the camera and turns to face it. */
export function walkerScript(): string {
  return `extends CharacterBody3D
## The player on foot, seen from behind.

signal health_changed(current: float, maximum: float)
signal died
## Emitted when the player gets into or out of a car, so the HUD and the touch
## controls can change what the buttons mean.
signal driving_changed(driving: bool)

@export var speed: float = 5.0
@export var sprint_speed: float = 8.4
@export var jump_velocity: float = 4.6
@export var max_health: float = 100.0
## Radians per second the body turns towards where it is going. Instant turning
## reads as a sprite being rotated; too slow and it feels like ice.
@export var turn_speed: float = 12.0

var health: float = 100.0
var touch_direction := Vector2.ZERO
var car: VehicleBody3D

var _dead: bool = false
@onready var _camera: Node3D = get_parent().get_node_or_null("CameraRig")


func _ready() -> void:
	health = max_health
	health_changed.emit(health, max_health)


func _physics_process(delta: float) -> void:
	if _dead:
		return
	if car != null:
		# Riding. The car moves; this follows it so getting out puts the player
		# beside the car rather than back where they got in.
		global_position = car.global_position + car.global_transform.basis.x * 2.0
		return

	if not is_on_floor():
		velocity += get_gravity() * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity

	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	if input == Vector2.ZERO:
		input = touch_direction

	# Relative to the camera, not to the body. "Left" means left on the screen,
	# which is the only thing it can mean when you are looking at your own back.
	var direction := Vector3.ZERO
	if _camera != null and _camera.has_method("forward"):
		direction = (_camera.forward() * -input.y + _camera.right() * input.x)
	else:
		direction = Vector3(input.x, 0.0, input.y)
	direction.y = 0.0
	direction = direction.normalized()

	var current: float = sprint_speed if Input.is_action_pressed("sprint") else speed
	if direction.length_squared() > 0.01:
		velocity.x = direction.x * current
		velocity.z = direction.z * current
		# Turn towards where we are going. lerp_angle rather than a subtraction,
		# or crossing from +PI to -PI spins the character all the way round.
		var wanted: float = atan2(direction.x, direction.z)
		rotation.y = lerp_angle(rotation.y, wanted, clampf(turn_speed * delta, 0.0, 1.0))
	else:
		velocity.x = move_toward(velocity.x, 0.0, current)
		velocity.z = move_toward(velocity.z, 0.0, current)

	move_and_slide()


## Fed by the touch layer.
func set_move_input(direction: Vector2) -> void:
	touch_direction = direction


func enter_car(which: VehicleBody3D) -> void:
	if car != null or which == null:
		return
	car = which
	velocity = Vector3.ZERO
	# Hidden rather than freed: the same node drives again when they get out.
	visible = false
	# Off, not just hidden. A capsule still colliding inside the car it is
	# riding in shoves the car across the map.
	set_collision_layer_value(1, false)
	set_collision_mask_value(1, false)
	car.driver = self
	driving_changed.emit(true)


func leave_car() -> void:
	if car == null:
		return
	# Beside the car and slightly up, so getting out does not drop the player
	# through the road.
	global_position = car.global_position + car.global_transform.basis.x * 2.5 + Vector3(0.0, 0.5, 0.0)
	car.driver = null
	car = null
	visible = true
	set_collision_layer_value(1, true)
	set_collision_mask_value(1, true)
	driving_changed.emit(false)


func is_driving() -> bool:
	return car != null


func take_damage(amount: float, _from: Vector3 = Vector3.ZERO) -> void:
	if _dead:
		return
	health -= amount
	health_changed.emit(health, max_health)
	if health <= 0.0:
		_dead = true
		died.emit()


func is_dead() -> bool:
	return _dead
`;
}

/**
 * The car.
 *
 * A real `VehicleBody3D` rather than a box that slides. Godot's vehicle body
 * already has suspension, per-wheel traction and slip, and the difference
 * between that and a translated box is the whole feel of driving.
 *
 * The wheels are built in code for the same reason the HUD is: four
 * `VehicleWheel3D` nodes in a `.tscn` are four more transforms to get subtly
 * wrong, and a wheel positioned inside the chassis produces a car that
 * shudders on the spot with no error anywhere.
 */
export function carScript(): string {
  return `extends VehicleBody3D
## A drivable car. Suspension and traction come from VehicleBody3D; this only
## decides how hard to push it.

@export var engine_power: float = 220.0
@export var brake_power: float = 6.0
@export var steer_limit: float = 0.55
## How quickly the wheels turn to the wanted angle. Instant steering makes a car
## feel like a mouse cursor.
@export var steer_speed: float = 3.5
@export var top_speed: float = 24.0

## Set by the player when they get in. Null means parked.
var driver: Node3D

var _steer_target: float = 0.0
var _throttle: float = 0.0


func _ready() -> void:
	mass = 900.0
	# Low, because a tall centre of mass in a vehicle body rolls the car over on
	# the first corner. This is the single most common reason a Godot car flips.
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0.0, -0.4, 0.0)
	_build_wheels()


func _build_wheels() -> void:
	# x is right, z is forward-negative. Front wheels steer, rear wheels drive:
	# all four doing both is a car that spins on every corner.
	var layout := [
		{"at": Vector3(-0.85, -0.2, -1.35), "steer": true, "drive": false},
		{"at": Vector3(0.85, -0.2, -1.35), "steer": true, "drive": false},
		{"at": Vector3(-0.85, -0.2, 1.35), "steer": false, "drive": true},
		{"at": Vector3(0.85, -0.2, 1.35), "steer": false, "drive": true},
	]
	for spec in layout:
		var wheel := VehicleWheel3D.new()
		wheel.position = spec["at"]
		wheel.use_as_steering = spec["steer"]
		wheel.use_as_traction = spec["drive"]
		wheel.wheel_radius = 0.35
		wheel.wheel_friction_slip = 3.2
		wheel.suspension_travel = 0.22
		wheel.suspension_stiffness = 26.0
		wheel.damping_compression = 0.9
		wheel.damping_relaxation = 1.1
		add_child(wheel)

		var mesh := MeshInstance3D.new()
		var tyre := CylinderMesh.new()
		tyre.top_radius = 0.35
		tyre.bottom_radius = 0.35
		tyre.height = 0.22
		mesh.mesh = tyre
		# A cylinder is built standing up; a wheel lies down.
		mesh.rotation = Vector3(0.0, 0.0, PI * 0.5)
		var rubber := StandardMaterial3D.new()
		rubber.albedo_color = Color(0.09, 0.09, 0.1, 1.0)
		rubber.roughness = 0.95
		mesh.material_override = rubber
		wheel.add_child(mesh)


func _physics_process(delta: float) -> void:
	if driver == null:
		# Parked: no engine, full brakes, so it does not roll down the street.
		engine_force = 0.0
		brake = brake_power
		steering = move_toward(steering, 0.0, steer_speed * delta)
		return

	var turn: float = Input.get_axis("move_right", "move_left")
	var forward: float = Input.get_axis("move_back", "move_forward")
	if is_zero_approx(turn) and is_zero_approx(forward):
		turn = -_steer_target_from_touch.x
		forward = -_steer_target_from_touch.y

	_steer_target = turn * steer_limit
	steering = move_toward(steering, _steer_target, steer_speed * delta)

	var speed: float = linear_velocity.length()
	if forward > 0.05:
		# Power tails off towards the top speed rather than stopping dead at it.
		engine_force = engine_power * forward * clampf(1.0 - speed / top_speed, 0.05, 1.0)
		brake = 0.0
	elif forward < -0.05:
		# Reverse below walking pace, brakes above it — which is what a player
		# pulling back at speed means every time.
		if speed > 2.0:
			engine_force = 0.0
			brake = brake_power
		else:
			engine_force = engine_power * forward * 0.4
			brake = 0.0
	else:
		engine_force = 0.0
		brake = brake_power * 0.25


var _steer_target_from_touch := Vector2.ZERO


## Fed by the touch layer, same signal the player uses on foot. One stick, two
## meanings, decided by whether anyone is driving.
func set_move_input(direction: Vector2) -> void:
	_steer_target_from_touch = direction
`;
}

/**
 * Getting in and out.
 *
 * An `Area3D` around the car rather than a distance check every frame, and the
 * button only appears when the player is actually next to something they can
 * drive — a "get in" prompt with no car near it is how a player learns to stop
 * reading the HUD.
 */
export function carDoorScript(): string {
  return `extends Area3D
## Watches for the player standing next to this car.

signal driver_nearby(car: VehicleBody3D, near: bool)

var _player: Node3D
var _near: bool = false


func _ready() -> void:
	body_entered.connect(_on_entered)
	body_exited.connect(_on_exited)


func _on_entered(body: Node3D) -> void:
	# Only the player. Anything else walking past should not offer them a lift.
	if not body.has_method("enter_car"):
		return
	_player = body
	_near = true
	driver_nearby.emit(get_parent() as VehicleBody3D, true)


func _on_exited(body: Node3D) -> void:
	if body != _player:
		return
	_near = false
	driver_nearby.emit(get_parent() as VehicleBody3D, false)


func can_use() -> bool:
	return _near and _player != null and not _player.is_driving()


func use() -> void:
	if _player == null:
		return
	if _player.is_driving():
		_player.leave_car()
	elif _near:
		_player.enter_car(get_parent() as VehicleBody3D)
`;
}
