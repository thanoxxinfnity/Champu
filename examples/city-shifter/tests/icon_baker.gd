extends SceneTree
## Bakes a drawn icon of every weapon (the real model, toon shaded with the ink outline, seen from a three-quarter angle) into assets/ui/weapons/<id>.png
## for the HUD strip. Needs a renderer:  xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/icon_baker.gd

func _initialize() -> void:
	var ids: Array = Data.WEAPON_ORDER.duplicate()
	ids.append_array(Data.MELEE_ORDER)
	DirAccess.make_dir_recursive_absolute("res://assets/ui/weapons")
	await process_frame
	for id in ids:
		var path := "res://assets/weapons/%s.glb" % id
		if not ResourceLoader.exists(path):
			print("no model for ", id)
			continue
		var vp := SubViewport.new()
		vp.size = Vector2i(192, 192)
		vp.transparent_bg = true
		vp.own_world_3d = true
		vp.msaa_3d = Viewport.MSAA_4X
		vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		root.add_child(vp)
		var env := Environment.new()
		env.background_mode = Environment.BG_CLEAR_COLOR
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = Color(0.85, 0.85, 0.95)
		env.ambient_light_energy = 0.9
		var we := WorldEnvironment.new()
		we.environment = env
		vp.add_child(we)
		var sun := DirectionalLight3D.new()
		sun.rotation_degrees = Vector3(-40, -35, 0)
		sun.light_energy = 1.2
		vp.add_child(sun)
		var holder := Node3D.new()
		vp.add_child(holder)
		var m := ModelKit.fitted(path, 1.0, "center")
		holder.add_child(m)
		holder.rotation_degrees = Vector3(14, 215, -8)
		Anime.style(m, true, 0.03)
		var cam := Camera3D.new()
		cam.projection = Camera3D.PROJECTION_ORTHOGONAL
		cam.size = 1.22
		cam.position = Vector3(0, 0, 2.0)
		vp.add_child(cam)
		cam.make_current()
		for i in 6:
			await process_frame
		var img := vp.get_texture().get_image()
		img.save_png("res://assets/ui/weapons/%s.png" % id)
		print("icon ", id)
		vp.queue_free()
		await process_frame
	quit()
