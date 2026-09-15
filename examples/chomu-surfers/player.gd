extends CharacterBody3D
## The runner. Three lanes, a jump and a roll — swipe or keys, same code path.

signal died(score: int, coins: int)
signal picked_up(total: int)

const LANE_X := [-2.2, 0.0, 2.2]
const LANE_CHANGE_SPEED := 12.0

@export var forward_speed: float = 9.0
@export var max_speed: float = 26.0
## How much faster it gets per second survived. The whole difficulty curve.
@export var acceleration: float = 0.18
@export var jump_velocity: float = 7.5
@export var roll_time: float = 0.55

var lane: int = 1
var distance: float = 0.0
var coins: int = 0
var alive: bool = true

var _roll_left: float = 0.0
var _swipe_start := Vector2.ZERO
var _swiping := false

@onready var _body: Node3D = $Hero
@onready var _collider: CollisionShape3D = $Collision


func _ready() -> void:
	# The capsule is swapped for a short one while rolling, so a train you slide
	# under actually passes over you rather than clipping your head.
	_collider.shape = _collider.shape.duplicate()


func _unhandled_input(event: InputEvent) -> void:
	if not alive:
		return

	if event is InputEventScreenTouch:
		if event.pressed:
			_swipe_start = event.position as Vector2
			_swiping = true
		elif _swiping:
			_swiping = false
			_resolve_swipe((event.position as Vector2) - _swipe_start)


func _resolve_swipe(delta: Vector2) -> void:
	# A short drag is a tap, not a swipe. Without the threshold every tap on the
	# screen jerks you into a lane.
	if delta.length() < 48.0:
		return
	if absf(delta.x) > absf(delta.y):
		change_lane(1 if delta.x > 0.0 else -1)
	elif delta.y < 0.0:
		jump()
	else:
		roll()


func change_lane(direction: int) -> void:
	lane = clampi(lane + direction, 0, LANE_X.size() - 1)


func jump() -> void:
	if is_on_floor():
		velocity.y = jump_velocity
		_roll_left = 0.0
		var audio := get_parent().get_node_or_null("Audio")
		if audio != null:
			audio.play("jump")


func roll() -> void:
	_roll_left = roll_time
	if not is_on_floor():
		# Slam down, so a roll in mid-air is a fast way back to the ground
		# rather than a no-op the player thinks is a bug.
		velocity.y = minf(velocity.y, -jump_velocity)


func _physics_process(delta: float) -> void:
	if not alive:
		return

	if Input.is_action_just_pressed("move_left"):
		change_lane(-1)
	if Input.is_action_just_pressed("move_right"):
		change_lane(1)
	if Input.is_action_just_pressed("jump"):
		jump()
	if Input.is_action_just_pressed("roll"):
		roll()

	forward_speed = minf(forward_speed + acceleration * delta, max_speed)
	distance += forward_speed * delta

	if not is_on_floor():
		velocity += get_gravity() * delta

	# Lane changes are a slide, not a teleport: you can see which lane you are
	# heading for, which is what makes a near miss readable.
	var target_x: float = LANE_X[lane]
	velocity.x = (target_x - global_position.x) * LANE_CHANGE_SPEED
	velocity.z = -forward_speed

	_roll_left = maxf(_roll_left - delta, 0.0)
	var rolling := _roll_left > 0.0
	var capsule := _collider.shape as CapsuleShape3D
	if capsule != null:
		capsule.height = 0.9 if rolling else 1.8
	_collider.position.y = 0.45 if rolling else 0.9
	_body.rotation.x = -1.2 if rolling else 0.0

	move_and_slide()


func collect() -> void:
	coins += 1
	picked_up.emit(coins)


func crash() -> void:
	if not alive:
		return
	alive = false
	velocity = Vector3.ZERO
	died.emit(score(), coins)


func score() -> int:
	# Distance plus a coin bonus, so collecting is worth a small detour.
	return int(distance) + coins * 10
