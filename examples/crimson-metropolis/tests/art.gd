extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1920x1080 -s tests/art.gd -- <out_dir>
## Key art for the loading screen: the city at golden hour.

func _init() -> void:
	var out_dir: String = OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp/cm"
	var world := World.new()
	root.add_child(world)
	await process_frame
	await process_frame
	for _i in range(60 * 3):
		await physics_frame
	world.atmosphere.clock_running = false
	world.atmosphere.set_hour(18.1)
	world.director.hud.visible = false
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.make_current()
	cam.fov = 48.0
	cam.far = 900.0
	var views := [
		["art_a", Vector3(46, 2.2, 90), Vector3(100, 60, -100)],
		["art_b", Vector3(52, 1.6, 140), Vector3(70, 45, -60)],
		["art_c", Vector3(-20, 3.0, 60), Vector3(100, 70, -100)],
	]
	for v in views:
		cam.global_position = v[1]
		cam.look_at(v[2], Vector3.UP)
		for i in range(8):
			await process_frame
		root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out_dir, v[0]])
		print("saved ", v[0])
	quit()
