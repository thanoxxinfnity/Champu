extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/viewer.gd -- <out.png> [name ...]
## The generated models in a line-up at the size they have in the game, to judge them by eye.

const SIZES := {
	"warden": 3.2, "crawler": 1.7, "hunter": 2.0, "skeleton": 1.7, "wiring": 0.25, "timer": 0.25, "gel": 0.35, "detonator": 0.25, "emp_stunner": 0.4, "mega_bomb": 0.8,
	"cryo_pod": 2.4, "server_rack": 2.2, "conveyor": 2.5, "reactor_core": 4.0, "ceiling_pipe": 3.0, "monitor": 0.6, "lab_table": 0.9, "forklift": 1.8,
	"fuse": 0.12, "keycard": 0.12, "battery": 0.18, "locker": 2.0, "generator": 1.5, "crate": 0.8, "barrel": 0.95, "pipes": 1.0, "terminal": 1.2, "desk": 0.8, "breaker_box": 1.0,
	"valve_wheel": 0.8, "toolbox": 0.28, "cart": 1.1, "lab_bench": 0.95, "radio": 0.25, "power_cell": 0.3, "chair": 0.95,
}


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var out: String = args[0] if args.size() > 0 else "/tmp/viewer.png"
	var names: Array = Array(args.slice(1)) if args.size() > 1 else SIZES.keys()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.12, 0.13, 0.15)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.58, 0.62)
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -25, 0)
	sun.light_energy = 1.3
	root.add_child(sun)
	var col := 0
	var row := 0
	for n in names:
		var m := Assets.make(n, SIZES.get(n, 1.0), n in ["conveyor", "ceiling_pipe", "forklift"])
		m.position = Vector3(col * 3.6, 0, -row * 4.2)
		root.add_child(m)
		var lbl := Label3D.new()
		lbl.text = "%s%s" % [n, " (stand-in)" if m.has_meta("stand_in") else ""]
		lbl.position = Vector3(col * 3.6, 0.02, -row * 4.2 + 1.8)
		lbl.rotation_degrees.x = -90
		lbl.pixel_size = 0.012
		root.add_child(lbl)
		col += 1
		if col >= 6:
			col = 0
			row += 1
	var cols := mini(6, names.size())
	var rows := (names.size() + 5) / 6
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.fov = 55.0
	var cx := (cols - 1) * 1.8
	var cz := -(rows - 1) * 2.1
	cam.look_at_from_position(Vector3(cx, 5.0 + rows * 1.6, cz + 9.0 + cols * 1.0), Vector3(cx, 1.0, cz), Vector3.UP)
	cam.make_current()
	for i in range(10):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(out)
	print("saved ", out)
	quit()
