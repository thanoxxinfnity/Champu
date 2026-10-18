extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/scene_shot.gd -- <out.png> <seconds>

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var out: String = args[0] if args.size() > 0 else "/tmp/rig/scene.png"
	var seconds: float = float(args[1]) if args.size() > 1 else 1.0
	var scene: PackedScene = load("res://scenes/main.tscn")
	var inst := scene.instantiate()
	root.add_child(inst)
	await process_frame
	await process_frame
	var steps := int(seconds / 0.05)
	for i in range(steps):
		inst._process(0.05)
		await process_frame
	await process_frame
	await process_frame
	root.get_viewport().get_texture().get_image().save_png(out)
	print("saved ", out, " at t=", seconds)
	quit()
