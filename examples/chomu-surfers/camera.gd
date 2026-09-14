extends Camera3D
## Chases the runner without riding it.
##
## Parenting the camera to the player looks right until you change lanes: the
## view slides all the way across with you, the outside lane leaves the screen,
## and you cannot see the obstacle you are about to be sent into. So it follows
## the player down the track, and only leans a fraction of the way sideways.

@export var lean: float = 0.35      ## How much of the player's lane offset to follow.
@export var height: float = 3.4
@export var back: float = 7.5
@export var smoothing: float = 7.0

var _target: Node3D


func _ready() -> void:
	_target = get_parent().get_node_or_null("Player")
	if _target != null:
		global_position = _wanted()


func _wanted() -> Vector3:
	return Vector3(_target.global_position.x * lean, height, _target.global_position.z + back)


func _physics_process(delta: float) -> void:
	if _target == null:
		return
	# Z is followed exactly — falling behind makes the whole game feel laggy.
	# X and Y are eased, which is what makes a lane change read as a swerve.
	var wanted := _wanted()
	global_position.z = wanted.z
	var ease := clampf(delta * smoothing, 0.0, 1.0)
	global_position.x = lerpf(global_position.x, wanted.x, ease)
	global_position.y = lerpf(global_position.y, wanted.y, ease)
	look_at(Vector3(_target.global_position.x * lean * 0.5, 1.2, _target.global_position.z - 8.0), Vector3.UP)
