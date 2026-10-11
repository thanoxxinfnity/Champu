extends SceneTree
## godot --headless --path . --fixed-fps 60 -s tests/stream_test.gd
## Only the room the player is in and its neighbours exist. A room two doors away is freed, built again when the player
## comes back, and the doorway triggers (not just the position check) are what move the focus.

var fails := 0
var game: Game


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func goto(p: Vector3, frames := 4) -> void:
	game.player.global_position = p
	for i in range(frames):
		await physics_frame


func _init() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	root.add_child(game)
	for i in range(6):
		await physics_frame
	game._begin()
	for i in range(6):
		await physics_frame
	var w := game.world

	print("-- walking the first chapter")
	var route := [["c1_cryo", Vector3(5, 0, 4)], ["c1_hall", Vector3(14, 0, 4)], ["c1_server", Vector3(15, 0, 10)], ["c1_hall", Vector3(20, 0, 4)], ["c1_store", Vector3(15, 0, -3)], ["c1_hall", Vector3(25, 0, 4)], ["c1_lift", Vector3(30, 0, 4)]]
	var first_cryo: Node3D = null
	for step in route:
		await goto(step[1])
		var want := w.wanted(step[0])
		var have := w.loaded.keys()
		var same := have.size() == want.size()
		for id in want:
			if not w.loaded.has(id):
				same = false
		check(w.current == step[0] and same, "in %s exactly %s are built (%s)" % [step[0], str(want), str(have)])
		if step[0] == "c1_cryo" and first_cryo == null:
			first_cryo = w.loaded["c1_cryo"]
	await process_frame
	await process_frame
	check(not is_instance_valid(first_cryo) or first_cryo.is_queued_for_deletion(), "the cryo chamber was freed once the player was two doors away")
	check(not w.loaded.has("c1_cryo") and not w.loaded.has("c1_server") and not w.loaded.has("c1_store"), "nothing but the lift and the hall is left at the end")
	check(w.build_count > w.loaded.size(), "rooms were built more than once (%d built in all)" % w.build_count)

	print("-- coming back")
	await goto(Vector3(5, 0, 4))
	check(w.loaded.has("c1_cryo") and w.loaded.has("c1_hall") and not w.loaded.has("c1_lift"), "the cryo chamber is built again and the lift is gone")
	var uses_here := 0
	for u in w.uses:
		if is_instance_valid(u):
			uses_here += 1
	check(uses_here == w.uses.size(), "no use-point of a freed room is left in the list")

	print("-- state survives a room being freed")
	await goto(Vector3(15, 0, 10))
	var holder_use: Use = null
	for u in w.uses:
		if u.id == "fuse_1":
			holder_use = u
	check(holder_use != null, "the fuse is on the server desk")
	game.pick_up(holder_use, "fuse_1", holder_use.get_meta("holder"))
	await goto(Vector3(5, 0, 4))
	await goto(Vector3(30, 0, 4))
	await goto(Vector3(15, 0, 10))
	var still := false
	for u in w.uses:
		if u.id == "fuse_1":
			still = true
	check(not still and game.s.inv.has("fuse"), "a fuse taken stays taken after the room is rebuilt")

	print("-- the doorway triggers do the moving")
	w.auto_follow = false
	await goto(Vector3(14, 0, 4), 8)
	w.focus("c1_hall")
	await goto(Vector3(15.5, 0, 6.5), 8)  # in the gap of the hall -> server doorway
	check(w.current == "c1_server", "walking into the doorway made the server the current room (%s)" % w.current)
	await goto(Vector3(15.5, 0, 1.5), 8)  # the gap of the hall -> store doorway
	check(w.current == "c1_store" or w.current == "c1_hall", "the store doorway answers too (%s)" % w.current)

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
