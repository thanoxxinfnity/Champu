extends SceneTree
## Every vehicle from the side (front to the right) with its tyres mounted.   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/vehicle_sheet.gd -- /tmp/v.png

func _initialize() -> void:
	await process_frame
	var out := OS.get_cmdline_user_args()[0]
	root.size = Vector2i(1800, 900)
	var w := Node3D.new()
	root.add_child(w)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.75, 0.86, 1.0)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.9, 0.9, 0.95)
	env.ambient_light_energy = 0.8
	var we := WorldEnvironment.new()
	we.environment = env
	w.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -60, 0)
	w.add_child(sun)
	var kinds: Array = []
	for k in Vehicle.SPEC:
		if Vehicle.available(k):
			kinds.append(k)
	var cols := 5
	for i in kinds.size():
		var v := Vehicle.new()
		w.add_child(v)
		v.setup(i, kinds[i])
		v.position = Vector3(0, -float(i / cols) * 6.0, -float(i % cols) * 12.0)
		var l := Label3D.new()
		l.text = String(kinds[i])
		l.font_size = 96
		l.pixel_size = 0.005
		l.position = v.position + Vector3(0, 4.6, 0)
		l.rotation_degrees = Vector3(0, 90, 0)
		w.add_child(l)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 30.0
	w.add_child(cam)
	cam.position = Vector3(40, -4.0, -24.0)
	cam.rotation_degrees = Vector3(0, 90, 0)
	cam.make_current()
	for i in 6:
		await process_frame
	root.get_texture().get_image().save_png(out)
	print("sheet ", kinds.size(), " -> ", out)
	quit()
