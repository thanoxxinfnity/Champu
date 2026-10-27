extends SceneTree
## Bakes a portrait of every hero (the real rigged model, toon shaded with the ink outline, three-quarter view, lit like a key visual) into assets/ui/cards/<id>.png
## (bust, for the battle cards) and assets/ui/full/<id>.png (whole body, for the shop and the lobby list).
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/portrait_baker.gd [-- id]

func _bake(id: String, bust: bool) -> void:
	var vp := SubViewport.new()
	vp.size = Vector2i(480, 560) if bust else Vector2i(360, 640)
	vp.transparent_bg = true
	vp.own_world_3d = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.82, 0.8, 0.95)
	env.ambient_light_energy = 0.85
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-28, 145, 0)
	sun.light_color = Color(1.0, 0.93, 0.84)
	sun.light_energy = 1.35
	vp.add_child(sun)
	var rim := OmniLight3D.new()
	rim.position = Vector3(-1.6, 1.8, 1.4)
	rim.light_color = Color(1.0, 0.55, 0.85)
	rim.light_energy = 2.0
	rim.omni_range = 6.0
	vp.add_child(rim)
	var rim2 := OmniLight3D.new()
	rim2.position = Vector3(1.8, 1.4, 1.2)
	rim2.light_color = Color(0.5, 0.8, 1.0)
	rim2.light_energy = 1.6
	rim2.omni_range = 6.0
	vp.add_child(rim2)
	var av := Avatar.new()
	av.outline = true
	vp.add_child(av)
	av.setup(id)
	av.rotation.y = 0.45
	if bust and av.get("_pack") != null:
		(av.get("_pack") as Node3D).visible = false
	var h := av.height
	var cam := Camera3D.new()
	cam.fov = 26.0
	vp.add_child(cam)
	if bust:
		cam.position = Vector3(0.0, h * 0.74, -h * 2.15)
		cam.look_at(Vector3(0.0, h * 0.74, 0.0))
	else:
		cam.position = Vector3(0.0, h * 0.5, -h * 3.1)
		cam.look_at(Vector3(0.0, h * 0.5, 0.0))
	cam.make_current()
	for i in 14:
		await process_frame
	var dir := "res://assets/ui/cards" if bust else "res://assets/ui/full"
	DirAccess.make_dir_recursive_absolute(dir)
	vp.get_texture().get_image().save_png("%s/%s.png" % [dir, id])
	vp.queue_free()
	await process_frame


func _initialize() -> void:
	await process_frame
	var only := OS.get_cmdline_user_args()
	for id in Data.CAST_ORDER:
		if only.size() > 0 and only[0] != id:
			continue
		await _bake(id, true)
		await _bake(id, false)
		print("portrait ", id)
	quit()
