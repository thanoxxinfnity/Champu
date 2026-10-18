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
		["isl_city", Vector3(-250, 40, 90), Vector3(-250, 35, -40)],
		["isl_jungle", Vector3(-380, 8, -330), Vector3(-380, 14, -440)],
		["isl_npcs", Vector3.ZERO, Vector3.ZERO],
		["isl_aerial", Vector3(0, 1100, 1100), Vector3(0, 0, 0)],
	]
	for v in views:
		var pos: Vector3 = v[1]
		var look: Vector3 = v[2]
		if v[0] == "isl_npcs":
			var n := isl.npcs[0]
			pos = n.global_position + Vector3(3.0, 2.0, 5.0)
			look = n.global_position + Vector3(0, 1.1, 0)
		if v[0] != "isl_aerial" and v[0] != "isl_npcs":
			pos.y = max(pos.y, isl.height_at(pos.x, pos.z) + 6.0)
		cam.global_position = pos
		cam.look_at(look, Vector3.UP)
		for i in range(6):
			await process_frame
		root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out_dir, v[0]])
		print("saved ", v[0], " trees ", isl.trees)
	quit()
