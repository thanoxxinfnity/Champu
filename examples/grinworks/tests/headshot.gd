extends SceneTree
func _init() -> void:
	var out: String = OS.get_cmdline_user_args()[0]
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.05, 0.05, 0.07)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.35, 0.36, 0.4)
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-20, -25, 0)
	sun.light_energy = 1.0
	root.add_child(sun)
	var m := Rig.make_grin(2.4)
	m.rotation_degrees.y = 180
	root.add_child(m)
	var player := m.get_meta("anim") as AnimationPlayer
	player.play("idle")
	player.seek(0.0, true)
	player.pause()
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.fov = 30.0
	cam.look_at_from_position(Vector3(0.5, 2.0, 2.6), Vector3(0, 1.95, 0), Vector3.UP)
	cam.make_current()
	for k in range(8):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(out)
	quit()
