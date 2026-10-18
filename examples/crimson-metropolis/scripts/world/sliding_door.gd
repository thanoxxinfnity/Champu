class_name SlidingDoor
extends Node3D
## A door that slides: the garage door (one leaf, up) and the lift doors (two leaves, apart). Either opens by itself when a
## player or a vehicle is near (`auto`), or is opened and closed by whatever owns it (the lift).
##
## Local frame: the opening is `width` wide along X and `height` tall, its centre at the node's origin on the floor.

signal opened
signal closed

var width := 4.8
var height := 2.5
var thickness := 0.1
var two_leaves := false           # lift doors part left and right instead of lifting
var auto := true
var trigger_size := Vector3(8.0, 3.0, 9.0)   # the zone in front of the door that opens it
var paint := Color(0.78, 0.78, 0.8)
var metallic := 0.3
var close_delay := 2.0
var slide_time := 0.9

var is_open := false
var moving := false
var _leaves: Array[StaticBody3D] = []
var _closed_pos: Array[Vector3] = []
var _open_pos: Array[Vector3] = []
var _inside := 0
var _delay := 0.0
var _zone: Area3D


func _ready() -> void:
	var m := Builder.mat(paint, 0.4, metallic)
	var count := 2 if two_leaves else 1
	for i in range(count):
		var w := width / count
		var leaf := StaticBody3D.new()
		leaf.collision_layer = Data.L_WORLD
		leaf.collision_mask = 0
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = Vector3(w, height, thickness)
		cs.shape = bs
		leaf.add_child(cs)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(w, height, thickness)
		mi.mesh = bm
		mi.material_override = m
		leaf.add_child(mi)
		if not two_leaves:
			# Panel lines, so a garage door reads as sectional rather than a slab.
			var line_mat := Builder.mat(paint.darkened(0.35), 0.5)
			for k in range(1, 5):
				Builder.box(leaf, Vector3(0, -height * 0.5 + k * height / 5.0, thickness * 0.5 + 0.005), Vector3(w, 0.03, 0.01), line_mat, false)
		var closed := Vector3((i - 0.5) * w if two_leaves else 0.0, height * 0.5, 0)
		leaf.position = closed
		add_child(leaf)
		_leaves.append(leaf)
		_closed_pos.append(closed)
		_open_pos.append(closed + (Vector3((1.0 if i == 1 else -1.0) * (w - 0.08), 0, 0) if two_leaves else Vector3(0, height - 0.15, 0)))
	if auto:
		_zone = Area3D.new()
		_zone.collision_layer = 0
		_zone.collision_mask = Data.L_PLAYER | Data.L_DYNAMIC
		var zs := CollisionShape3D.new()
		var bx := BoxShape3D.new()
		bx.size = trigger_size
		zs.shape = bx
		zs.position = Vector3(0, trigger_size.y * 0.5, trigger_size.z * 0.5 - 1.0)
		_zone.add_child(zs)
		add_child(_zone)
		_zone.body_entered.connect(func(_b): _inside += 1; _delay = close_delay; set_open(true))
		_zone.body_exited.connect(func(_b): _inside = maxi(0, _inside - 1))
	add_to_group("sliding_doors")


func _process(delta: float) -> void:
	if auto and is_open and not moving and _inside == 0:
		_delay -= delta
		if _delay <= 0.0:
			set_open(false)


func set_open(open: bool) -> void:
	if open == is_open and not moving:
		return
	if moving:
		return
	moving = true
	var tw := create_tween().set_parallel(true)
	for i in range(_leaves.size()):
		tw.tween_property(_leaves[i], "position", _open_pos[i] if open else _closed_pos[i], slide_time).set_trans(Tween.TRANS_SINE)
	await tw.finished
	is_open = open
	moving = false
	if open:
		opened.emit()
	else:
		closed.emit()
