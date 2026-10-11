class_name Door
extends Node3D
## A sliding steel door. Closed it blocks the player (collision) and the Hollow (the graph).

signal changed(open: bool)

var id := ""
var open := false
var width := 3.0
var height := 2.8
var body: StaticBody3D
var slab: MeshInstance3D
var sfx: Sfx


func build(door_id: String, w: float, h: float, mat: Material, along_x: bool) -> Door:
	id = door_id
	width = w
	height = h
	body = StaticBody3D.new()
	body.collision_layer = Data.L_WORLD
	body.collision_mask = 0
	add_child(body)
	var size := Vector3(w, h, 0.3) if along_x else Vector3(0.3, h, w)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	cs.position.y = h * 0.5
	body.add_child(cs)
	slab = MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	slab.mesh = bm
	slab.position.y = h * 0.5
	slab.material_override = mat
	body.add_child(slab)
	return self


func set_open(value: bool, quiet := false) -> void:
	if value == open:
		return
	open = value
	if sfx != null and not quiet:
		sfx.play_at("door", global_position + Vector3(0, 1.4, 0), 0.0)
	var tween := create_tween()
	tween.tween_property(body, "position:y", height + 0.1 if open else 0.0, 0.7 if not quiet else 0.01)
	body.collision_layer = 0 if open else Data.L_WORLD
	changed.emit(open)
