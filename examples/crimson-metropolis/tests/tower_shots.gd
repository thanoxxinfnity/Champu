extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1280x720 -s tests/tower_shots.gd -- <out_dir>
## The tower from the street, its lobby, the executive floor, the penthouse and the roof.

func _init() -> void:
	var out_dir: String = OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp/cm"
	DirAccess.make_dir_recursive_absolute(out_dir)
	var world := World.new()
	root.add_child(world)
	await process_frame
	await process_frame
	world.atmosphere.clock_running = false
	world.atmosphere.set_hour(12.0)
	var o := world.tower.global_position
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.make_current()
	cam.fov = 60.0
	cam.far = 800.0
	var views := [
		["tower_street", Vector3(0, 3, 60), Vector3(0, 40, 0)],
		["tower_far", Vector3(90, 30, 150), Vector3(0, 55, 0)],
		["tower_lobby", Vector3(-8, 2.2, 14), Vector3(2, 2.5, -8)],
		["tower_lobby2", Vector3(10, 2.2, -8), Vector3(-6, 2.0, 8)],
		["tower_exec", Vector3(-9, 47.76 + 1.8, 12), Vector3(3, 47.76 + 1.2, -6)],
		["tower_pent", Vector3(-9, 95.36 + 1.8, 12), Vector3(3, 95.36 + 1.2, -6)],
		["tower_roof", Vector3(-10, 102.16 + 2.5, 12), Vector3(2, 102.16 + 0.5, -4)],
	]
	for v in views:
		cam.global_position = o + v[1]
		cam.look_at(o + v[2], Vector3.UP)
		for i in range(5):
			await process_frame
		root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out_dir, v[0]])
		print("saved ", v[0])
	quit()
