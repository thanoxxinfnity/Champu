class_name UseTrigger
extends Area3D
## Something the player can use by walking up and pressing a key: a door, a bed, a lift button, a car door.
## It is only a zone with a prompt and a callback; what happens is the owner's business, so every usable thing in the
## game shares one focus / prompt / key path in Player.

signal used(player: Node)

var prompt := "E - Use"
var key_action: StringName = &"interact"
var radius := 1.0
## Optional gate: returns false while the thing cannot be used right now (a door mid-swing, a lift already moving).
var enabled_check := Callable()
var callback := Callable()


func _ready() -> void:
	collision_layer = Data.L_INTERACT
	collision_mask = 0
	monitoring = false
	monitorable = true
	var cs := CollisionShape3D.new()
	var s := SphereShape3D.new()
	s.radius = radius
	cs.shape = s
	add_child(cs)


func can_interact(player: Node) -> bool:
	return not enabled_check.is_valid() or bool(enabled_check.call(player))


func interact(player: Node) -> void:
	used.emit(player)
	if callback.is_valid():
		callback.call(player)
