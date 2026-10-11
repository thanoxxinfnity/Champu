class_name Enemy
extends CharacterBody3D
## A hunter that goes to the sound the player makes.

signal alerted

func hear(pos: Vector3, radius: float) -> void:
	if global_position.distance_to(pos) > radius:
		return
	_go(pos)
	alerted.emit()

func _go(pos: Vector3) -> void:
	velocity = (pos - global_position).normalized()

func _physics_process(delta: float) -> void:
	hear(Vector3.ZERO, 3.0)
