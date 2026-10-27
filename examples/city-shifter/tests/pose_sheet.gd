extends SceneTree
## A contact sheet of heroes in their game poses (idle, walk, run, jet, fall, swing), front 3/4 view:  xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/pose_sheet.gd -- out.png id id ...

func _initialize() -> void:
	await process_frame
	var args := OS.get_cmdline_user_args()
	var out: String = args[0]
	var ids: Array = args.slice(1)
	var poses: Array = Array(OS.get_environment("POSES").split(",")) if OS.get_environment("POSES") != "" else ["idle", "walk", "run", "jet", "fall", "swing"]
	var cw := 300
	var ch := 460
	var vp := SubViewport.new()
	vp.size = Vector2i(cw * poses.size(), ch * ids.size())
	vp.own_world_3d = true
	vp.transparent_bg = false
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.45, 0.4, 0.7)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.85, 0.8, 0.95)
	env.ambient_light_energy = 0.9
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-30, 145, 0)
	sun.light_energy = 1.3
	vp.add_child(sun)
	var cam := Camera3D.new()
	cam.fov = 20.0
	cam.position = Vector3(0, 0, -(float(ids.size() * ch) / 150.0) * 0.5 / tan(deg_to_rad(10.0)))
	vp.add_child(cam)
	cam.look_at(Vector3(0, 0, 0))
	cam.make_current()
	for r in ids.size():
		for c in poses.size():
			var av := Avatar.new()
			av.outline = true
			vp.add_child(av)
			av.setup(ids[r])
			av.position = Vector3(-float(c - poses.size() / 2.0 + 0.5) * (cw / 150.0), float(ids.size() / 2.0 - r - 0.5) * (ch / 150.0) - 0.92, 0)
			av.position.y -= 0.92 * 0.0
			av.rotation.y = 0.45
			match poses[c]:
				"walk":
					av.ground_speed = 2.0
				"run":
					av.ground_speed = 6.5
				"jet":
					av.jetting = true
					av.airborne = true
					av.thrust = 1.0
					av.ground_speed = 8.0
				"fall":
					av.airborne = true
				"swing":
					av.attack_t = 0.18
				_:
					if CMPoses.EMOTES.has(poses[c]):
						av.play_emote(poses[c], 99.0)
	for i in 50:
		await process_frame
	vp.get_texture().get_image().save_png(out)
	quit()
