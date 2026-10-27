extends SceneTree
## Match screenshots under xvfb: the loot on the ground, the HUD with weapon slots, a fight, the scoreboard.
##   xvfb-run -a godot --rendering-driver opengl3 --fixed-fps 30 --path . -s tests/match_shots.gd -- /tmp/out

var out := "/tmp/ms"


func snap(name: String, frames := 20) -> void:
	for i in frames:
		await physics_frame
		await process_frame
	root.get_texture().get_image().save_png("%s/%s.png" % [out, name])
	print("shot ", name, "  draw calls ", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), "  tris ", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME))


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1280, 720)
	var game: Main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	game.mode = "world"
	game.match_type = "team"
	root.add_child(game)
	await process_frame
	game.start_play()
	var mc: MatchController = game.mc
	var p := game.player
	await snap("m0_start", 40)
	# stand among weapons: the town has the most
	var best := Vector3.ZERO
	var best_n := 0
	for u in mc.loot.items:
		var c: Vector3 = mc.loot.items[u].pos
		var n := 0
		for v in mc.loot.items:
			if (mc.loot.items[v].pos as Vector3).distance_to(c) < 12.0:
				n += 1
		if n > best_n:
			best_n = n
			best = c
	print("densest spot ", best, " with ", best_n)
	p.global_position = best + Vector3(0, 0.5, 6)
	p.yaw = 0.0
	await snap("m1_loot", 30)
	# take a few
	for k in 3:
		var u := mc.loot.nearest(p.global_position, 14.0)
		if u >= 0:
			p.global_position = mc.loot.items[u].pos + Vector3(0, 0.3, 0)
			await snap("m2_pick%d" % k, 12)
	# a fight: two bots of another team in front
	var foes := Combat.enemies(p)
	for i in 3:
		var f: PlayerController = foes[i]
		f.global_position = p.global_position + Vector3(-6 + i * 6, 0.3, -14)
		f.velocity = Vector3.ZERO
	p.yaw = 0.0
	p.tool.equip(p.tool.inventory[p.tool.inventory.size() - 1])
	await snap("m3_fight", 20)
	for k in 4:
		p.tool.cd_left = 0.0
		p.tool.fire()
		await snap("m4_shot%d" % k, 6)
	game.hud.show_board = true
	await snap("m5_board", 5)
	game.hud.show_board = false
	mc.time_left = 0.2
	await snap("m6_results", 40)
	quit()
