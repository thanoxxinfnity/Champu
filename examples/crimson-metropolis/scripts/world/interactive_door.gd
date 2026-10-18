class_name InteractiveDoor
extends Node3D
## A hinged door. The node sits at the hinge, on the floor; the closed leaf runs along local +X and its faces point along
## local Z. Press E near it and the player reaches out (push_door), the leaf swings away from whichever side the player is on,
## and it shuts itself a few seconds later — unless someone is still standing in the doorway.

signal opened
signal closed

const OPEN_ANGLE := 98.0
const SWING_TIME := 0.5
const AUTO_CLOSE := 4.0

var width := 1.05
var height := 2.15
var thickness := 0.07
var paint := Color(0.36, 0.24, 0.16)
var glazed := false               # a glass leaf (the front doors)
var locked := false
var is_open := false
var moving := false

var pivot: Node3D
var leaf: StaticBody3D
var trigger: UseTrigger
var _timer := -1.0


func _ready() -> void:
	pivot = Node3D.new()
	pivot.name = "Pivot"
	add_child(pivot)
	leaf = StaticBody3D.new()
	leaf.collision_layer = Data.L_WORLD
	leaf.collision_mask = 0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(width, height, thickness)
	cs.shape = bs
	leaf.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(width, height, thickness)
	mi.mesh = bm
	mi.material_override = Builder.glass() if glazed else Builder.mat(paint, 0.55)
	leaf.add_child(mi)
	if glazed:
		# A metal frame around the glass so it reads as a door and not as a hole.
		var frame := Builder.mat(Color(0.12, 0.12, 0.13), 0.4, 0.8)
		Builder.box(leaf, Vector3(0, height * 0.5 - 0.04, 0), Vector3(width, 0.08, thickness + 0.02), frame, false)
		Builder.box(leaf, Vector3(0, -height * 0.5 + 0.04, 0), Vector3(width, 0.08, thickness + 0.02), frame, false)
		Builder.box(leaf, Vector3(-width * 0.5 + 0.04, 0, 0), Vector3(0.08, height, thickness + 0.02), frame, false)
		Builder.box(leaf, Vector3(width * 0.5 - 0.04, 0, 0), Vector3(0.08, height, thickness + 0.02), frame, false)
	# Handle on the free edge, both faces.
	var metal := Builder.mat(Color(0.75, 0.72, 0.6), 0.3, 0.9)
	Builder.box(leaf, Vector3(width * 0.5 - 0.1, -0.05, 0), Vector3(0.09, 0.03, thickness + 0.1), metal, false)
	leaf.position = Vector3(width * 0.5, height * 0.5, 0)
	pivot.add_child(leaf)

	trigger = UseTrigger.new()
	trigger.radius = 1.4
	trigger.position = Vector3(width * 0.5, 1.0, 0)
	trigger.enabled_check = func(_p): return not moving and not locked
	trigger.callback = _on_use
	add_child(trigger)
	_refresh_prompt()
	add_to_group("doors")


func _refresh_prompt() -> void:
	trigger.prompt = "E - Close Door" if is_open else "E - Open Door"


func _on_use(player: Node) -> void:
	if is_open:
		close()
		return
	var side := 1.0
	if player is Node3D:
		side = signf(to_local((player as Node3D).global_position).z)
		if side == 0.0:
			side = 1.0
	if player.has_method("play_clip"):
		player.play_clip(&"push_door", 0.6)
	open(side)


## Swing open away from the side `side` (+1 = the player stands on local +Z).
func open(side := 1.0) -> void:
	if is_open or moving:
		return
	moving = true
	var tw := create_tween()
	tw.tween_property(pivot, "rotation_degrees:y", side * OPEN_ANGLE, SWING_TIME).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	await tw.finished
	is_open = true
	moving = false
	_timer = AUTO_CLOSE
	_refresh_prompt()
	opened.emit()


func close() -> void:
	if not is_open or moving:
		return
	moving = true
	var tw := create_tween()
	tw.tween_property(pivot, "rotation_degrees:y", 0.0, SWING_TIME).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
	await tw.finished
	is_open = false
	moving = false
	_timer = -1.0
	_refresh_prompt()
	closed.emit()


func _process(delta: float) -> void:
	if _timer < 0.0 or not is_open or moving:
		return
	_timer -= delta
	if _timer <= 0.0:
		if _someone_in_doorway():
			_timer = 1.0
		else:
			close()


func _someone_in_doorway() -> bool:
	for p in get_tree().get_nodes_in_group("player"):
		if p is Node3D:
			var local := to_local((p as Node3D).global_position)
			if local.x > -0.4 and local.x < width + 0.4 and absf(local.z) < 0.9 and local.y > -0.5 and local.y < height:
				return true
	return false
