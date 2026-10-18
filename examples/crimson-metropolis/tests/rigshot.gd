extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/rigshot.gd -- <out.png> [clip ...]
## The protagonist's rig, posed through each locomotion/action clip, side by side.

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var out: String = args[0] if args.size() > 0 else "/tmp/rig/rig.png"
	var clips: Array = Array(args.slice(1)) if args.size() > 1 else ["idle", "walk", "run", "jump", "push_door", "aim_rifle", "sleep"]
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
		var m := Rig.make_character(1.8)
		if m == null:
			print("no rig")
			quit(1)
			return
		m.position = Vector3(i * 2.4, 0, 0)
		m.rotation_degrees.y = 200.0
		root.add_child(m)
		var label := Label.new()
		label.text = c
		label.position = Vector2(i * 290 + 20, 660)
		label.add_theme_font_size_override("font_size", 22)
		var canvas := CanvasLayer.new()
		canvas.add_child(label)
		root.add_child(canvas)
		var anim: AnimationPlayer = m.get_meta("anim")
		anim.play(c)
		anim.seek(anim.get_animation(c).length * 0.5, true)
		i += 1
	var cam := Camera3D.new()
	cam.position = Vector3(i * 1.2, 2.0, 5.0)
	cam.look_at(Vector3(i * 1.2, 1.0, 0), Vector3.UP)
	root.add_child(cam)
	cam.make_current()
	await process_frame
	await process_frame
	await process_frame
	root.get_viewport().get_texture().get_image().save_png(out)
	print("saved ", out)
	quit()
