extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1280x720 -s tests/stationshot.gd -- <dir>
## One picture of each safe station: the pool, the lamp, the pipe and the charger.

func _init() -> void:
	var out := "/tmp/stations"
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	var game := (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	Game.autostart = true
	root.add_child(game)
	for i in range(40):
		await process_frame
	game.ui.close_modal()
	game.player.torch_on = true
	for st in Safe.STATIONS:
		var c := Vector3(float(st.x), 0.0, float(st.z))
		var r: Array = Rooms.LIST[st.room].r
		var cam := c + Vector3(-2.4, 0.0, 3.3)
		cam.x = clampf(cam.x, r[0] + 0.7, r[1] - 0.7)
		cam.z = clampf(cam.z, r[2] + 0.7, r[3] - 0.7)
		for k in range(90):
			game.player.global_position = cam
			game.player.velocity = Vector3.ZERO
			game.player.shield_t = 99.0
			var d := (c + Vector3(0.6, 0.6, 0.0)) - (cam + Vector3(0, 1.6, 0))
			game.player.yaw = atan2(-d.x, -d.z)
			game.player.pitch = atan2(d.y, Vector2(d.x, d.z).length())
			await process_frame
			for e in game.enemies:
				e.process_mode = Node.PROCESS_MODE_DISABLED
		root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, st.id])
		print("saved ", st.id, " in ", game.world.current)
	quit()
