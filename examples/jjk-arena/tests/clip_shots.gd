extends SceneTree
## xvfb-run -a godot --rendering-driver opengl3 --resolution 2400x420 --path . -s tests/clip_shots.gd -- gojo_free fly_fast_side
## Samples a video-derived clip at 8 moments, front and side, on the real rig -> /tmp/cm/clip_<name>_{front,side}.png

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var which: String = args[0]
	var clip := AnimClip.load_clip(args[1])
	if clip == null:
		push_error("no clip")
		quit(1)
		return
	var world := Node3D.new()
	root.add_child(world)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.45, 0.47, 0.52)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(0.8, 0.8, 0.85)
	world.add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -30, 0)
	world.add_child(sun)
	var n := 8
	var rigs: Array[RigAnimator] = []
	for i in n:
		var a := RigAnimator.new()
		world.add_child(a)
		a.load_model("res://assets/characters/%s.glb" % which)
		a.set_fists(true)
		a.apply(PoseLib.build(clip.sample(clip.duration() * i / n, false)))
		rigs.append(a)
	var cam := Camera3D.new()
	world.add_child(cam)
	cam.current = true
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 2.6
	await process_frame
	for view in ["front", "side"]:
		for i in n:
			var off := (i - (n - 1) / 2.0) * 1.7
			rigs[i].position = Vector3(off, 0, 0) if view == "front" else Vector3(0, 0, -off)
		if view == "front":
			cam.look_at_from_position(Vector3(0, 1.0, -8.0), Vector3(0, 1.0, 0))
		else:
			cam.look_at_from_position(Vector3(8.0, 1.0, 0), Vector3(0, 1.0, 0))
		for k in 3:
			await process_frame
		root.get_viewport().get_texture().get_image().save_png("/tmp/cm/clip_%s_%s.png" % [args[1], view])
	quit()
