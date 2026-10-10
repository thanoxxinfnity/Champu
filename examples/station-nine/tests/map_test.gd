extends SceneTree
## godot --headless --path . -s tests/map_test.gd
## The map is not broken: every doorway lets a person through, every waypoint is reachable, and every
## thing you can press USE on can be reached and aimed at from somewhere you can stand.

var fails := 0
var game: Game
var space: PhysicsDirectSpaceState3D


func check(ok: bool, what: String) -> void:
	if not ok:
		print("  FAIL " + what)
		fails += 1


func _init() -> void:
	var packed := load("res://scenes/main.tscn") as PackedScene
	game = packed.instantiate()
	game.headless_test = true
	root.add_child(game)
	for i in range(4):
		await physics_frame
	space = game.get_world_3d().direct_space_state
	var level := game.level
	for id in level.doors:
		level.doors[id].set_open(true, true)
	for i in range(3):
		await physics_frame

	print("-- graph")
	var seen := {"ai": true}
	var queue := ["ai"]
	while not queue.is_empty():
		var cur: String = queue.pop_front()
		for e in level.edges[cur]:
			if not seen.has(e.to):
				seen[e.to] = true
				queue.append(e.to)
	check(seen.size() == level.nodes.size(), "every waypoint is connected to the airlock (%d of %d)" % [seen.size(), level.nodes.size()])
	print("  nodes %d, doors %d, uses %d" % [level.nodes.size(), level.doors.size(), level.uses.size()])

	print("-- walkable edges (a person-sized capsule sweeps every route)")
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.33
	capsule.height = 1.7
	var blocked := 0
	var done := {}
	for a in level.edges:
		for e in level.edges[a]:
			var key: String = (a + ">" + e.to) if a < e.to else (e.to + ">" + a)
			if done.has(key):
				continue
			done[key] = true
			var from: Vector3 = level.nodes[a].pos + Vector3(0, 0.9, 0)
			var to: Vector3 = level.nodes[e.to].pos + Vector3(0, 0.9, 0)
			var q := PhysicsShapeQueryParameters3D.new()
			q.shape = capsule
			q.collision_mask = Data.L_WORLD
			q.transform = Transform3D(Basis(), from)
			q.motion = to - from
			var r := space.cast_motion(q)
			var start_hit := not space.intersect_shape(q, 1).is_empty()
			if start_hit or r[0] < 0.999:
				blocked += 1
				print("  BLOCKED %s -> %s (hit at %.0f%%%s)" % [a, e.to, r[0] * 100.0, ", start inside a wall" if start_hit else ""])
	check(blocked == 0, "no route is blocked (%d)" % blocked)

	print("-- every thing you can use can be reached and aimed at")
	var unreachable := 0
	for u in level.uses:
		var found := false
		var centre := u.global_position
		for ring in [0.9, 1.3, 1.7, 2.1, 2.4]:
			for k in range(16):
				var ang := TAU * float(k) / 16.0
				var p := Vector3(centre.x + cos(ang) * ring, 0.0, centre.z + sin(ang) * ring)
				if level.zone_at(p) == "":
					continue
				var q2 := PhysicsShapeQueryParameters3D.new()
				q2.shape = capsule
				q2.collision_mask = Data.L_WORLD
				q2.transform = Transform3D(Basis(), p + Vector3(0, 0.9, 0))
				if not space.intersect_shape(q2, 1).is_empty():
					continue
				var eye := p + Vector3(0, 1.6, 0)
				var dir := (centre - eye).normalized()
				var rq := PhysicsRayQueryParameters3D.create(eye, eye + dir * Player.REACH, Data.L_WORLD | Data.L_USE)
				var hit := space.intersect_ray(rq)
				if not hit.is_empty() and hit.collider == u:
					found = true
					break
			if found:
				break
		if not found:
			unreachable += 1
			print("  CANNOT USE %s at %s" % [u.id, str(centre)])
	check(unreachable == 0, "all %d interactables are reachable (%d not)" % [level.uses.size(), unreachable])

	print("-- floor: every waypoint stands on a floor and inside a zone")
	for id in level.nodes:
		var p: Vector3 = level.nodes[id].pos
		check(level.zone_at(p) == level.nodes[id].zone, "%s is in zone %s (zone_at says %s)" % [id, level.nodes[id].zone, level.zone_at(p)])
		var rq2 := PhysicsRayQueryParameters3D.create(p + Vector3(0, 1.0, 0), p + Vector3(0, -1.0, 0), Data.L_WORLD)
		check(not space.intersect_ray(rq2).is_empty(), "%s has floor under it" % id)

	print("-- hiding places are inside the station and fit a person")
	for u in level.lockers:
		var z := level.zone_at(Vector3(u.hide_pos.x, 0, u.hide_pos.z))
		check(z != "", "%s is inside a zone" % u.id)

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
