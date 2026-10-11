extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1280x720 -s tests/perf.gd
## A proxy for the 60 FPS mandate that can be measured without a phone: for every room the draw calls, primitives and lights the renderer is
## asked for in one frame must stay inside a budget. (Frame time itself depends on the phone; these counts do not.)

const MAX_DRAW_CALLS := 260
const MAX_PRIMITIVES := 450_000
const MAX_ROOMS_LOADED := 6

var fails := 0


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	var game := (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	Game.autostart = true
	root.add_child(game)
	for i in range(30):
		await process_frame
	game.ui.close_modal()
	var worst_calls := 0
	var worst_prims := 0
	for id in Rooms.LIST:
		var r: Array = Rooms.LIST[id].r
		game.player.global_position = Vector3((r[0] + r[1]) * 0.5, 0.0, (r[2] + r[3]) * 0.5)
		game.player.yaw = 0.0
		for i in range(10):
			await process_frame
		for yaw in [0.0, 90.0, 180.0, 270.0]:
			game.player.yaw = deg_to_rad(yaw)
			await process_frame
			await process_frame
			var calls := int(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME))
			var prims := int(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME))
			worst_calls = maxi(worst_calls, calls)
			worst_prims = maxi(worst_prims, prims)
			if calls > MAX_DRAW_CALLS or prims > MAX_PRIMITIVES:
				print("    %s facing %d: %d draw calls, %d primitives" % [id, yaw, calls, prims])
		check(game.world.loaded.size() <= MAX_ROOMS_LOADED, "%s: %d rooms loaded at once" % [id, game.world.loaded.size()])
	print("  worst frame: %d draw calls, %d primitives" % [worst_calls, worst_prims])
	check(worst_calls <= MAX_DRAW_CALLS, "no view needs more than %d draw calls (worst %d)" % [MAX_DRAW_CALLS, worst_calls])
	check(worst_prims <= MAX_PRIMITIVES, "no view needs more than %d primitives (worst %d)" % [MAX_PRIMITIVES, worst_prims])
	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
