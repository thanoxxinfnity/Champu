extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1280x720 -s tests/house_shots.gd -- <out_dir>
## The safehouse from above (roof and upper floor lifted off), and a few views from inside it.

func _init() -> void:
	var out_dir: String = OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp/cm"
	var world := World.new()
	root.add_child(world)
	await process_frame
	await process_frame
	world.atmosphere.clock_running = false
	world.atmosphere.set_hour(11.0)
	var h := world.safehouse
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.make_current()
	cam.fov = 50.0
	# 1. Plan view of the ground floor.
	for n in ["Roof", "UpperFloor", "UpperFloorA", "UpperFloorB"]:
		h.get_node(n).visible = false
	var o := h.global_position
	cam.global_position = o + Vector3(0, 46, 8.5)
	cam.look_at(o + Vector3(0, 0, 8.5), Vector3.FORWARD)
	for i in range(6):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(out_dir + "/house_plan.png")
	for n in ["Roof", "UpperFloor", "UpperFloorA", "UpperFloorB"]:
		h.get_node(n).visible = true
	# 2. Looking into the living room and the front of the house.
	var views := [
		["house_front", Vector3(0, 2.2, -16), Vector3(0, 2.5, 8)],
		["house_living", Vector3(4.2, 1.7, 1.2), Vector3(9.5, 1.2, 6.5)],
		["house_kitchen", Vector3(5.0, 1.8, 10.5), Vector3(8.5, 1.0, 16.5)],
		["house_hall", Vector3(0, 1.7, 0.8), Vector3(-1.5, 2.2, 12.0)],
	]
	for v in views:
		cam.global_position = o + v[1]
		cam.look_at(o + v[2], Vector3.UP)
		for i in range(4):
			await process_frame
		root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out_dir, v[0]])
		print("saved ", v[0])
	# 3. The bedroom upstairs.
	cam.global_position = o + Vector3(4.2, Safehouse.UPPER_Y + 1.8, 2.5)
	cam.look_at(o + Vector3(9.0, Safehouse.UPPER_Y + 0.6, 15.0), Vector3.UP)
	for i in range(4):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(out_dir + "/house_bedroom.png")
	print("saved house_bedroom")
	quit()
