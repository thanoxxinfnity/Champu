extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/shots.gd -- <out_dir> [hour weather yaw pitch name ...]
## Looks at the world the way a player would: at the spawn point, at several times of day and in the rain.

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var out_dir: String = args[0] if args.size() > 0 else "/tmp/cm"
	DirAccess.make_dir_recursive_absolute(out_dir)
	var world := World.new()
	root.add_child(world)
	await process_frame
	await process_frame
	var shots := [
		[10.0, &"clear", 0.0, -0.12, "noon"],
		[18.6, &"clear", 0.5, -0.1, "sunset"],
		[23.0, &"clear", 0.0, -0.1, "night"],
		[14.0, &"rain", 0.0, -0.1, "rain"],
	]
	for s in shots:
		world.atmosphere.clock_running = false
		world.atmosphere.set_weather(s[1])
		world.atmosphere.rain_amount = 1.0 if s[1] == &"rain" else 0.0
		world.atmosphere.set_hour(s[0])
		world.player.yaw = s[2]
		world.player.pitch = s[3]
		for i in range(8):
			await process_frame
		root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out_dir, s[4]])
		print("saved ", s[4])
	quit()
