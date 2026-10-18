extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1600x900 -s tests/island_shots.gd -- <out_dir>
func _init() -> void:
	var out_dir: String = OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp/cm"
	var world := World.new()
	world.map = "island"
	world.with_life = false
	root.add_child(world)
	await process_frame
	await process_frame
	world.atmosphere.clock_running = false
	world.atmosphere.set_hour(16.0)
	var isl := world.island
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.make_current()
	cam.fov = 62.0
	cam.far = 4000.0
	var views := [
		["isl_aerial", Vector3(0, 1500, 1500), Vector3(0, 0, 0)],
		["isl_town", Vector3(40, 30, 90), Vector3(0, 12, 0)],
		["isl_factory", Vector3(250, 22, 190), Vector3(320, 10, 90)],
		["isl_peak", Vector3(150, 120, -260), Vector3(280, 150, -430)],
		["isl_mill", Vector3(-280, 22, 230), Vector3(-330, 10, 150)],
		["isl_ship", Vector3(-30, 24, 520), Vector3(40, 10, 600)],
	]
	for v in views:
		var pos: Vector3 = v[1]
		if v[0] != "isl_aerial":
			pos.y = max(pos.y, isl.height_at(pos.x, pos.z) + 6.0)
		cam.global_position = pos
		cam.look_at(v[2], Vector3.UP)
		for i in range(6):
			await process_frame
		root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out_dir, v[0]])
		print("saved ", v[0], " trees ", isl.trees)
	quit()
