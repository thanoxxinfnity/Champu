extends SceneTree
## xvfb-run -a godot --rendering-driver opengl3 --resolution 3600x800 --path . -s tests/pose_shots.gd -- gojo_free
## Contact sheet of fighting poses (front + side) to check the pose table against the real rig.

func _init() -> void:
	var which := "gojo_free"
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		which = args[0]
	var path := "res://assets/characters/%s.glb" % which
	var poses := [["stance", PoseLib.stance(0.0)], ["walk", PoseLib.walk(0.3, 1.0)], ["jab", PoseLib.attack("light1", 1, 1.0)],
		["hook", PoseLib.attack("light2", 1, 1.0)], ["kick", PoseLib.attack("heavy", 1, 1.0)], ["cast", PoseLib.attack("special", 1, 1.0)],
		["block", PoseLib.block()], ["hit", PoseLib.hit(0.0)], ["ko", PoseLib.ko(1.0)], ["hover", PoseLib.fly_hover(0.0)], ["fly", PoseLib.fly_fast(0.0)], ["sign", PoseLib.gojo_sign()]]
	var world := Node3D.new()
	root.add_child(world)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.45, 0.47, 0.52)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(0.7, 0.7, 0.75)
	world.add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -30, 0)
	world.add_child(sun)
	var n := poses.size()
	var rigs: Array[RigAnimator] = []
	for i in n:
		var a := RigAnimator.new()
		world.add_child(a)
		if not a.load_model(path):
			push_error("model failed")
			quit(1)
			return
		a.curl_fists = which == "meguna"
		a.set_fists(poses[i][0] != "sign")
		var bp := PoseLib.build(poses[i][1])
		if poses[i][1].has("curl"):
			bp["curl"] = poses[i][1]["curl"]
		a.apply(bp)
		rigs.append(a)
	var cam := Camera3D.new()
	world.add_child(cam)
	cam.current = true
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.keep_aspect = Camera3D.KEEP_WIDTH      # run with --resolution 3600x800 to see all poses side by side
	cam.size = n * 1.5
	await process_frame
	for view in ["front", "side"]:
		for i in n:
			var off := (i - (n - 1) / 2.0) * 1.5
			rigs[i].position = Vector3(off, 0, 0) if view == "front" else Vector3(0, 0, -off)
		if view == "front":
			cam.look_at_from_position(Vector3(0, 1.0, -8.0), Vector3(0, 1.0, 0))
		else:
			cam.look_at_from_position(Vector3(8.0, 1.0, 0), Vector3(0, 1.0, 0))
		await process_frame
		await process_frame
		await process_frame
		root.get_viewport().get_texture().get_image().save_png("/tmp/cm/poses_%s_%s.png" % [which, view])
	quit()
