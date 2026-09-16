extends SceneTree
## Is the block a place you can move through, or a set of boxes that happen to
## be in the scene file?
##
## Everything here is a physics question, and physics questions cannot be
## answered by reading a .tscn. The ramp either carries a CharacterBody3D up or
## it does not; the streets either join up or a wall creeps into one; a zombie
## either reaches the player or stands in a building forever with the wave
## counter stuck.

var _fails: Array[String] = []
var _scene: Node
var _player: CharacterBody3D
var _arena: Node3D
var _step: int = 0
var _mark: Vector3
var _peak_climb: float = 0.0
var _closest: float = 999.0


func _check(name: String, ok: bool, detail: String = "") -> void:
	print(("  ok   " if ok else "  FAIL ") + name + ("" if detail == "" else "   " + detail))
	if not ok:
		_fails.append(name)


func _initialize() -> void:
	_scene = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(_scene)
	_player = _scene.get_node("Player")
	_arena = _scene.get_node("Navigation/Arena")
	# Nothing should shoot at us while we survey the map.
	_scene.get_node("Director").set_process(false)


## A ray straight down from well above, which is how you ask "what is the floor
## here" without guessing.
func _ground_at(x: float, z: float) -> Dictionary:
	var space := _player.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(Vector3(x, 40.0, z), Vector3(x, -2.0, z))
	query.collision_mask = 1
	# The player is on layer 1 too, and a ray that hits them reports the street
	# under their feet as blocked.
	query.exclude = [_player.get_rid()]
	return space.intersect_ray(query)


func _process(_delta: float) -> bool:
	_step += 1

	if _step == 1:
		var names: Array[String] = []
		for child in _arena.get_children():
			names.append(child.name)
		for wanted in ["Warehouse", "Depot", "Store", "Sheds", "Hall", "Watchtower", "EastWarehouse", "Ramp", "Overlook"]:
			_check("the block has its %s" % wanted, names.has(wanted))
		print("  arena pieces: ", names.size())
		return false

	if _step == 2:
		# ── The streets ─────────────────────────────────────────────────────
		# A ray down the middle of each street should land on the ground slab
		# every metre. Anything higher is a building in the road.
		var blocked_ns: int = 0
		var blocked_ew: int = 0
		for n in range(-30, 31):
			var ns := _ground_at(0.0, float(n))
			if not ns.is_empty() and (ns["position"] as Vector3).y > 0.6:
				blocked_ns += 1
			var ew := _ground_at(float(n), 0.0)
			if not ew.is_empty() and (ew["position"] as Vector3).y > 0.6:
				blocked_ew += 1
		_check("the north-south street is open end to end", blocked_ns == 0, "%d metres blocked" % blocked_ns)
		# The ramp deliberately stands in the east-west street. Everything else
		# in it would be a wall.
		_check("the east-west street is open apart from the ramp", blocked_ew <= 9, "%d metres blocked" % blocked_ew)
		return false

	if _step == 3:
		# ── Where the horde walks in from ───────────────────────────────────
		var bad: int = 0
		var spawns: PackedVector3Array = _scene.get_node("Director").spawn_points
		for at in spawns:
			var hit := _ground_at(at.x, at.z)
			if hit.is_empty() or (hit["position"] as Vector3).y > 0.6:
				bad += 1
				print("      spawn ", at, " lands on ", "nothing" if hit.is_empty() else hit["position"])
		_check("every spawn is on the street, not on a roof", bad == 0, "%d of %d are not" % [bad, spawns.size()])
		_check("there are enough mouths to come from", spawns.size() >= 12)
		return false

	if _step == 4:
		# ── The way up ──────────────────────────────────────────────────────
		var ramp: Node3D = _arena.get_node("Ramp")
		_player.global_position = Vector3(ramp.global_position.x, 1.0, ramp.global_position.z + 6.0)
		_player.velocity = Vector3.ZERO
		_mark = _player.global_position
		return false

	if _step > 4 and _step <= 900:
		# Walk north, up the slope. Straight at it, no jumping, no cheating.
		_player.touch_direction = Vector2(0.0, -1.0)
		_peak_climb = maxf(_peak_climb, _player.global_position.y)
		if _step % 300 == 0:
			print("      climbing: ", _player.global_position)
		if _step == 900:
			_check("a ramp you can actually walk up",
				_peak_climb > 3.5,
				"climbed to %.2fm from %.2fm" % [_peak_climb, _mark.y])
			_check("and it puts you on the overlook, not on its edge",
				_player.global_position.y > 3.5 and absf(_player.global_position.z - (-6.0)) < 4.0,
				"ended at %s" % _player.global_position)
			_player.touch_direction = Vector2.ZERO
			_player.global_position = Vector3(0.0, 1.2, 0.0)
			_player.velocity = Vector3.ZERO
		return false

	if _step == 901:
		_mark = _player.global_position
		return false

	if _step > 901 and _step <= 2600:
		# ── The run to the gate ─────────────────────────────────────────────
		# Mission three ends at (0, 30). If the slalom has turned into a wall,
		# the mission cannot be finished and nothing says so.
		_player.touch_direction = Vector2(0.0, 1.0)
		if _step % 600 == 0:
			print("      walking south: ", _player.global_position)
		if _step == 2600:
			_check("you can walk from the plaza to the gate",
				_player.global_position.z > 26.0,
				"got as far as z=%.1f" % _player.global_position.z)
			_player.touch_direction = Vector2.ZERO
			_player.global_position = Vector3(0.0, 1.2, 0.0)
			_player.velocity = Vector3.ZERO
			_scene.get_node("Director").set_process(true)
			_scene.get_node("Director").start()
		return false

	if _step > 2600 and _step <= 6000:
		# ── Can they get to you ─────────────────────────────────────────────
		for child in _scene.get_children():
			if child is CharacterBody3D and child != _player:
				_closest = minf(_closest, child.global_position.distance_to(_player.global_position))
		if _step == 6000:
			_check("the horde reaches the plaza from the streets",
				_closest < 4.0,
				"nearest zombie got to %.1fm" % _closest)
			return _finish()
		return false

	return false


func _finish() -> bool:
	print("")
	if _fails.is_empty():
		print("LEVEL OK — a place, not a box of boxes")
		quit(0)
	else:
		print("LEVEL BROKEN: ", ", ".join(_fails))
		quit(1)
	return true
