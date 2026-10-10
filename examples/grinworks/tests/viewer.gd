extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/viewer.gd -- <out.png> [name ...]
## A line-up of the generated models at their in-game size, to judge them by eye.

const SIZES := {
	"teddy": 1.9, "blocks": 1.7, "robot_toy": 0.8, "rocking_horse": 1.1, "jack_box": 0.9, "toy_train": 1.0, "plush_bunny": 1.0, "toy_drum": 0.5, "delivery_truck": 1.2, "doll_house": 1.4, "xylophone": 0.5, "gift_box": 0.8, "toy_shelf": 2.0, "mascot_head": 2.3, "mr_grin": 2.4, "mr_grin_c": 2.4, "locker": 2.0, "crate": 0.8, "barrel": 0.95, "bunk_bed": 1.9, "desk": 0.8, "chair": 0.95, "terminal": 1.2, "generator": 1.5,
	"breaker_box": 1.0, "lab_bench": 0.95, "specimen_tank": 2.3, "diving_suit": 1.9, "gurney": 0.9, "oxygen_tank": 1.3, "toolbox": 0.28,
	"radio": 0.25, "keycard": 0.12, "fuse": 0.12, "power_cell": 0.3, "battery": 0.18, "escape_pod": 2.4, "pipes": 1.0, "valve_wheel": 0.8,
	"cart": 1.1, "submarine": 1.5, "hollow": 2.35,
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
	var x := 0.0
	var row := 0
	var col := 0
	for n in names:
		var size: float = SIZES.get(n, 2.35 if str(n).begins_with("hollow") else 1.0)
		var by_length: bool = n in ["escape_pod", "submarine", "gurney", "cart", "pipes"]
		var m := Assets.make(n, size, by_length, false)
		m.position = Vector3(col * 3.2, 0, -row * 3.2)
		root.add_child(m)
		var lbl := Label3D.new()
		lbl.text = "%s%s" % [n, " (stand-in)" if m.has_meta("stand_in") else ""]
		lbl.position = Vector3(col * 3.2, 0.02, -row * 3.2 + 1.4)
		lbl.rotation_degrees.x = -90
		lbl.pixel_size = 0.01
		root.add_child(lbl)
		col += 1
		if col >= 7:
			col = 0
			row += 1
	var cols := mini(7, names.size())
	var rows := (names.size() + 6) / 7
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.fov = 60.0
	var cx := (cols - 1) * 1.6
	var cz := -(rows - 1) * 1.6
	cam.look_at_from_position(Vector3(cx, 4.0 + rows * 1.6, cz + 7.5 + cols * 0.9), Vector3(cx, 0.9, cz), Vector3.UP)
	cam.make_current()
	for i in range(10):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(out)
	print("saved ", out)
	quit()
