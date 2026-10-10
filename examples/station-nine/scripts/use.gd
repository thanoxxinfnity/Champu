class_name Use
extends StaticBody3D
## Anything the player can aim at and press USE on: a note, a valve, a locker, a pick-up.
## The collision shape is on layer L_USE, which the player's look-ray listens to.

var id := ""
var prompt := "Use"
var enabled := true
var action := Callable()
var prompt_fn := Callable()
var tag := ""
var hide_pos := Vector3.ZERO     # lockers: where the camera goes
var hide_yaw := 0.0
var keep := false                # stays after use (valves, doors); pick-ups free themselves


func setup(use_id: String, text: String, size: Vector3, pos: Vector3, act: Callable) -> Use:
	id = use_id
	prompt = text
	action = act
	collision_layer = Data.L_USE
	collision_mask = 0
	position = pos
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	add_child(cs)
	return self


func label() -> String:
	if prompt_fn.is_valid():
		return str(prompt_fn.call())
	return prompt


func use() -> void:
	if enabled and action.is_valid():
		action.call(self)
