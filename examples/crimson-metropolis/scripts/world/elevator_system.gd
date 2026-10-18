class_name ElevatorSystem
extends Node3D
## A working lift. The shaft's door frames are at fixed stops; the cabin is an AnimatableBody3D that slides between them. A call
## button at each stop brings it there; inside, a panel lists the floors; choosing one shuts the doors, carries the cabin and
## whoever is in it up or down the shaft in real time, and opens the doors at the other end.
##
## Local frame: the cabin and the stop doors face +Z; the node's origin is the middle of the cabin floor at the lowest stop.

signal arrived(stop: int)
signal departed(stop: int)
signal trip_finished

const CAB_W := 2.4
const CAB_D := 2.4
const CAB_H := 2.5
const SPEED := 13.0
const MIN_TRIP := 2.2

## Each stop: label shown on the button, name, and floor height (y of the walking surface, in this node's local space).
var stops: Array[Dictionary] = []
var current := 0
var moving := false
var jammed := false
var cabin: AnimatableBody3D
var rider: Node = null
var panel: ElevatorPanel
var stop_doors: Array[SlidingDoor] = []
var call_buttons: Array[UseTrigger] = []

var _cab_doors: SlidingDoor
var _front_block: CollisionShape3D
var _in_cabin: Area3D
var _display: Label3D
var _queue: Array[int] = []
var _trip_active := false
var _trip_from := 0.0
var _trip_to := 0.0
var _trip_dur := 1.0
var _trip_t := 0.0
var _rider_offset := 0.0


func setup(stop_list: Array[Dictionary]) -> void:
	stops = stop_list


func _ready() -> void:
	_build_cabin()
	for i in range(stops.size()):
		_build_stop(i)
	panel = ElevatorPanel.new()
	panel.name = "Panel"
	add_child(panel)
	panel.set_stops(stops)
	panel.chosen.connect(go_to)
	_show_floor()
	add_to_group("elevators")


func _process(_delta: float) -> void:
	var inside := _player_in_cabin()
	panel.visible = inside and not jammed
	panel.current = current
	panel.moving = moving
	panel.refresh()


func _build_cabin() -> void:
	cabin = AnimatableBody3D.new()
	cabin.name = "Cabin"
	cabin.collision_layer = Data.L_WORLD
	cabin.collision_mask = 0
	cabin.sync_to_physics = true
	add_child(cabin)
	var steel := Builder.mat(Color(0.7, 0.71, 0.74), 0.3, 0.85)
	var panel_mat := Builder.mat(Color(0.18, 0.18, 0.2), 0.5, 0.4)
	var floor_mat := Builder.mat(Color(0.2, 0.2, 0.22), 0.4, 0.2)
	# Floor, ceiling, back and side walls: each a visible box with a collider, all part of the moving body.
	_cab_box(Vector3(0, -0.075, 0), Vector3(CAB_W, 0.15, CAB_D), floor_mat)
	_cab_box(Vector3(0, CAB_H + 0.05, 0), Vector3(CAB_W + 0.1, 0.1, CAB_D + 0.1), steel)
	_cab_box(Vector3(0, CAB_H * 0.5, -CAB_D * 0.5 - 0.04), Vector3(CAB_W + 0.1, CAB_H, 0.08), panel_mat)
	_cab_box(Vector3(-CAB_W * 0.5 - 0.04, CAB_H * 0.5, 0), Vector3(0.08, CAB_H, CAB_D), steel)
	_cab_box(Vector3(CAB_W * 0.5 + 0.04, CAB_H * 0.5, 0), Vector3(0.08, CAB_H, CAB_D), steel)
	# A mirror strip on the back wall and a light.
	_cab_box(Vector3(0, CAB_H * 0.55, -CAB_D * 0.5 + 0.005), Vector3(CAB_W * 0.7, 1.2, 0.01), Builder.mat(Color(0.8, 0.85, 0.9), 0.05, 1.0), false)
	var light := OmniLight3D.new()
	light.position = Vector3(0, CAB_H - 0.2, 0)
	light.light_energy = 1.6
	light.omni_range = 5.0
	light.light_color = Color(1.0, 0.95, 0.85)
	cabin.add_child(light)
	_display = Label3D.new()
	_display.font_size = 90
	_display.pixel_size = 0.004
	_display.modulate = Color(1.0, 0.6, 0.2)
	_display.outline_size = 0
	_display.no_depth_test = false
	_display.position = Vector3(0, CAB_H - 0.25, CAB_D * 0.5 - 0.02)
	cabin.add_child(_display)
	# The doorway: an invisible wall that is only solid while the cabin travels, so nobody steps out into the shaft.
	var fb := CollisionShape3D.new()
	var fs := BoxShape3D.new()
	fs.size = Vector3(CAB_W, CAB_H, 0.1)
	fb.shape = fs
	fb.position = Vector3(0, CAB_H * 0.5, CAB_D * 0.5 + 0.05)
	fb.disabled = true
	cabin.add_child(fb)
	_front_block = fb
	# The cabin's own doors (look only: the colliding ones are at the stops).
	_cab_doors = SlidingDoor.new()
	_cab_doors.width = CAB_W
	_cab_doors.height = CAB_H
	_cab_doors.two_leaves = true
	_cab_doors.auto = false
	_cab_doors.paint = Color(0.78, 0.79, 0.82)
	_cab_doors.metallic = 0.8
	_cab_doors.slide_time = 0.8
	_cab_doors.position = Vector3(0, 0, CAB_D * 0.5 + 0.02)
	cabin.add_child(_cab_doors)
	# Where a person counts as "in the lift".
	_in_cabin = Area3D.new()
	_in_cabin.collision_layer = 0
	_in_cabin.collision_mask = Data.L_PLAYER
	var zs := CollisionShape3D.new()
	var zb := BoxShape3D.new()
	zb.size = Vector3(CAB_W - 0.2, CAB_H, CAB_D - 0.2)
	zs.shape = zb
	zs.position = Vector3(0, CAB_H * 0.5, 0)
	_in_cabin.add_child(zs)
	cabin.add_child(_in_cabin)
	cabin.position = Vector3(0, stops[0].y if stops.size() > 0 else 0.0, 0)


func _cab_box(pos: Vector3, size: Vector3, mat: Material, collide := true) -> void:
	if collide:
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = size
		cs.shape = bs
		cs.position = pos
		cabin.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	cabin.add_child(mi)


## The shaft front at one stop: lift doors in the wall, and a call button beside them.
func _build_stop(i: int) -> void:
	var y: float = stops[i].y
	var d := SlidingDoor.new()
	d.width = CAB_W
	d.height = CAB_H
	d.two_leaves = true
	d.auto = false
	d.paint = Color(0.74, 0.75, 0.78)
	d.metallic = 0.8
	d.slide_time = 0.8
	d.position = Vector3(0, y, CAB_D * 0.5 + 0.1)
	add_child(d)
	stop_doors.append(d)
	# A frame around the doors.
	var frame := Builder.mat(Color(0.12, 0.12, 0.13), 0.4, 0.7)
	Builder.box(self, Vector3(0, y + CAB_H + 0.15, CAB_D * 0.5 + 0.1), Vector3(CAB_W + 0.5, 0.3, 0.3), frame, false)
	Builder.box(self, Vector3(-CAB_W * 0.5 - 0.15, y + CAB_H * 0.5, CAB_D * 0.5 + 0.1), Vector3(0.3, CAB_H, 0.3), frame, false)
	Builder.box(self, Vector3(CAB_W * 0.5 + 0.15, y + CAB_H * 0.5, CAB_D * 0.5 + 0.1), Vector3(0.3, CAB_H, 0.3), frame, false)
	# Call button, on the wall to the right of the doors.
	var b := UseTrigger.new()
	b.prompt = "E - Call Elevator"
	b.radius = 1.2
	b.position = Vector3(CAB_W * 0.5 + 0.7, y + 1.1, CAB_D * 0.5 + 0.9)
	b.enabled_check = func(_p): return not jammed
	b.callback = func(_p): call_to(i)
	add_child(b)
	call_buttons.append(b)
	var lamp := Builder.box(self, Vector3(CAB_W * 0.5 + 0.7, y + 1.1, CAB_D * 0.5 + 0.28), Vector3(0.12, 0.2, 0.05), Builder.mat(Color(0.2, 0.2, 0.22), 0.4), false)
	lamp.name = "Button%d" % i


# ── operation ─────────────────────────────────────────────────────────────────

func stop_y(i: int) -> float:
	return stops[i].y


func doors_open() -> bool:
	return stop_doors[current].is_open and not moving


## Bring the cabin to stop `i` and open the doors there (the call button, and the floor panel).
func call_to(i: int) -> void:
	if i < 0 or i >= stops.size() or jammed:
		return
	if moving:
		if not _queue.has(i) and i != current:
			_queue.append(i)
		return
	_run(i)


func go_to(i: int) -> void:
	call_to(i)


func set_jammed(on: bool) -> void:
	jammed = on


func _run(target: int) -> void:
	moving = true
	if current == target:
		if not stop_doors[current].is_open:
			await _set_doors(current, true)
		moving = false
		arrived.emit(current)
		return
	var from := current
	# Whoever is in the cabin rides with it.
	var passenger: Node = _player_in_cabin_node()
	await _set_doors(from, false)
	departed.emit(from)
	_front_block.disabled = false
	rider = passenger
	if rider is Player:
		(rider as Player).set_cinematic(true)
	var dist := absf(stops[target].y - stops[from].y)
	_rider_offset = (rider as Node3D).global_position.y - cabin.global_position.y if rider is Node3D else 0.0
	_trip_from = stops[from].y
	_trip_to = stops[target].y
	_trip_dur = maxf(MIN_TRIP, dist / SPEED * 1.15)
	_trip_t = 0.0
	_trip_active = true
	await trip_finished
	current = target
	_show_floor()
	_front_block.disabled = true
	if rider is Player:
		(rider as Player).set_cinematic(false)
	rider = null
	await _set_doors(target, true)
	moving = false
	arrived.emit(target)
	if not _queue.is_empty():
		var nxt: int = _queue.pop_front()
		_run(nxt)


## The cabin is moved on the physics tick (an AnimatableBody3D wants that), and the rider is placed relative to it each tick rather
## than nudged by increments, so the two can never drift apart.
func _physics_process(delta: float) -> void:
	if not _trip_active:
		return
	_trip_t += delta
	var k := clampf(_trip_t / _trip_dur, 0.0, 1.0)
	var eased := 0.5 - 0.5 * cos(k * PI)
	var y := lerpf(_trip_from, _trip_to, eased)
	cabin.position.y = y
	if rider is Player:
		var p := rider as Player
		p.global_position.y = cabin.global_position.y + _rider_offset
	_display.text = _floor_text_at(y)
	if k >= 1.0:
		_trip_active = false
		trip_finished.emit()


func _floor_text_at(y: float) -> String:
	var best := 0
	var best_d := INF
	for i in range(stops.size()):
		var d := absf(stops[i].y - y)
		if d < best_d:
			best_d = d
			best = i
	return stops[best].label


func _show_floor() -> void:
	_display.text = stops[current].label


func _set_doors(stop: int, open: bool) -> void:
	_cab_doors.set_open(open)
	await stop_doors[stop].set_open(open)


func _player_in_cabin() -> bool:
	return _player_in_cabin_node() != null


func _player_in_cabin_node() -> Node:
	for b in _in_cabin.get_overlapping_bodies():
		if b is Player:
			return b
	return null
