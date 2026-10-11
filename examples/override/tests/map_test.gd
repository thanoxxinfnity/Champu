extends SceneTree
## godot --headless --path . --fixed-fps 60 -s tests/map_test.gd
## The map is not broken: every doorway really joins two rooms, no two rooms overlap, the navigation mesh joins every room of a
## chapter to where the player starts it, and every thing you can use can be reached and aimed at from somewhere you can stand.

var fails := 0
var game: Game


func check(ok: bool, what: String) -> void:
	if not ok:
		print("  FAIL " + what)
		fails += 1


func _init() -> void:
	print("-- the rooms and doorways")
	var ids: Array = Rooms.LIST.keys()
	for i in range(ids.size()):
		for j in range(i + 1, ids.size()):
			var a: Array = Rooms.LIST[ids[i]].r
			var b: Array = Rooms.LIST[ids[j]].r
			# Rooms are separated by at least one wall metre.
			var gap_x: bool = a[1] + Data.WALL <= b[0] or b[1] + Data.WALL <= a[0]
			var gap_z: bool = a[3] + Data.WALL <= b[2] or b[3] + Data.WALL <= a[2]
			check(gap_x or gap_z, "%s and %s overlap or touch" % [ids[i], ids[j]])
	for d in Rooms.DOORS:
		var a: Array = Rooms.LIST[d.a].r
		var b: Array = Rooms.LIST[d.b].r
		var span: Array = d.span
		check(span[1] - span[0] == Data.DOOR_W, "door %s is %d wide" % [d.id, span[1] - span[0]])
		if d.axis == "x":
			check(a[1] == d.at and b[0] == d.at + Data.WALL, "door %s: the wall is one metre between the rooms" % d.id)
			check(span[0] >= a[2] and span[1] <= a[3] and span[0] >= b[2] and span[1] <= b[3], "door %s fits both rooms" % d.id)
		else:
			check(a[3] == d.at and b[2] == d.at + Data.WALL, "door %s: the wall is one metre between the rooms" % d.id)
			check(span[0] >= a[0] and span[1] <= a[1] and span[0] >= b[0] and span[1] <= b[1], "door %s fits both rooms" % d.id)

	var packed := load("res://scenes/main.tscn") as PackedScene
	game = packed.instantiate()
	game.headless_test = true
	root.add_child(game)
	for i in range(10):
		await physics_frame

	print("-- the navigation mesh joins each chapter")
	var map := game.world.get_world_3d().navigation_map
	for ch in Rooms.CHAPTERS:
		var spawn: Vector3 = Rooms.CHAPTERS[ch].spawn
		for id in Rooms.LIST:
			if Rooms.LIST[id].ch != ch:
				continue
			var r: Array = Rooms.LIST[id].r
			var centre := Vector3((r[0] + r[1]) * 0.5, 0.0, (r[2] + r[3]) * 0.5)
			var path := NavigationServer3D.map_get_path(map, spawn, centre, true)
			var ok: bool = path.size() >= 2 and path[path.size() - 1].distance_to(centre) < 1.6
			check(ok, "chapter %d: a path from the start to %s (%d points)" % [ch, id, path.size()])

	print("-- everything usable can be reached and aimed at")
	var space := game.world.get_world_3d().direct_space_state
	var count := 0
	for id in Rooms.LIST:
		game.world.focus(id)
		await physics_frame
		await physics_frame
		var node: Node3D = game.world.loaded[id]
		for u in node.find_children("*", "Use", true, false):
			count += 1
			if not _reachable(space, u as Use, id):
				check(false, "%s in %s cannot be aimed at from anywhere you can stand" % [(u as Use).id, id])
	print("  %d usable things checked" % count)

	print("-- every needed item exists in its chapter")
	var need := {"emp": "c1_cryo", "fuse_1": "c1_server", "fuse_2": "c1_store", "fuse_3": "c1_store", "cable": "c1_store", "wiring": "c2_pump", "timer": "c2_ctrl", "keycard": "c3_office", "gel": "c3_work"}
	for item in need:
		game.world.focus(need[item])
		await physics_frame
		var found := false
		for u in (game.world.loaded[need[item]] as Node3D).find_children("*", "Use", true, false):
			if (u as Use).id == item:
				found = true
		check(found, "%s is in %s" % [item, need[item]])
	check(game.world.loaded.has("c3_work"), "the workshop loaded for the check")

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)


## Some standing point within reach from which a ray from the eye meets this very thing first.
func _reachable(space: PhysicsDirectSpaceState3D, u: Use, room: String) -> bool:
	var centre := u.global_position
	var rect: Array = Rooms.LIST[room].r
	for radius in [1.2, 1.6, 2.0, 2.4]:
		for k in range(24):
			var ang := TAU * k / 24.0
			var stand := Vector3(centre.x + cos(ang) * radius, 0.0, centre.z + sin(ang) * radius)
			if stand.x < rect[0] + 0.4 or stand.x > rect[1] - 0.4 or stand.z < rect[2] + 0.4 or stand.z > rect[3] - 0.4:
				continue
			# Is there room for a person to stand there?
			# The ground there: the floor, or a plank over the water.
			var down := PhysicsRayQueryParameters3D.create(stand + Vector3(0, 1.0, 0), stand + Vector3(0, -0.5, 0), Data.L_WORLD)
			var ground := space.intersect_ray(down)
			if ground.is_empty():
				continue
			stand.y = ground.position.y
			var shape := CapsuleShape3D.new()
			shape.radius = 0.3
			shape.height = 1.7
			var sq := PhysicsShapeQueryParameters3D.new()
			sq.shape = shape
			sq.transform = Transform3D(Basis.IDENTITY, stand + Vector3(0, 0.97, 0))
			sq.collision_mask = Data.L_WORLD
			if not space.intersect_shape(sq, 1).is_empty():
				continue
			var eye := stand + Vector3(0, Player.EYE, 0)
			var q := PhysicsRayQueryParameters3D.create(eye, centre, Data.L_WORLD | Data.L_USE)
			var hit := space.intersect_ray(q)
			if not hit.is_empty() and hit.collider == u and eye.distance_to(centre) <= Player.REACH:
				return true
	return false
