extends SceneTree
## A contact sheet of every glb in a folder, seen from the side (the camera looks along -X: the model's forward, -Z, points to the RIGHT, up is up).
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/model_sheet.gd -- res://assets/weapons /tmp/out.png

func _initialize() -> void:
	await process_frame
	var dir := OS.get_cmdline_user_args()[0]
	var out := OS.get_cmdline_user_args()[1]
	root.size = Vector2i(1600, 900)
	var names: Array = []
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".glb"):
			names.append(f)
	names.sort()
	var w := Node3D.new()
	root.add_child(w)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.55, 0.62, 0.72)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.9, 0.9, 0.95)
	env.ambient_light_energy = 0.9
	var we := WorldEnvironment.new()
	we.environment = env
	w.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -60, 0)
	w.add_child(sun)
	var cols := 5
	var spacing := 3.2
	for i in names.size():
		var sc := load("%s/%s" % [dir, names[i]]) as PackedScene
		if sc == null:
			continue
		var n := sc.instantiate() as Node3D
		var holder := Node3D.new()
		holder.position = Vector3(0, -float(i / cols) * spacing, -float(i % cols) * spacing)
		w.add_child(holder)
		holder.add_child(n)
		var bb := AABB()
		var first := true
		for mi in n.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			if m.mesh == null:
				continue
			var xf := Transform3D.IDENTITY
			var cur: Node = m
			while cur != null and cur != holder:
				if cur is Node3D:
					xf = (cur as Node3D).transform * xf
				cur = cur.get_parent()
			var b := xf * m.mesh.get_aabb()
			bb = b if first else bb.merge(b)
			first = false
		var k := 2.6 / maxf(maxf(bb.size.x, bb.size.y), maxf(bb.size.z, 0.001))
		n.scale = Vector3.ONE * k
		var c := bb.position + bb.size * 0.5
		n.position = -c * k
		var l := Label3D.new()
		l.text = String(names[i]).trim_suffix(".glb")
		l.font_size = 40
		l.pixel_size = 0.0045
		l.modulate = Color.BLACK
		l.position = holder.position + Vector3(0, -1.55, 0)
		l.rotation_degrees = Vector3(0, 90, 0)
		w.add_child(l)
	var rows := (names.size() + cols - 1) / cols
	var cam := Camera3D.new()
	cam.fov = 30.0
	cam.far = 500.0
	w.add_child(cam)
	cam.position = Vector3(float(cols) * spacing * 1.6, -float(rows - 1) * spacing * 0.5, -float(cols - 1) * spacing * 0.5)
	cam.look_at(Vector3(0, cam.position.y, cam.position.z))
	cam.make_current()
	for i in 12:
		await process_frame
	root.get_texture().get_image().save_png(out)
	print("sheet ", names.size(), " -> ", out)
	quit()
