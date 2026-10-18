class_name Traffic
extends Node
## Fills the streets: cars on the lane network that obey the signals, and pedestrians on the pavements. Keeps the population
## steady — a car that ends up on its roof is put back on the road, a dead pedestrian is replaced.

const CAR_KINDS := ["sedan", "muscle", "sedan", "hypercar"]
const PED_KINDS := ["npc_business", "npc_casual", "npc_street", "npc_casual"]

var lights: TrafficLights
var cars: Array[Vehicle] = []
var peds: Array[Pedestrian] = []
var car_count := 10
var ped_count := 16
var _rng := RandomNumberGenerator.new()
var _flip_t: Dictionary = {}
var _refill_t := 0.0


func populate(root: Node) -> void:
	_rng.seed = 11
	lights = TrafficLights.new()
	root.add_child(lights)
	for i in range(car_count):
		spawn_car(root, CAR_KINDS[i % CAR_KINDS.size()], i)
	for i in range(ped_count):
		spawn_ped(root, PED_KINDS[i % PED_KINDS.size()])


func spawn_car(root: Node, kind: String, i: int) -> Vehicle:
	var v := Vehicle.make(kind)
	root.add_child(v)
	var d := LaneDriver.new()
	v.add_child(d)
	d.lights = lights
	d.cruise = _rng.randf_range(9.0, 13.0)
	var dirs := [Vector2i(0, 1), Vector2i(0, -1), Vector2i(1, 0), Vector2i(-1, 0)]
	var dr: Vector2i = dirs[i % 4]
	var n := Vector2i(_rng.randi_range(1, 2), _rng.randi_range(1, 2))
	if dr.x != 0:
		n = Vector2i(1 if dr.x > 0 else 2, i % 4)
	else:
		n = Vector2i(i % 4, 1 if dr.y > 0 else 2)
	d.place(n, dr)
	cars.append(v)
	return v


func spawn_ped(root: Node, kind: String) -> Pedestrian:
	var blocks := [-100.0, 0.0, 100.0]
	var b := Vector3(blocks[_rng.randi() % 3], 0, blocks[_rng.randi() % 3])
	var p := Pedestrian.make(kind, b, _rng.randf() < 0.5)
	root.add_child(p)
	var side := _rng.randi() % 4
	var t := _rng.randf_range(-36.0, 36.0)
	var o := Pedestrian.SIDEWALK_OFFSET
	var pos := [Vector3(o, 0.25, t), Vector3(-o, 0.25, t), Vector3(t, 0.25, o), Vector3(t, 0.25, -o)][side] as Vector3
	p.global_position = b + pos
	peds.append(p)
	return p


func _process(delta: float) -> void:
	_refill_t -= delta
	if _refill_t <= 0.0:
		_refill_t = 4.0
		peds = peds.filter(func(p): return is_instance_valid(p))
		var living := peds.filter(func(p): return not p.dead).size()
		if living < ped_count:
			var player := get_tree().get_first_node_in_group("player") as Node3D
			var p := spawn_ped(get_parent(), PED_KINDS[_rng.randi() % PED_KINDS.size()])
			if player != null and p.global_position.distance_to(player.global_position) < 35.0:
				p.queue_free()
				peds.erase(p)
	for v in cars:
		if not is_instance_valid(v) or v.ai == null:
			continue
		if not v.global_position.is_finite() or absf(v.global_position.x) > 600.0 or absf(v.global_position.z) > 600.0 or v.global_position.y < -20.0:
			var dd := v.ai as LaneDriver
			dd.place(dd.node, dd.dir)
			v.linear_velocity = Vector3.ZERO
			v.angular_velocity = Vector3.ZERO
			continue
		if v.global_basis.y.y < 0.3:
			_flip_t[v] = _flip_t.get(v, 0.0) + delta
			if _flip_t[v] > 4.0:
				_flip_t[v] = 0.0
				var d := v.ai as LaneDriver
				d.place(d.node, d.dir)
				v.linear_velocity = Vector3.ZERO
				v.angular_velocity = Vector3.ZERO
		else:
			_flip_t[v] = 0.0
