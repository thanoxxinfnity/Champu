extends SceneTree
## Lays the character and gun models out in a row and photographs them from the
## front, back and side, to check which way each model faces.
##   xvfb-run godot --path . --rendering-driver opengl3 -s tests/viewer.gd -- <out_dir> [yaw_deg]

var frame := 0
var out := "user://view"
var cam: Camera3D
var shots := [["front", 180.0], ["three_quarter", 150.0]]
var step := 0
var dist := 15.0
var walk := false
var guns_only := false
var names := ["player", "zombie_walker", "zombie_runner", "zombie_cop", "zombie_nurse", "zombie_bloater", "boss_warden"]


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	if args.size() > 1 and args[1] == "guns":
		guns_only = true
	elif args.size() > 1:
		names = (args[1] as String).split(",")
		dist = 6.0 + 2.0 * names.size() if names.size() > 3 else 3.4 + 1.1 * names.size()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.25, 0.27, 0.3)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.7, 0.7, 0.75)
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-30, 25, 0)
	root.add_child(sun)
	if guns_only:
		names = []
		dist = 3.2
	var gap := 3.0 if names.size() > 3 else 1.25
	var x := -0.5 * gap * float(names.size() - 1)
	for n in names:
		var h: float = Data.MODELS[n].h
		var m := Assets.make(n, h, false, true)
		m.position = Vector3(x, 0, 0)
		root.add_child(m)
		for pm in m.get_meta("puppet_mats", []):
			var sm := pm as ShaderMaterial
			sm.set_shader_parameter("arms_up", 1.0 if "reach" in OS.get_cmdline_user_args() else 0.0)
			sm.set_shader_parameter("speed", 0.8 if "walk" in OS.get_cmdline_user_args() else 0.0)
			sm.set_shader_parameter("phase", 1.2)
			sm.set_shader_parameter("lean", 0.4)
		x += gap
		if names.size() < 3:
			pass
	for g in ([] if names.size() < 4 and not guns_only else ["gun_pistol", "gun_shotgun", "gun_smg", "gun_rifle"]):
		var m := Assets.make(g, Data.MODELS[g].len, true)
		var gi := float(["gun_pistol", "gun_shotgun", "gun_smg", "gun_rifle"].find(g))
		m.position = Vector3(-4.5 + gi * 3.0, 3.2, 0)
		if guns_only:
			# Stacked in a column so a side-on camera sees every barrel at once.
			m.position = Vector3(0, 0.4 + gi * 0.55, 0)
			m.scale = Vector3.ONE * 1.0
		root.add_child(m)
	cam = Camera3D.new()
	cam.fov = 40.0
	root.add_child(cam)


func _process(_d: float) -> bool:
	frame += 1
	if frame % 12 == 0 and frame > 2 and step < shots.size():
		var yaw: float = shots[step][1]
		cam.position = Vector3(0, 1.9, 0) + Vector3(sin(deg_to_rad(yaw)), 0, cos(deg_to_rad(yaw))) * dist
		cam.look_at(Vector3(0, 1.1 if guns_only else 1.7, 0))
	if frame % 12 == 8 and frame > 10 and step < shots.size():
		var img := root.get_viewport().get_texture().get_image()
		img.save_png("%s/%s.png" % [out, shots[step][0]])
		step += 1
	return step >= shots.size()
