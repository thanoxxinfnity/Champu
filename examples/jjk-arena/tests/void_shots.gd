extends SceneTree
## xvfb-run godot --rendering-driver opengl3 --path . -s tests/void_shots.gd   -> /tmp/cm/void_*.png
func _init() -> void:
	var root := Node3D.new()
	get_root().add_child(root)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.5, 0.5, 0.5)
	root.add_child(env)
	var cam := Camera3D.new()
	cam.fov = 75
	root.add_child(cam)
	cam.look_at_from_position(Vector3(0, 2.2, 7), Vector3(0, 3.5, 0))
	var dm := InfiniteVoidManager.new()
	root.add_child(dm)
	var box := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.height = 1.8
	cap.radius = 0.35
	box.mesh = cap
	box.position = Vector3(0, 0.95, 0)
	root.add_child(box)
	get_root().size = Vector2i(960, 540)
	await process_frame
	dm.activate()
	await create_timer(0.8).timeout
	await process_frame
	get_root().get_texture().get_image().save_png("/tmp/cm/void_a.png")
	cam.look_at_from_position(Vector3(0, 1.2, 6), Vector3(0, 6.0, 0))
	await create_timer(0.5).timeout
	await process_frame
	get_root().get_texture().get_image().save_png("/tmp/cm/void_b.png")
	quit()
