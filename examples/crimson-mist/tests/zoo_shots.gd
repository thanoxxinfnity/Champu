extends SceneTree
## A lineup of every creature in the bestiary, each in its own walking style, rendered from the front (xvfb, real renderer): the contact sheet is how the roster gets checked by eye.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/zoo_shots.gd -- /tmp/out

func _initialize() -> void:
	var out := OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp/cm/out/zoo"
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1600, 900)
	var world := Node3D.new()
	root.add_child(world)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.32, 0.36, 0.4)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.6, 0.66, 0.74)
	env.ambient_light_energy = 0.8
	var we := WorldEnvironment.new()
	we.environment = env
	world.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -25, 0)
	world.add_child(sun)
	var ids := Bestiary.ids()
	ids.append("bellkeeper")
	var cols := 9
	var spacing := 2.1
	var views: Array = []
	var missing := 0
	for i in ids.size():
		var id: String = ids[i]
		var d := Bestiary.def(id)
		var info: Array = Enemy.RIGS[id] if Enemy.RIGS.has(id) else [String(d.body), String(d.get("style", "zombie")), float(d.height)]
		var v := CharacterView.new()
		world.add_child(v)
		var ok := v.setup_model("res://assets/world/%s.glb" % info[0], minf(float(info[2]), 2.3 if id != "bellkeeper" else 3.4), d.tint, String(info[1]))
		if not ok:
			missing += 1
		var col := i % cols
		var row := i / cols
		v.position = Vector3((col - (cols - 1) * 0.5) * spacing, 0, -row * 3.2)
		v.rotation.y = PI
		v.pose = CharacterView.Pose.WALK
		v.ground_speed = 1.5
		views.append(v)
		var l := Label3D.new()
		l.text = "%s %s" % [String(d.name), "F" if Bestiary.sex_of(id) == "F" else "M"]
		l.font_size = 26
		l.pixel_size = 0.0085
		l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		l.position = v.position + Vector3(0, -0.12, 0.7)
		l.no_depth_test = true
		world.add_child(l)
	print("zoo: %d kinds, %d bodies missing (stand-ins)" % [ids.size(), missing])
	var cam := Camera3D.new()
	cam.fov = 40
	world.add_child(cam)
	cam.look_at_from_position(Vector3(0, 2.6, 11.5), Vector3(0, 1.0, -4.8))
	cam.make_current()
	for i in 40:
		await process_frame
	root.get_texture().get_image().save_png("%s/zoo_all.png" % out)
	print("saved zoo_all.png")
	quit()
