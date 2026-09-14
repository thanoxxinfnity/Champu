extends Node3D
## Wires the player to the world: what it hits, and what it picks up.
##
## Detection lives here rather than on each obstacle so there is one rule for
## the whole game — a hundred Area3Ds each deciding what a collision means is
## how two of them end up disagreeing.

@onready var _player: CharacterBody3D = $Player


func _ready() -> void:
	var hitbox: Area3D = $Player/Hitbox
	hitbox.area_entered.connect(_on_touched)


func _on_touched(area: Area3D) -> void:
	if not _player.alive:
		return
	if area.is_in_group("coin"):
		_player.collect()
		# Hidden rather than freed: it belongs to a recycled segment, and
		# freeing it would leave a hole the next time that segment comes round.
		area.hide()
		area.set_deferred("monitorable", false)
	elif area.is_in_group("hazard"):
		_player.crash()
