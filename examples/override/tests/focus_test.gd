extends SceneTree
## godot --headless --fixed-fps 60 -s tests/focus_test.gd
## Aiming at something usable: the straight centre-of-screen ray, and the fallback that still finds a pick-up a
## piece of room clutter grazed, without letting the player reach through a real wall or grab something behind them.
## Player yaw 90deg faces -X (see enemy_test.gd); every position below is worked out against that.

var fails := 0
var game: Game


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func steps(n: int) -> void:
	for i in range(n):
		await physics_frame


func _init() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	root.add_child(game)
	await steps(6)
	game._begin()
	await steps(20)
	var room: Node3D = game.world.loaded[game.world.current]
	var p := game.player
	p.global_position = Vector3(12.0, 0, 4.0)
	p.yaw = deg_to_rad(90.0)   # faces -X
	p.pitch = 0.0

	print("-- the straight ray finds a use point dead ahead, with nothing in the way")
	var u1 := Use.new().setup("t1", "t1", Vector3(0.6, 0.6, 0.6), Vector3(10.0, 0.9, 4.0), Callable())
	room.add_child(u1)
	# Isolated from every real use-point already in this room, so a nearby fusebox or pick-up never
	# wins the fallback's "closest candidate" instead of the one this test is actually checking.
	game.world.uses = [u1]
	await steps(3)
	check(p.focus == u1, "found it dead ahead (focus %s)" % [p.focus])

	print("-- a crate dead-centre no longer blocks the item sitting just beside it")
	u1.global_position = Vector3(10.0, 0.9, 4.9)   # moved aside, within the look cone but off the straight ray
	var crate := StaticBody3D.new()
	crate.collision_layer = Data.L_WORLD
	var ccs := CollisionShape3D.new()
	var cbs := BoxShape3D.new()
	cbs.size = Vector3(0.9, 0.9, 0.9)
	ccs.shape = cbs
	crate.add_child(ccs)
	crate.position = Vector3(10.0, 0.45, 4.0)   # exactly where u1 used to be — the straight ray hits this now
	room.add_child(crate)
	await steps(3)
	check(p.focus == u1, "the fallback still finds the item beside the crate (focus %s)" % [p.focus])

	print("-- a real wall across the same line is still respected")
	var wall := StaticBody3D.new()
	wall.collision_layer = Data.L_WORLD
	var wcs := CollisionShape3D.new()
	var wbs := BoxShape3D.new()
	wbs.size = Vector3(0.2, 3.0, 2.5)
	wcs.shape = wbs
	wall.add_child(wcs)
	wall.position = Vector3(10.8, 1.5, 4.3)   # square across the line from the camera to u1
	room.add_child(wall)
	await steps(3)
	check(p.focus != u1, "a genuine wall still keeps it out of reach (focus %s)" % [p.focus])
	wall.queue_free()
	crate.queue_free()
	u1.global_position = Vector3(10.0, 0.9, 4.0)
	await steps(3)
	check(p.focus == u1, "and it is reachable again once the wall and crate are gone")

	print("-- something close by but off to the side, not where the player is looking, is ignored")
	var u2 := Use.new().setup("t2", "t2", Vector3(0.6, 0.6, 0.6), Vector3(12.0, 0.9, 5.9), Callable())
	room.add_child(u2)
	game.world.uses = [u1, u2]
	await steps(3)
	check(p.focus != u2, "not picked up just for being near; the player is not looking at it (focus %s)" % [p.focus])
	u2.queue_free()
	game.world.uses = [u1]

	print("-- a far-reach item (a pick-up, the charger) is caught past the normal reach; an ordinary one is not")
	var far_dist: float = Player.REACH * 1.3
	u1.far = true
	u1.global_position = Vector3(12.0 - far_dist, 0.9, 4.0)
	await steps(3)
	check(p.focus == u1, "the far-reach item is caught at 1.3x the normal distance (focus %s)" % [p.focus])
	u1.far = false
	await steps(3)
	check(p.focus != u1, "and the same distance is out of reach once it is an ordinary item")

	print("-- ALL OK" if fails == 0 else "-- %d FAILED" % fails)
	quit(0 if fails == 0 else 1)
