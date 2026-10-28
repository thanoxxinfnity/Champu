extends SceneTree
## Every clip of the animation library on one hero, four moments each, front and side: to look at before a clip goes in the game.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/clip_shots.gd -- /tmp/out [hero] [clip,clip,...]
func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/cs"
	var hero := args[1] if args.size() > 1 else "kafu"
	var names: Array = []
	if args.size() > 2:
		names = Array(args[2].split(","))
	else:
		for f in DirAccess.get_files_at("res://assets/anim/ual"):
			if f.ends_with(".json"):
				names.append(f.get_basename())
	DirAccess.make_dir_recursive_absolute(out)
	DisplayServer.window_set_size(Vector2i(1600, 400))
	root.size = Vector2i(1600, 400)
	var w := Node3D.new()
	root.add_child(w)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.62, 0.7, 0.82)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.9, 0.9, 1.0)
	var we := WorldEnvironment.new()
	we.environment = env
	w.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -30, 0)
	w.add_child(sun)
	var avs: Array = []
	for i in 8:
		var a := Avatar.new()
		w.add_child(a)
		a.setup(hero)
		a.position = Vector3(float(i) * 1.15 - 4.0, 0, 0)
		a.rotation.y = PI if i < 4 else -PI * 0.5          # four from the front, the same four from the side
		avs.append(a)
	var cam := Camera3D.new()
	w.add_child(cam)
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 2.3
	cam.position = Vector3(0, 0.95, 9.0)
	cam.current = true
	for n in names:
		var c := AnimClip.load_clip("ual/" + n)
		if c == null:
			continue
		for i in 8:
			var a: Avatar = avs[i]
			a.play_clip("ual/" + n, 99.0)
			a.clip_t = c.duration() * float(i % 4) / 4.0
		for k in 3:
			for i in 8:
				(avs[i] as Avatar).clip_t -= get_root().get_process_delta_time()
			await process_frame
		root.get_texture().get_image().save_png("%s/%s.png" % [out, n])
	print("CLIP_SHOTS ", names.size())
	quit()
