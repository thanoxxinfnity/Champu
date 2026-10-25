extends SceneTree
## Draw calls / triangles / objects at representative spots (real renderer under xvfb, sun shadows off like on a phone): the budget gate for phones.
## With `--split` it also reports what each zone and each kind of character costs at every spot.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/perf_probe.gd [-- --split]

const SPOTS := [["ward", Vector3(0, 0, 0), 0.0], ["corridor", Vector3(0, 0, -6), 0.0], ["market_start", Vector3(0, 0, -30), 0.0], ["market_mid", Vector3(2, 0, -52), 0.35],
	["church", Vector3(0, 0, -96), 0.5], ["bell_road", Vector3(0, 0, -150), 0.0], ["arena", Vector3(0, 0, -190), 0.0]]


func _info() -> Vector2i:
	return Vector2i(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME), RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME))


func _initialize() -> void:
	root.size = Vector2i(1280, 720)
	var split := OS.get_cmdline_user_args().has("--split")
	var game: Game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	await process_frame
	await game.start_game(false)
	for i in 6:
		await process_frame
	game.hud.hide_all_screens()
	game.world.sun.shadow_enabled = false
	var worst := Vector2i.ZERO
	for s in SPOTS:
		game.player.global_position = s[1]
		game.player.yaw = s[2]
		for i in 20:
			await process_frame
		var base := _info()
		worst = Vector2i(maxi(worst.x, base.x), maxi(worst.y, base.y))
		print("perf %-13s triangles %7d  draw calls %4d  objects %4d" % [s[0], base.x, base.y, RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME)])
		if not split:
			continue
		for z in game.world.zones:
			var node: Node3D = game.world.zones[z].node
			if not node.visible:
				continue
			node.visible = false
			for i in 3:
				await process_frame
			var d := _info()
			node.visible = true
			if base.x - d.x > 500:
				print("     zone %-8s %7d tris %4d draw calls" % [z, base.x - d.x, base.y - d.y])
		for cls in ["Npc", "Companion", "Enemy", "Player"]:
			var hid: Array = []
			for c in game.get_children():
				if c is Node3D and c.get_script() != null and String(c.get_script().get_global_name()) == cls:
					hid.append(c)
					c.visible = false
			if hid.is_empty():
				continue
			for i in 3:
				await process_frame
			var d := _info()
			for c in hid:
				c.visible = true
			print("     %-9s x%d %7d tris %4d draw calls" % [cls, hid.size(), base.x - d.x, base.y - d.y])
	print("perf WORST  triangles %d  draw calls %d" % [worst.x, worst.y])
	quit()
