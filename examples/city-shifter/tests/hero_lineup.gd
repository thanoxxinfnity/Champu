extends SceneTree
## Every hero from the front (and, with SIDE=1, from the side), big enough to see holes and cracks in the models.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/hero_lineup.gd -- /tmp/out
func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/lineup"
	DirAccess.make_dir_recursive_absolute(out)
	DisplayServer.window_set_size(Vector2i(1800, 1000))
	root.size = Vector2i(1800, 1000)
	var w := Node3D.new()
	root.add_child(w)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.55, 0.62, 0.72)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.9, 0.9, 1.0)
	var we := WorldEnvironment.new()
	we.environment = env
	w.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -30, 0)
	w.add_child(sun)
	var ids: Array = Data.CAST_ORDER
	var side := OS.get_environment("SIDE") == "1"
	for i in ids.size():
		var a := Avatar.new()
		w.add_child(a)
		a.outline = OS.get_environment("INK") == "1"
		a.setup(ids[i])
		a.position = Vector3(float(i % 9) * 1.0 - 4.0, 1.95 if i < 9 else 0.0, 0)
		a.rotation.y = -PI * 0.5 if side else PI
	var cam := Camera3D.new()
	w.add_child(cam)
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 4.6
	cam.position = Vector3(0, 1.85, 9.0)
	cam.current = true
	for k in 8:
		await process_frame
	root.get_texture().get_image().save_png("%s/lineup%s.png" % [out, "_side" if side else ""])
	print("LINEUP ", ids.size())
	quit()
