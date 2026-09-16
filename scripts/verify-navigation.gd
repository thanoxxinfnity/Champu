extends SceneTree
## Can the horde actually get to you?
##
## One zombie on every spawn point, left to walk. The old arena was an open
## square, so "head straight for the player" was a complete AI. On a city block
## it is not: run against the first version of this level, **ten of sixteen**
## pressed into the corner of a building and stayed there for the whole match.
## The four diagonal spawns all jammed at the same coordinate, which is what a
## wall looks like from the outside.
##
## Nothing about that shows up anywhere else. The scene loads, the zombies
## exist, the wave counter says sixteen — and the wave never clears, so a
## mission that asks for forty kills cannot be finished at all.
var _scene: Node
var _player: CharacterBody3D
var _probes: Array = []
var _n := 0

## Frames without getting any closer before a zombie counts as stuck. Generous:
## walking round a building is a long detour that makes no progress towards the
## player at all while it happens.
const IDLE_LIMIT := 2500

func _initialize() -> void:
	_scene = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(_scene)
	_player = _scene.get_node("Player")
	_scene.get_node("Director").set_process(false)
	_player.global_position = Vector3(0, 1.2, 0)

func _process(_d: float) -> bool:
	_n += 1
	if _n == 2:
		var spawns: PackedVector3Array = _scene.get_node("Director").spawn_points
		for i in spawns.size():
			var z := CharacterBody3D.new()
			z.set_script(load("res://enemy.gd"))
			z.collision_layer = 2
			z.collision_mask = 1 | 2
			var s := CollisionShape3D.new()
			var cap := CapsuleShape3D.new()
			cap.height = 1.9
			cap.radius = 0.4
			s.shape = cap
			s.position = Vector3(0, 0.95, 0)
			z.add_child(s)
			_scene.add_child(z)
			z.global_position = spawns[i]
			z.set("target", _player)
			z.set("speed", 3.0)
			z.set("health", 100000.0)
			_probes.append({"z": z, "from": spawns[i], "best": 999.0, "idle": 0})
		return false
	if _n > 2:
		for p in _probes:
			if p["best"] < 2.0:
				continue
			var z: Node3D = p["z"]
			if not is_instance_valid(z):
				continue
			var now: float = z.global_position.distance_to(_player.global_position)
			# Stuck means *no longer getting closer*, not "has not arrived yet".
			# Timing out on a fixed frame budget made this test a measure of how
			# fast the machine was: the same level passed with no props and
			# failed with them, because heavier assets mean fewer physics steps
			# per frame, not a worse route.
			if now < p["best"] - 0.05:
				p["idle"] = 0
			else:
				p["idle"] += 1
			p["best"] = minf(p["best"], now)
			# Taken off the board once it arrives, the way a zombie that reached
			# you would be. Sixteen of them converging on one spot otherwise pile
			# into a scrum three metres deep, and the ones at the back get scored
			# as blocked by a building when they are only blocked by each other.
			if p["best"] < 2.0:
				z.queue_free()
	# Runs until every zombie has either arrived or given up, rather than for a
	# fixed time.
	# Not before the probes exist: an empty list is not "everyone has arrived".
	if _probes.is_empty():
		return false
	var busy := false
	for p in _probes:
		if p["best"] >= 2.0 and p["idle"] < IDLE_LIMIT:
			busy = true
	if busy and _n < 60000:
		return false

	var reached := 0
	print("")
	for p in _probes:
		var ok: bool = p["best"] < 3.0
		if ok:
			reached += 1
		else:
			print("  STUCK  from %-22s stopped getting closer at %.1fm, sitting at %s" % [
				str(p["from"]), p["best"],
				(p["z"] as Node3D).global_position if is_instance_valid(p["z"]) else Vector3.ZERO])
	print("")
	print("%d of %d zombies reached the player" % [reached, _probes.size()])
	# Every one of them. A single zombie that cannot reach you is a spawn point
	# that leads into a wall, and it will be the one the last kill is behind.
	if reached == _probes.size():
		print("NAVIGATION OK")
		quit(0)
	else:
		print("NAVIGATION BROKEN")
		quit(1)
	return true
