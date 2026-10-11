extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/handshot.gd -- <out.png> <model> [clip ...]
## Close-ups of the right hand through some clips: the fingers are bones, so a fist and an open hand look different.

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var out: String = args[0]
	var model: String = args[1]
	var clips: Array = Array(args.slice(2)) if args.size() > 2 else ["idle", "stomp", "recoil", "scream"]
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.13, 0.14, 0.17)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.7, 0.72, 0.76)
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -30, 0)
	root.add_child(sun)
	var i := 0
	var imgs: Array[Image] = []
	for c in clips:
		var m := Rig.make(model, 3.0)
		root.add_child(m)
		var player := m.get_meta("anim") as AnimationPlayer
		player.play(c)
		player.seek(0.3 * player.current_animation_length, true)
		player.pause()
		var sk := m.get_meta("skeleton") as Skeleton3D
		for k in range(3):
			await process_frame
		var hand := (sk.global_transform * sk.get_bone_global_pose(sk.find_bone("handR"))).origin
		var cam := Camera3D.new()
		root.add_child(cam)
		cam.fov = 30.0
		cam.look_at_from_position(hand + Vector3(0.0, 0.3, 1.5), hand, Vector3.UP)
		cam.make_current()
		for k in range(10):
			await process_frame
		var im := root.get_viewport().get_texture().get_image()
		im.convert(Image.FORMAT_RGB8)
		imgs.append(im)
		cam.queue_free()
		m.queue_free()
		await process_frame
	var w := imgs[0].get_width() / 2
	var h := imgs[0].get_height()
	var sheet := Image.create(w * imgs.size(), h, false, Image.FORMAT_RGB8)
	for k in range(imgs.size()):
		sheet.blit_rect(imgs[k], Rect2i(w / 2, 0, w, h), Vector2i(k * w, 0))
	sheet.save_png(out)
	print("saved ", out)
	quit()
