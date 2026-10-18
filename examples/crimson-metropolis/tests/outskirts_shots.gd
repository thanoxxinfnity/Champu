extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1600x900 -s tests/outskirts_shots.gd -- <out_dir>
func _init() -> void:
	var out_dir: String = OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp/cm"
	var world := World.new()
	world.with_life = false
	root.add_child(world)
	await process_frame
	await process_frame
	world.atmosphere.clock_running = false
	world.atmosphere.set_hour(16.5)
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.make_current()
	cam.fov = 62.0
	cam.far = 3000.0
	var views := [
		["out_beach", Vector3(-60, 6, 300), Vector3(10, 8, 470)],
		["out_pier", Vector3(30, 14, 380), Vector3(0, 18, 520)],
		["out_hills", Vector3(0, 30, -120), Vector3(-30, 60, -900)],
		["out_aerial", Vector3(-250, 160, 80), Vector3(60, 10, 300)],
	]
	for v in views:
		cam.global_position = v[1]
		cam.look_at(v[2], Vector3.UP)
		for i in range(6):
			await process_frame
		root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out_dir, v[0]])
		print("saved ", v[0])
	quit()
