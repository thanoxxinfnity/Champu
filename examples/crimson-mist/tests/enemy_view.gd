extends SceneTree
## Rigged enemy / NPC contact strips under xvfb: each body type in idle, walk, run, attack, hurt and death (4 moments each).
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/enemy_view.gd -- /tmp/out mist_walker

const POSES := [["idle", CharacterView.Pose.IDLE, 0.0], ["walk", CharacterView.Pose.WALK, 1.0], ["run", CharacterView.Pose.RUN, 3.0], ["attack", CharacterView.Pose.SWING, 0.0],
	["hurt", CharacterView.Pose.HURT, 0.0], ["death", CharacterView.Pose.DEAD, 0.0]]

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/cm/out"
	var kind := args[1] if args.size() > 1 else "mist_walker"
	root.size = Vector2i(1280, 720)
	var world := Node3D.new()
	root.add_child(world)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.3, 0.34, 0.37)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.62, 0.7)
	env.ambient_light_energy = 0.7
	var we := WorldEnvironment.new()
	we.environment = env
	world.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -30, 0)
	world.add_child(sun)
	var cam := Camera3D.new()
	cam.fov = 34
	world.add_child(cam)
	cam.look_at_from_position(Vector3(0, 1.3, 6.2), Vector3(0, 0.85, 0))
	cam.make_current()
	var info: Array = Enemy.RIGS.get(kind, ["npc_" + kind, "npc", 1.62])
	var path := "res://assets/world/%s.glb" % info[0]
	var v := CharacterView.new()
	world.add_child(v)
	var ok := v.setup_model(path, float(info[2]), Color(0.9, 0.9, 0.95), String(info[1]))
	print("model ", path, " loaded ", ok, " bones ", v.rig.skeleton.get_bone_count() if v.rig else 0)
	if not ok:
		quit()
		return
	v.rotation.y = PI + 0.5
	for p in POSES:
		v.pose = p[1]
		v.ground_speed = p[2]
		v.start_pose(p[1])
		v.swing_phase = 1
		for i in 4:
			for f in 9:
				v.swing_k = clampf((i * 9.0 + f) / 36.0, 0.0, 1.0)
				await process_frame
			root.get_texture().get_image().save_png("%s/ev_%s_%s_%d.png" % [out, kind, p[0], i])
	quit()
