extends SceneTree
## Renders each cast member in idle / walk / swing (and a back view) under xvfb, one PNG per character:
##   xvfb-run godot --rendering-driver opengl3 --path . -s tests/viewer.gd -- /tmp/out_dir
## so the toon shader, outline, rig poses and hair/tail sway can be judged by eye.

func _initialize() -> void:
	var out_dir := "/tmp/cm/out"
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out_dir = args[0]
	root.size = Vector2i(1280, 720)
	var world := Node3D.new()
	root.add_child(world)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.3, 0.34, 0.37)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.58, 0.66)
	env.ambient_light_energy = 0.55
	var we := WorldEnvironment.new()
	we.environment = env
	world.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -30, 0)
	sun.light_energy = 1.0
	sun.light_color = Color(1.0, 0.88, 0.86)
	world.add_child(sun)
	var floor_mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(40, 40)
	floor_mi.mesh = pm
	floor_mi.material_override = Toon.flat(Color(0.2, 0.22, 0.24), 0.0, 0.3)
	world.add_child(floor_mi)
	var cam := Camera3D.new()
	cam.fov = 34
	world.add_child(cam)
	cam.look_at_from_position(Vector3(0, 1.25, 5.2), Vector3(0, 0.82, 0))
	cam.make_current()
	var poses := [[CharacterView.Pose.IDLE, 0.0], [CharacterView.Pose.WALK, 0.0], [CharacterView.Pose.SWING, 0.0], [CharacterView.Pose.AIM, 0.0]]
	for id in (args.slice(1) if args.size() > 1 else Data.CAST_ORDER):
		var views: Array[CharacterView] = []
		for j in poses.size():
			var v := CharacterView.new()
			world.add_child(v)
			v.setup(id)
			v.position = Vector3((j - 1.5) * 1.15, 0, 0)
			v.rotation.y = PI + 0.45
			v.pose = poses[j][0]
			v.move_speed = 1.0
			v.swing_phase = 1
			v.swing_k = 0.55
			views.append(v)
		print("%s rig=%s stand_in=%s bones=%d sway=%d" % [id, views[0].rig != null, views[0].stand_in, views[0].rig.skeleton.get_bone_count() if views[0].rig else 0, views[0].rig.sway_bones.size() if views[0].rig else 0])
		for i in 12:
			await process_frame
		root.get_texture().get_image().save_png("%s/cast_%s.png" % [out_dir, id])
		for v in views:
			v.queue_free()
		await process_frame
	quit()
