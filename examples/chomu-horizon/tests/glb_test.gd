extends SceneTree
## Round-trip every car through .glb (export → load_glb_car → validate) and
## load a single-mesh generator output. Also refreshes res://models/*.glb.
## Run: godot --headless --path . -s tests/glb_test.gd -- [trellis.glb]

func _initialize() -> void:
	var fails: Array[String] = []
	var out_dir := ProjectSettings.globalize_path("res://models")
	DirAccess.make_dir_recursive_absolute(out_dir)
	for i in CarCatalog.count():
		var car := CarCatalog.get_car(i)
		var built := CarBuilder.build(car)
		root.add_child(built)
		var path := out_dir.path_join(car.id + ".glb")
		var err := CarBuilder.export_glb(built, path)
		var size := FileAccess.get_file_as_bytes(path).size()
		var back := CarBuilder.load_glb_car(path, car)
		root.add_child(back)
		var missing := CarBuilder.validate(back)
		var doors := back.get_node_or_null("Door_L") != null and back.get_node_or_null("Door_R") != null
		var painted := false
		for n in back.get_node("Body").find_children("*", "MeshInstance3D", true, false) + [back.get_node("Body")]:
			if n is MeshInstance3D:
				for s in (n as MeshInstance3D).get_surface_override_material_count():
					if (n as MeshInstance3D).get_surface_override_material(s) == back.get_meta("paint_material"):
						painted = true
		print("%s export=%d %d KB missing=%s doors=%s paint_live=%s" % [car.id, err, size / 1024, missing, doors, painted])
		if err != OK or not missing.is_empty() or not doors or not painted:
			fails.append(car.id)
	var args := OS.get_cmdline_user_args()
	if args.size() > 0 and FileAccess.file_exists(args[0]):
		var gen := CarBuilder.load_glb_car(args[0], CarCatalog.get_car(0))
		root.add_child(gen)
		var miss := CarBuilder.validate(gen)
		print("single-mesh glb missing=", miss)
		if not miss.is_empty():
			fails.append("single-mesh")
	print("FAILS: ", fails)
	quit()
