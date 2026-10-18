class_name LaneDriver
extends Node
## The brain of a car that is not the player's. It follows lane paths along the street grid — straight on or around a corner at each
## intersection — stops for red lights and for anything in front, and keeps a speed. A police driver uses the same machinery but
## chooses its turns to close on the player instead of at random.

enum Mode { TRAFFIC, POLICE }

const LANE := 2.0                        # distance from the road's centre line to this car's lane
const APPROACH := 10.0                   # how far before the intersection centre the stop line is
const LOOK_AHEAD := 14.0

var vehicle: Vehicle
var mode := Mode.TRAFFIC
var lights: TrafficLights
var cruise := 11.0
var node := Vector2i.ZERO                # the intersection being driven toward
var dir := Vector2i(0, 1)                # grid direction of travel (x or z)
var target: Node3D = null                # police: who to chase
var path: Array[Vector3] = []
var stopped_for := 0.0
var _reverse_t := 0.0
var _stuck_t := 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	vehicle = get_parent() as Vehicle
	vehicle.ai = self
	_rng.randomize()


## Put the car on the lane just before `to_node`, travelling in `d`.
func place(to_node: Vector2i, d: Vector2i) -> void:
	node = to_node
	dir = d
	var c := node_pos(node)
	var back := Vector3(d.x, 0, d.y)
	var p := c - back * 38.0 + _right(d) * LANE
	vehicle.global_transform = Transform3D(_basis_for(d), Vector3(p.x, Vehicle.GROUND_TO_ORIGIN + 0.25, p.z))
	path.clear()


static func node_pos(n: Vector2i) -> Vector3:
	return Vector3(City.ROAD_LINES[n.x], 0, City.ROAD_LINES[n.y])


static func _right(d: Vector2i) -> Vector3:
	var f := Vector3(d.x, 0, d.y)
	return f.cross(Vector3.UP)


## Vehicle forward is +Z, so a car travelling along grid direction d has its +Z pointing at d.
static func _basis_for(d: Vector2i) -> Basis:
	return Basis.looking_at(-Vector3(d.x, 0, d.y), Vector3.UP)


func _in_grid(n: Vector2i) -> bool:
	return n.x >= 0 and n.y >= 0 and n.x < City.ROAD_LINES.size() and n.y < City.ROAD_LINES.size()


func _choose_dir() -> Vector2i:
	var options: Array[Vector2i] = []
	for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		if d == -dir or not _in_grid(node + d):
			continue
		options.append(d)
	if options.is_empty():
		return -dir
	if mode == Mode.POLICE and target != null:
		var goal := _nearest_node(target.global_position)
		var best: Vector2i = options[0]
		var best_cost := INF
		for d in options:
			var n: Vector2i = node + d
			var cost: float = absf(float(goal.x - n.x)) + absf(float(goal.y - n.y)) + (0.0 if d == dir else 0.3)
			if cost < best_cost:
				best_cost = cost
				best = d
		return best
	# Traffic mostly goes straight.
	if options.has(dir) and _rng.randf() < 0.55:
		return dir
	return options[_rng.randi() % options.size()]


static func _nearest_node(p: Vector3) -> Vector2i:
	var bx := 0
	var bz := 0
	for i in range(City.ROAD_LINES.size()):
		if absf(p.x - City.ROAD_LINES[i]) < absf(p.x - City.ROAD_LINES[bx]):
			bx = i
		if absf(p.z - City.ROAD_LINES[i]) < absf(p.z - City.ROAD_LINES[bz]):
			bz = i
	return Vector2i(bx, bz)


## Append the points that carry the car through the intersection at `node` and out the other side.
func _plan_through() -> void:
	var c := node_pos(node)
	var d2 := _choose_dir()
	var f1 := Vector3(dir.x, 0, dir.y)
	var f2 := Vector3(d2.x, 0, d2.y)
	var a := c - f1 * (City.ROAD_W * 0.5 + 1.0) + _right(dir) * LANE
	var b := c + f2 * (City.ROAD_W * 0.5 + 1.0) + _right(d2) * LANE
	path.append(a)
	if d2 == dir:
		path.append(c + _right(dir) * LANE)
	elif d2 == -dir:
		var mid := c + _right(dir) * (LANE + 5.0)
		path.append(mid)
		path.append(c - f1 * 6.0 + _right(d2) * (LANE + 3.0))
	else:
		var corner := c + _right(dir) * LANE + _right(d2) * LANE
		for t in [0.25, 0.5, 0.75]:
			path.append(a.lerp(corner, t).lerp(corner.lerp(b, t), t))
	path.append(b)
	dir = d2
	node = node + d2


func _red_ahead() -> bool:
	if lights == null or mode == Mode.POLICE:
		return false
	var c := node_pos(node)
	var f := Vector3(dir.x, 0, dir.y)
	var along := (c - vehicle.global_position).dot(f)
	if along < 2.0 or along > APPROACH + 6.0:
		return false
	var axis := 0 if dir.x == 0 else 1
	return lights.phase_of(node, axis) != 2


func _blocked_distance() -> float:
	var from := vehicle.global_position + Vector3(0, 0.5, 0)
	var f := vehicle.global_basis.z
	var q := PhysicsRayQueryParameters3D.create(from + f * 2.6, from + f * (2.6 + LOOK_AHEAD), Data.L_DYNAMIC | Data.L_PLAYER)
	q.exclude = [vehicle.get_rid()]
	var hit := vehicle.get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty():
		return INF
	return from.distance_to(hit.position) - 2.6


func _physics_process(delta: float) -> void:
	if vehicle == null or vehicle.is_player_driven or vehicle.driver != null:
		return
	if mode == Mode.POLICE and target != null:
		_police_extra()
	while path.size() < 4:
		_plan_through()
	var pos := vehicle.global_position
	var tp := path[0]
	var flat := Vector3(tp.x - pos.x, 0, tp.z - pos.z)
	if flat.length() < 4.5:
		path.pop_front()
		tp = path[0]
	var local := vehicle.to_local(Vector3(tp.x, pos.y, tp.z))
	var angle := atan2(local.x, local.z)
	var steer := clampf(-angle * 1.8, -1.0, 1.0)
	var fwd := vehicle.forward_speed()
	var want := cruise
	if absf(angle) > 0.5:
		want = minf(want, 5.0)
	var blocked := _blocked_distance()
	if blocked < LOOK_AHEAD:
		want = minf(want, maxf(0.0, (blocked - 4.0) * 0.9))
	if _red_ahead():
		var d := (node_pos(node) - pos).dot(Vector3(dir.x, 0, dir.y)) - APPROACH
		want = minf(want, maxf(0.0, d * 0.7))
	var throttle := clampf((want - fwd) * 0.35, -1.0, 1.0)
	if want <= 0.1 and fwd < 0.8:
		throttle = 0.0
		vehicle.set_controls(0.0, steer, true)
		stopped_for += delta
	else:
		stopped_for = 0.0
		vehicle.set_controls(throttle, steer, false)
	# Wedged against something: back out for a moment.
	if _reverse_t > 0.0:
		_reverse_t -= delta
		vehicle.set_controls(-0.8, -steer, false)
	elif want > 3.0 and absf(fwd) < 0.4:
		_stuck_t += delta
		if _stuck_t > 2.5:
			_reverse_t = 1.2
			_stuck_t = 0.0
	else:
		_stuck_t = 0.0


## Police ignore the lane plan once close: head for the target directly.
func _police_extra() -> void:
	cruise = 22.0
	var to := target.global_position - vehicle.global_position
	to.y = 0.0
	if to.length() < 30.0 and _line_clear(target.global_position):
		path = [target.global_position, target.global_position + to.normalized() * 5.0, target.global_position + to.normalized() * 10.0, target.global_position + to.normalized() * 15.0]


func _line_clear(p: Vector3) -> bool:
	var from := vehicle.global_position + Vector3(0, 1.0, 0)
	var q := PhysicsRayQueryParameters3D.create(from, p + Vector3(0, 1.0, 0), Data.L_WORLD)
	return vehicle.get_world_3d().direct_space_state.intersect_ray(q).is_empty()


## The driver is dragged out: a pedestrian steps out of the door and runs.
func on_hijacked(thief: Node) -> void:
	var ped := Pedestrian.make("npc_street" if _rng.randf() < 0.5 else "npc_business", Vector3.ZERO, true)
	var holder := vehicle.get_parent()
	holder.add_child(ped)
	ped.global_position = vehicle.to_global(Vector3(2.0, 0.0, 0.2 - Vehicle.GROUND_TO_ORIGIN + 0.55))
	ped.global_position.y = vehicle.global_position.y - Vehicle.GROUND_TO_ORIGIN + 0.3
	ped.scare((thief as Node3D).global_position if thief is Node3D else vehicle.global_position)
	queue_free()
