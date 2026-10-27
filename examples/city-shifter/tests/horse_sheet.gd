extends SceneTree
## A contact sheet of the horse: rest pose and the gaits at several stride phases, seen from the side (the horse faces to the right).
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/horse_sheet.gd -- /tmp/horse.png

func _initialize() -> void:
	await process_frame
	var out := OS.get_cmdline_user_args()[0]
	root.size = Vector2i(1800, 900)
	var w := Node3D.new()
	root.add_child(w)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.75, 0.86, 1.0)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.9, 0.9, 0.95)
	env.ambient_light_energy = 0.8
	var we := WorldEnvironment.new()
	we.environment = env
	w.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -60, 0)
	w.add_child(sun)
	var panels := [["rest", 0.0, false, 0.0], ["walk .0", 1.8, false, 0.0], ["walk .5", 1.8, false, 0.5], ["trot .0", 5.2, false, 0.0], ["trot .5", 5.2, false, 0.5],
		["gallop .0", 11.0, false, 0.0], ["gallop .3", 11.0, false, 0.3], ["gallop .6", 11.0, false, 0.6], ["jump", 6.0, true, 0.0]]
	var cols := 3
	for i in panels.size():
		var h := ModelKit.fitted(Horse.MODEL, 2.4, "bottom")
		var holder := Node3D.new()
		holder.position = Vector3(0, -float(i / cols) * 3.2, -float(i % cols) * 3.6)
		w.add_child(holder)
		holder.add_child(h)
		var rig := HorseRig.new()
		var sk := h.find_children("*", "Skeleton3D", true, false)
		if sk.is_empty() or not rig.setup(sk[0]):
			print("no skeleton for ", panels[i][0])
			continue
		var p: Array = panels[i]
		for k in 90:
			rig.update(1.0 / 30.0, float(p[1]), bool(p[2]), 0.0)
		rig.phase = float(p[3])
		rig.update(0.0, float(p[1]), bool(p[2]), 0.0)
		holder.position.y += rig.bob
		var l := Label3D.new()
		l.text = String(p[0])
		l.font_size = 96
		l.pixel_size = 0.004
		l.position = Vector3(0, 2.7, 0)
		l.rotation_degrees = Vector3(0, 90, 0)
		holder.add_child(l)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 10.5
	w.add_child(cam)
	cam.position = Vector3(12, -2.6, -3.6)
	cam.rotation_degrees = Vector3(0, 90, 0)
	cam.make_current()
	for i in 4:
		await process_frame
	root.get_texture().get_image().save_png(out)
	print("sheet -> ", out)
	quit()
