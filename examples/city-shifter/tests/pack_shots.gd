extends SceneTree
## Every hero seen from the side with the jetpack: how far the pack is from the back.   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/pack_shots.gd -- /tmp/out
func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/pk"
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1800, 480)
	var w := Node3D.new()
	root.add_child(w)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.6, 0.7, 0.85)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.9, 0.9, 1.0)
	var we := WorldEnvironment.new()
	we.environment = env
	w.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -30, 0)
	w.add_child(sun)
	var ids: Array = Data.CAST_ORDER
	for i in ids.size():
		var a := Avatar.new()
		w.add_child(a)
		a.setup(ids[i])
		a.position = Vector3(float(i % 9) * 1.35 - 5.4, 0, 0)
		a.visible = (i < 9) == (OS.get_environment("ROW") != "2")
		a.rotation.y = -PI * 0.5                     # seen from the side: the front points to the left of the picture... (-Z turned to -X)
	var cam := Camera3D.new()
	w.add_child(cam)
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 3.2
	cam.position = Vector3(0, 1.2, 9.0)
	cam.look_at(Vector3(0, 1.2, 0))
	cam.current = true
	for k in 6:
		await process_frame
	root.get_texture().get_image().save_png("%s/packs%s.png" % [out, OS.get_environment("ROW")])
	quit()
