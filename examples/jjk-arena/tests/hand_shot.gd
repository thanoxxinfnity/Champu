extends SceneTree
## xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/hand_shot.gd -- meguna
## Close-up of both hands in the fight stance with fists closed, to check finger curls on a model.

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var which: String = args[0] if args.size() > 0 else "meguna"
	var world := Node3D.new()
	root.add_child(world)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.45, 0.47, 0.52)
	world.add_child(env)
	var a := RigAnimator.new()
	world.add_child(a)
	a.load_model("res://assets/characters/%s.glb" % which)
	a.curl_fists = true
	a.set_fists(true)
	var pose := PoseLib.build(PoseLib.attack("light1", 1, 1.0) if args.size() > 1 and args[1] == "jab" else PoseLib.stance(0.0))
	a.apply(pose)
	a.skeleton.force_update_all_bone_transforms()
	var cam := Camera3D.new()
	world.add_child(cam)
	cam.current = true
	cam.fov = 30
	await process_frame
	for side in ["L", "R"]:
		var h: Vector3 = a.skeleton.global_transform * a.skeleton.get_bone_global_pose(a.idx["hand" + side]).origin
		for view in [0, 1]:
			var off := Vector3(0, 0.05, -0.6) if view == 0 else Vector3(0.6 if side == "L" else -0.6, 0.05, 0)
			cam.look_at_from_position(h + off, h)
			await process_frame
			await process_frame
			root.get_viewport().get_texture().get_image().save_png("/tmp/cm/hand_%s_%s%d.png" % [which, side, view])
	quit()
