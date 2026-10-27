extends SceneTree
func _initialize() -> void:
	root.size = Vector2i(1280, 720)
	var ls := LoadingScreen.new()
	root.add_child(ls)
	await process_frame
	ls.open(OS.get_environment("HERO") if OS.get_environment("HERO") != "" else "kafu")
	ls.set_progress(0.62, "Building the world")
	for i in 150:
		await process_frame
		if i in [60, 149]:
			root.get_texture().get_image().save_png("/tmp/ld/look_%d.png" % i)
	quit()
