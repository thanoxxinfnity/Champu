extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/rigshot.gd -- <out.png> [clip ...]
## Mr. Grin's rig, posed through each animation, side by side: the way to see the skinning.

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var out: String = args[0] if args.size() > 0 else "/tmp/rig/rig.png"
	var clips: Array = Array(args.slice(1)) if args.size() > 1 else ["idle", "walk", "stalk", "run", "recoil", "scream", "lunge", "peek"]
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.13, 0.14, 0.17)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.6, 0.62, 0.66)
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-30, -20, 0)
	sun.light_energy = 1.2
	root.add_child(sun)
	var i := 0
	for c in clips:
		var m := Rig.make_grin(2.4)
		if m == null:
			print("no rig")
			quit(1)
			return
		m.position = Vector3(i * 3.4, 0, 0)
		m.rotation_degrees.y = float(OS.get_environment("YAW") if OS.get_environment("YAW") != "" else "180")
		root.add_child(m)
		var player := m.get_meta("anim") as AnimationPlayer
		player.play(c)
		player.seek(float(OS.get_environment("T") if OS.get_environment("T") != "" else "0.27") * player.current_animation_length, true)
		player.pause()
		var lbl := Label3D.new()
		lbl.text = c
		lbl.position = Vector3(i * 3.4, 0.0, 1.3)
		lbl.rotation_degrees.x = -90
		lbl.pixel_size = 0.012
		root.add_child(lbl)
		i += 1
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.fov = 40.0
	var cx := (clips.size() - 1) * 1.7
	cam.look_at_from_position(Vector3(cx, 1.6, 8.0 + clips.size() * 0.25), Vector3(cx, 1.15, 0), Vector3.UP)
	cam.make_current()
	for k in range(8):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(out)
	print("saved ", out)
	quit()
