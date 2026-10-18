extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1280x540 -s tests/gallery.gd -- <out.png> name [name ...]
## Models side by side at 4 m spacing with a red marker on +Z, to see each one's scale and which way it faces.

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var out: String = args[0]
	var names: Array = Array(args.slice(1))
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.62, 0.7, 0.8)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.7, 0.7, 0.72)
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -35, 0)
	root.add_child(sun)
	var floor_mi := MeshInstance3D.new()
	var pl := PlaneMesh.new()
	pl.size = Vector2(80, 30)
	floor_mi.mesh = pl
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.35, 0.36, 0.38)
	floor_mi.material_override = fm
	root.add_child(floor_mi)
	var i := 0
	for n in names:
		var scene: PackedScene = load("res://assets/generated/raw/%s.glb" % n)
		var node: Node3D = scene.instantiate()
		node.position = Vector3(i * 4.5, 1.0, 0)
		node.scale = Vector3.ONE * float(OS.get_environment("GAL_SCALE") if OS.get_environment("GAL_SCALE") != "" else "2.0")
		root.add_child(node)
		var marker := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.18
		sm.height = 0.36
		marker.mesh = sm
		var mm := StandardMaterial3D.new()
		mm.albedo_color = Color(1, 0, 0)
		mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		marker.material_override = mm
		marker.position = Vector3(i * 4.5, 0.2, 2.6)
		root.add_child(marker)
		i += 1
	var cam := Camera3D.new()
	cam.fov = 40
	root.add_child(cam)
	cam.position = Vector3((i - 1) * 2.25, 4.5, 11.0)
	cam.look_at_from_position(cam.position, Vector3((i - 1) * 2.25, 0.8, 0), Vector3.UP)
	cam.make_current()
	for k in range(6):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(out)
	print("saved ", out)
	quit()
